/**
 * オフライン単体版の API 実装(ブラウザ内で完結する「ローカルサーバ」)。
 *
 * 設計上の位置づけ:
 *   通常構成では戦闘・報酬・育成はすべてサーバ権威で処理する(設計書§37)。
 *   この単体版は「配布してすぐ試せるテストプレイ用」の割り切った構成であり、
 *   同じ計算をブラウザ内で実行する。オンライン要素(ガチャ/PvP/レイド)を載せる際は
 *   必ず通常構成(server/)側を使うこと。
 *
 * 重要: 戦闘計算(server/src/battle)と育成計算(server/src/services/progression)は
 * サーバと同じモジュールをそのまま import している。単体版のために計算を書き直すと
 * 数値が食い違って「単体版では勝てるのに本体では負ける」事故になるため。
 */
import type {
  AffinityTable, AiProfile, BattleStartResponse, CharacterDef, CharacterListResponse,
  CharacterView, ChapterDef, ComboDef, DungeonListResponse, DungeonListResponse as _D,
  EnemyDef, LevelUpInfo, MasterDataResponse, OwnedCharacter, Party, PlayerProfile,
  PlayerStateResponse, ProgressionConfig, Rarity, Skill, StageDef, UpdatePartyResponse,
} from '@akatan/shared';
import { runBattle } from '../server/src/battle/index.js';
import type { CombatantInput } from '../server/src/battle/contract.js';
import {
  computeEnemyStats, computeOwnedStats, diffStats, expToNext,
} from '../server/src/services/progression.js';

/* ============================================================
 * マスターデータの読み込み (data/ をビルド時に埋め込む)
 * ========================================================== */

const jsonFiles = import.meta.glob('../data/**/*.json', { eager: true, import: 'default' }) as
  Record<string, unknown>;

/** 単一オブジェクトでも配列でも受け付ける(サーバのローダと同じ寛容さ) */
function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') {
    const items = (value as { items?: unknown }).items;
    if (Array.isArray(items)) return items as T[];
    return [value as T];
  }
  return [];
}

function collect<T>(segment: string): T[] {
  const out: T[] = [];
  for (const [file, content] of Object.entries(jsonFiles)) {
    if (!file.includes(`/data/${segment}/`)) continue;
    out.push(...asArray<T>(content));
  }
  return out;
}

function single<T>(file: string): T | undefined {
  for (const [key, content] of Object.entries(jsonFiles)) {
    if (key.endsWith(`/data/system/${file}`)) return content as T;
  }
  return undefined;
}

const DEFAULT_BATTLE_CONFIG: ProgressionConfig['battle'] = {
  gaugeRate: 0.1, gaugeMax: 100, ultGainOnAction: 22, ultGainOnHit: 8, ultMax: 100,
  defenseConstant: 300, maxTicks: 240, damageVariance: 0.08,
};

const characters = collect<CharacterDef>('characters');
const enemies = collect<EnemyDef>('enemies');
const skills = collect<Skill>('skills');
const aiProfiles = collect<AiProfile>('ai');
const chapters = collect<ChapterDef>('dungeons');
const combos = collect<ComboDef>('combos');
const affinity = single<AffinityTable>('affinity.json') ?? {};
const progression: ProgressionConfig = {
  levelCap: 60,
  expCurve: { base: 30, exponent: 1.5 },
  ...(single<ProgressionConfig>('progression.json') ?? {}),
  battle: { ...DEFAULT_BATTLE_CONFIG, ...(single<ProgressionConfig>('progression.json')?.battle ?? {}) },
};

const charById = new Map(characters.map((c) => [c.id, c]));
const enemyById = new Map(enemies.map((e) => [e.id, e]));
const skillById = new Map(skills.map((s) => [s.id, s]));
const aiById = new Map(aiProfiles.map((a) => [a.id, a]));
const comboById = new Map(combos.map((c) => [c.id, c]));
const stageById = new Map<string, StageDef>();
for (const ch of chapters) for (const st of ch.stages ?? []) stageById.set(st.id, st);

/* ============================================================
 * セーブデータ (localStorage)
 * ========================================================== */

const SAVE_KEY = 'akatan.standalone.save.v1';
const PARTY_SIZE = 5;

interface SaveData {
  player: PlayerProfile;
  owned: OwnedCharacter[];
  party: Party;
}

const RARITY_ORDER: Rarity[] = ['N', 'R', 'SR', 'SSR', 'UR'];

/** サーバのスターター配布と同じ「低レア→高レアのラウンドロビン」で7体選ぶ */
function pickStarters(): CharacterDef[] {
  const sorted = [...characters].sort((a, b) => a.id.localeCompare(b.id));
  const buckets = new Map<Rarity, CharacterDef[]>(RARITY_ORDER.map((r) => [r, []]));
  for (const def of sorted) buckets.get(def.rarity)?.push(def);

  const picked: CharacterDef[] = [];
  for (let round = 0; picked.length < 7; round += 1) {
    let added = false;
    for (const r of RARITY_ORDER) {
      const bucket = buckets.get(r)!;
      if (round < bucket.length) {
        picked.push(bucket[round]);
        added = true;
        if (picked.length >= 7) break;
      }
    }
    if (!added) break;
  }
  return picked;
}

function newSave(): SaveData {
  const starters = pickStarters();
  const owned: OwnedCharacter[] = starters.map((def, i) => ({
    uid: `ch_${def.id}_${i}`,
    defId: def.id,
    level: 1,
    exp: 0,
    rebirth: 0,
    aiProfile: def.defaultAi,
    obtainedAt: new Date().toISOString(),
  }));
  return {
    player: {
      id: 'local',
      name: 'あかたん提督',
      gold: 1000,
      createdAt: new Date().toISOString(),
      clearedStages: [],
    },
    owned,
    party: {
      id: 'main',
      name: 'メインパーティ',
      members: owned.slice(0, PARTY_SIZE).map((o) => o.uid),
    },
  };
}

function load(): SaveData {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SaveData;
      if (parsed?.owned?.length) {
        // 枠が5未満なら null で埋めて正規化
        const members = [...(parsed.party?.members ?? [])].slice(0, PARTY_SIZE);
        while (members.length < PARTY_SIZE) members.push(null);
        parsed.party = { ...parsed.party, members };
        return parsed;
      }
    }
  } catch {
    /* 壊れたセーブは捨てて作り直す */
  }
  const fresh = newSave();
  save(fresh);
  return fresh;
}

function save(data: SaveData): void {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* プライベートウィンドウ等で保存できない場合はメモリ上だけで進行する */
  }
}

let state: SaveData = load();

/** 単体版だけの機能: セーブを消してやり直す(設定画面から呼べるようにしてもよい) */
export function resetStandaloneSave(): void {
  state = newSave();
  save(state);
}

/* ============================================================
 * ビュー組み立て
 * ========================================================== */

function placeholderSkill(id: string): Skill {
  return {
    id, name: id, kind: 'NORMAL',
    description: '(未定義スキル)',
    cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [],
  };
}

const resolveSkill = (id: string | undefined): Skill =>
  (id ? skillById.get(id) : undefined) ?? placeholderSkill(id ?? 'UNDEFINED');

function toView(owned: OwnedCharacter): CharacterView | null {
  const def = charById.get(owned.defId);
  if (!def) return null;
  return {
    owned,
    def,
    stats: computeOwnedStats(def, owned),
    expToNext: expToNext(owned.level, progression),
    skills: (def.skills ?? []).map(resolveSkill),
    normalAttack: resolveSkill(def.normalAttack),
    ultimate: resolveSkill(def.ultimate),
  };
}

const views = (): CharacterView[] =>
  state.owned.map(toView).filter((v): v is CharacterView => v !== null);

/* ============================================================
 * 戦闘
 * ========================================================== */

function toAlly(view: CharacterView, slot: number): CombatantInput {
  return {
    id: view.owned.uid,
    side: 'ALLY',
    slot,
    name: view.def.name,
    defId: view.def.id,
    element: view.def.element,
    roles: view.def.roles,
    level: view.owned.level,
    stats: view.stats,
    normalAttack: view.def.normalAttack,
    skills: view.def.skills ?? [],
    ultimate: view.def.ultimate,
    passives: view.def.passives,
    aiProfile: view.owned.aiProfile ?? view.def.defaultAi,
    awakening: view.def.awakening,
    art: view.def.art,
    rarity: view.def.rarity,
    tags: view.def.tags,
  };
}

function toEnemy(def: EnemyDef, level: number, slot: number): CombatantInput {
  return {
    id: `en_${slot}_${def.id}`,
    side: 'ENEMY',
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles,
    level,
    stats: computeEnemyStats(def, level),
    normalAttack: def.normalAttack,
    skills: def.skills ?? [],
    ultimate: def.ultimate,
    aiProfile: def.defaultAi,
    art: def.art,
    tags: def.tags,
  };
}

/** ステージ開放判定(サーバの assertStageUnlocked と同じ規則) */
function assertUnlocked(stage: StageDef): void {
  if (!stage.unlockAfter) return;
  if (state.player.clearedStages.includes(stage.unlockAfter)) return;
  const prev = stageById.get(stage.unlockAfter);
  const err = new Error(
    `このステージはまだ開放されていません。先に「${prev?.name ?? stage.unlockAfter}」をクリアしてください。`,
  );
  (err as Error & { code?: string }).code = 'STAGE_LOCKED';
  throw err;
}

/** EXPを配分してレベルアップ情報を作る(サーバの grantBattleExp と同じ方針) */
function grantExp(
  uids: string[],
  baseExp: number,
  survived: Map<string, boolean>,
): LevelUpInfo[] {
  const cap = progression.levelCap;
  const out: LevelUpInfo[] = [];

  for (const uid of uids) {
    const owned = state.owned.find((o) => o.uid === uid);
    const def = owned ? charById.get(owned.defId) : undefined;
    if (!owned || !def) continue;

    // 戦闘不能者は50%(サーバの DEFEATED_EXP_RATE と同じ)
    const rate = survived.get(uid) === false ? 0.5 : 1;
    const gain = Math.max(0, Math.floor(baseExp * rate));
    if (gain === 0) continue;

    const fromLevel = owned.level;
    const before = computeOwnedStats(def, owned);

    owned.exp += gain;
    while (owned.level < cap) {
      const need = expToNext(owned.level, progression);
      if (need <= 0 || owned.exp < need) break;
      owned.exp -= need;
      owned.level += 1;
    }
    if (owned.level >= cap) owned.exp = 0;

    if (owned.level > fromLevel) {
      out.push({
        uid,
        name: def.name,
        fromLevel,
        toLevel: owned.level,
        expGained: gain,
        statGain: diffStats(before, computeOwnedStats(def, owned)),
      });
    }
  }
  return out;
}

/* ============================================================
 * 公開API (client/src/mock/index.ts と同じ形)
 * ========================================================== */

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const mockApi = {
  async getPlayer(): Promise<PlayerStateResponse> {
    await delay(40);
    return {
      player: { ...state.player },
      characters: views(),
      party: { ...state.party, members: [...state.party.members] },
    };
  },

  async getCharacters(): Promise<CharacterListResponse> {
    await delay(20);
    return { characters: views() };
  },

  async getMaster(): Promise<MasterDataResponse> {
    await delay(20);
    return { characters, enemies, skills, aiProfiles, chapters, combos };
  },

  async getDungeons(): Promise<DungeonListResponse> {
    await delay(20);
    return { chapters, clearedStages: [...state.player.clearedStages] };
  },

  async updateParty(members: (string | null)[]): Promise<UpdatePartyResponse> {
    await delay(30);
    const normalized = members.slice(0, PARTY_SIZE);
    while (normalized.length < PARTY_SIZE) normalized.push(null);

    const filled = normalized.filter((m): m is string => !!m);
    if (new Set(filled).size !== filled.length) {
      throw new Error('同じキャラクターを複数の枠に編成できません。');
    }
    for (const uid of filled) {
      if (!state.owned.some((o) => o.uid === uid)) {
        throw new Error(`所持していないキャラクターです: ${uid}`);
      }
    }

    state.party = { ...state.party, members: normalized };
    save(state);
    return { party: { ...state.party, members: [...state.party.members] } };
  },

  async updateAi(uid: string, aiProfile: string): Promise<CharacterView> {
    await delay(20);
    const owned = state.owned.find((o) => o.uid === uid);
    if (!owned) throw new Error('キャラクターが見つかりません。');

    const profile = aiById.get(aiProfile);
    if (!profile) throw new Error(`AI戦術が見つかりません: ${aiProfile}`);
    // サーバと同じく、プレイヤーが選べないAI(敵・ボス専用)は拒否する。
    // ただしデータに playerSelectable が1つも無い移行期は許可する。
    const anySelectable = aiProfiles.some((p) => p.playerSelectable === true);
    if (anySelectable && profile.playerSelectable !== true) {
      throw new Error('この戦術はキャラクターに設定できません。');
    }

    owned.aiProfile = aiProfile;
    save(state);
    const view = toView(owned);
    if (!view) throw new Error('キャラクター定義が見つかりません。');
    return view;
  },

  async startBattle(stageId: string, members?: (string | null)[]): Promise<BattleStartResponse> {
    await delay(60);
    const stage = stageById.get(stageId);
    if (!stage) throw new Error(`ステージが見つかりません: ${stageId}`);
    assertUnlocked(stage);

    const uids = (members ?? state.party.members).filter((m): m is string => !!m);
    const all = views();
    const party = uids
      .map((uid) => all.find((v) => v.owned.uid === uid))
      .filter((v): v is CharacterView => !!v);
    if (party.length === 0) throw new Error('パーティにキャラクターが編成されていません。');

    const allies = party.map(toAlly);
    const foes = (stage.enemies ?? [])
      .map((p, i) => {
        const def = enemyById.get(p.enemyId);
        return def ? toEnemy(def, p.level, i) : null;
      })
      .filter((c): c is CombatantInput => c !== null);

    const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
    const log = runBattle(allies, foes, {
      skills: skillById,
      aiProfiles: aiById,
      affinity,
      config: progression.battle,
      seed,
      stageId,
      combos: comboById,
      now: new Date().toISOString(),
    });

    let rewards = null as BattleStartResponse['rewards'];
    if (log.result.victory) {
      const survived = new Map<string, boolean>();
      for (const s of log.result.stats) {
        if (s.side === 'ALLY') survived.set(s.id, s.survived);
      }
      const exp = stage.rewards?.exp ?? 0;
      const gold = stage.rewards?.gold ?? 0;
      const levelUps = grantExp(uids, exp, survived);

      state.player = {
        ...state.player,
        gold: state.player.gold + gold,
        clearedStages: state.player.clearedStages.includes(stage.id)
          ? state.player.clearedStages
          : [...state.player.clearedStages, stage.id],
      };
      rewards = { exp, gold, levelUps };
      log.result.rewards = rewards;
      save(state);
    }

    return {
      log,
      rewards,
      player: { ...state.player },
      characters: views(),
      stage,
    };
  },
};
