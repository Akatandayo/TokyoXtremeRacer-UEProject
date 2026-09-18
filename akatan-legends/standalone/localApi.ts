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
  AffinityTable, AffixDef, AiProfile, BattleStartResponse, CharacterDef, CharacterDropResult,
  CharacterListResponse, CharacterView, ChapterDef, ComboDef, DropEntry, DropResult,
  DropTableDef, DungeonListResponse, EnemyDef, EquipmentInstance, EquipmentSlot, EquipResponse,
  GachaBannerDef, GachaListResponse, GachaPullResponse, GachaPullResult, InventoryResponse,
  ItemBaseDef, ItemRarity, LevelUpInfo, MasterDataResponse, MaterialDef, MaterialStack,
  OwnedCharacter, Party, PlayerProfile, PlayerStateResponse, ProgressionConfig, Rarity,
  SellEquipmentResponse, Skill, StageDef, UpdatePartyResponse,
} from '@akatan/shared';
import { runBattle } from '../server/src/battle/index.js';
import type { CombatantInput } from '../server/src/battle/contract.js';
import {
  computeEnemyStats, computeOwnedStats, diffStats, expToNext,
} from '../server/src/services/progression.js';
import {
  contextFromGameData, rollEquipment, DEFAULT_ITEM_RARITY_WEIGHTS,
  type ItemGeneratorContext,
} from '../server/src/services/item-generator.js';
import { createRng } from '../server/src/battle/rng.js';

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
const itemBases = collect<ItemBaseDef>('items/bases');
const affixes = collect<AffixDef>('items/affixes');
const dropTables = collect<DropTableDef>('items/droptables');
const gachaBanners = collect<GachaBannerDef>('gacha');
const materials: MaterialDef[] = (() => {
  for (const [file, content] of Object.entries(jsonFiles)) {
    if (file.endsWith('/data/items/materials.json')) return asArray<MaterialDef>(content);
  }
  return [];
})();
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
const dropTableById = new Map(dropTables.map((d) => [d.id, d]));
const bannerById = new Map(gachaBanners.map((b) => [b.id, b]));
const materialById = new Map(materials.map((m) => [m.id, m]));

/** 装備生成はサーバと同じモジュール(item-generator)を共有する */
const itemCtx: ItemGeneratorContext = contextFromGameData({
  itemBases: new Map(itemBases.map((b) => [b.id, b])),
  affixes: new Map(affixes.map((a) => [a.id, a])),
} as never);

/**
 * 「チケット」として扱う素材ID。
 * サーバと同じく、ガチャのコスト指定とドロップの SUMMON_TICKET から実際に
 * 参照されている素材IDを集めて判定する(データ駆動・コード変更不要)。
 */
const ticketIds = new Set<string>();
for (const b of gachaBanners) {
  if (b.cost?.ticketId) ticketIds.add(b.cost.ticketId);
  if (b.cost10?.ticketId) ticketIds.add(b.cost10.ticketId);
}
for (const t of dropTables) {
  for (const e of t.entries ?? []) if (e.kind === 'SUMMON_TICKET' && e.id) ticketIds.add(e.id);
}

/** 重複キャラの変換先(サーバの duplicateShardMaterialId と同じ規則) */
const duplicateShardId = (rarity: Rarity): string =>
  rarity === 'SSR' || rarity === 'UR' ? 'mat_dup_fragment_high' : 'mat_dup_fragment_low';

/* ============================================================
 * セーブデータ (localStorage)
 * ========================================================== */

const SAVE_KEY = 'akatan.standalone.save.v1';
const PARTY_SIZE = 5;

interface SaveData {
  player: PlayerProfile;
  owned: OwnedCharacter[];
  party: Party;
  /** 所持装備 */
  equipment?: EquipmentInstance[];
  /** 所持素材・チケット */
  materials?: MaterialStack[];
  /** バナーID -> 天井カウント */
  pity?: Record<string, number>;
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
    equipment: [],
    materials: [],
    pity: {},
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
        // 旧バージョンのセーブを読んだ場合に備えて既定値で補完する
        parsed.equipment ??= [];
        parsed.materials ??= [];
        parsed.pity ??= {};
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

const equipmentByUid = (): Map<string, EquipmentInstance> =>
  new Map((state.equipment ?? []).map((e) => [e.uid, e]));

function toView(owned: OwnedCharacter): CharacterView | null {
  const def = charById.get(owned.defId);
  if (!def) return null;
  return {
    owned,
    def,
    // 装備込みで再計算する(サーバと同じ progression モジュールを共有)
    stats: computeOwnedStats(def, owned, equipmentByUid()),
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

function collectSpecials(owned: OwnedCharacter) {
  const map = equipmentByUid();
  const out = [];
  for (const uid of Object.values(owned.equipment ?? {})) {
    const eq = uid ? map.get(uid) : undefined;
    if (eq?.special) out.push(eq.special);
  }
  return out;
}

function toAlly(view: CharacterView, slot: number): CombatantInput {
  const specials = collectSpecials(view.owned);
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
    ...(specials.length > 0 ? { specials } : {}),
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
 * 所持品 / 装備
 * ========================================================== */

function addMaterial(id: string, count: number): void {
  state.materials ??= [];
  const found = state.materials.find((m) => m.id === id);
  if (found) found.count += count;
  else state.materials.push({ id, count });
}

function inventory(): InventoryResponse {
  const mats: MaterialStack[] = [];
  const tickets: MaterialStack[] = [];
  for (const m of state.materials ?? []) {
    (ticketIds.has(m.id) ? tickets : mats).push({ ...m });
  }
  return { equipment: (state.equipment ?? []).map((e) => ({ ...e })), materials: mats, tickets };
}

function newEquipment(params: { itemLevel: number; seed: number; slot?: EquipmentSlot; rarityWeights?: Partial<Record<ItemRarity, number>> }): EquipmentInstance | null {
  const core = rollEquipment(itemCtx, params);
  if (!core) return null;
  return { ...core, uid: `eq_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`, obtainedAt: new Date().toISOString() };
}

/* ============================================================
 * ドロップ抽選 (設計書§24)
 * ========================================================== */

function rollDrops(stage: StageDef): DropResult {
  const result: DropResult = { gold: 0, equipment: [], materials: [], characters: [], tickets: [] };
  const table = stage.rewards?.dropTable ? dropTableById.get(stage.rewards.dropTable) : undefined;
  if (!table) return result;

  const rng = createRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
  const enemyLevel = Math.max(...(stage.enemies ?? []).map((e) => e.level), 1);
  const choices: { weight: number; entry: DropEntry | null }[] = [
    ...(table.entries ?? []).map((e) => ({ weight: Math.max(0, e.weight), entry: e })),
    ...(table.nothingWeight ? [{ weight: table.nothingWeight, entry: null }] : []),
  ];
  const total = choices.reduce((a, c) => a + c.weight, 0);
  if (total <= 0) return result;

  for (let i = 0; i < (table.rolls ?? 1); i++) {
    let roll = rng.next() * total;
    let picked: DropEntry | null = null;
    for (const c of choices) {
      roll -= c.weight;
      if (roll <= 0) { picked = c.entry; break; }
    }
    if (!picked) continue;  // 「何も出ない」枠
    const count = picked.min != null && picked.max != null
      ? rng.int(picked.min, picked.max) : (picked.min ?? 1);

    switch (picked.kind) {
      case 'GOLD':
        result.gold += count;
        break;
      case 'EQUIPMENT': {
        const eq = newEquipment({
          itemLevel: enemyLevel, seed: rng.int(1, 0x7fffffff),
          slot: picked.slot, rarityWeights: picked.rarityWeights ?? DEFAULT_ITEM_RARITY_WEIGHTS,
        });
        if (eq) { state.equipment ??= []; state.equipment.push(eq); result.equipment.push(eq); }
        break;
      }
      case 'MATERIAL':
      case 'SUMMON_TICKET': {
        if (!picked.id) break;
        addMaterial(picked.id, count);
        const stack = { id: picked.id, count };
        (picked.kind === 'SUMMON_TICKET' || ticketIds.has(picked.id) ? result.tickets : result.materials).push(stack);
        break;
      }
      case 'CHARACTER': {
        const pool = picked.id ? [picked.id] : characters.map((c) => c.id);
        const defId = pool[rng.int(0, pool.length - 1)];
        result.characters.push(grantOrConvert(defId));
        break;
      }
    }
  }
  return result;
}

/** 未所持なら付与、既所持なら素材へ変換する(設計書§27: 重複を完全なハズレにしない) */
function grantOrConvert(defId: string): CharacterDropResult {
  const def = charById.get(defId);
  if (!def) return { defId, name: defId, rarity: 'N', duplicate: false };
  const already = state.owned.some((o) => o.defId === defId);
  if (already) {
    const matId = duplicateShardId(def.rarity);
    const count = def.rarity === 'SSR' || def.rarity === 'UR' ? 2 : 1;
    if (materialById.has(matId)) {
      addMaterial(matId, count);
      return { defId, name: def.name, rarity: def.rarity, duplicate: true, converted: { id: matId, count } };
    }
    // 変換先の素材が定義されていない場合はゴールドで補填する(ハズレにしないため)
    state.player = { ...state.player, gold: state.player.gold + 200 };
    return { defId, name: def.name, rarity: def.rarity, duplicate: true };
  }
  const owned: OwnedCharacter = {
    uid: `ch_${def.id}_${Math.random().toString(36).slice(2, 8)}`,
    defId: def.id, level: 1, exp: 0, rebirth: 0,
    aiProfile: def.defaultAi, obtainedAt: new Date().toISOString(),
  };
  state.owned.push(owned);
  return { defId, name: def.name, rarity: def.rarity, duplicate: false, uid: owned.uid };
}

/* ============================================================
 * ガチャ (設計書§26〜§27)
 * ========================================================== */

function rollRarity(rng: ReturnType<typeof createRng>, banner: GachaBannerDef): Rarity {
  const entries = Object.entries(banner.rates?.rarity ?? {}) as [Rarity, number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return 'N';
  let roll = rng.next() * total;
  for (const [r, v] of entries) { roll -= v; if (roll <= 0) return r; }
  return entries[entries.length - 1][0];
}

function pullOnce(banner: GachaBannerDef, rng: ReturnType<typeof createRng>, forceRarity?: Rarity): GachaPullResult {
  // 装備バナー
  if (banner.equipment) {
    const eq = newEquipment({
      itemLevel: banner.equipment.itemLevel ?? 1,
      seed: rng.int(1, 0x7fffffff),
      rarityWeights: DEFAULT_ITEM_RARITY_WEIGHTS,
    });
    return { equipment: eq ?? undefined, rarity: eq?.rarity ?? 'COMMON' };
  }

  const rarity = forceRarity ?? rollRarity(rng, banner);
  // ピックアップ判定(同レアリティ内での優遇)
  const pickups = (banner.pickup ?? []).filter((p) => charById.get(p.defId)?.rarity === rarity);
  for (const p of pickups) {
    if (rng.next() * 100 < p.rate) return { character: grantOrConvert(p.defId), rarity };
  }
  const poolIds = banner.pool ?? characters.map((c) => c.id);
  const pool = poolIds.filter((id) => charById.get(id)?.rarity === rarity);
  if (pool.length === 0) {
    // そのレアリティのキャラが居ない場合は全プールから引く(空振りを出さない)
    const all = poolIds.filter((id) => charById.has(id));
    if (all.length === 0) return { rarity };
    return { character: grantOrConvert(all[rng.int(0, all.length - 1)]), rarity };
  }
  return { character: grantOrConvert(pool[rng.int(0, pool.length - 1)]), rarity };
}

const RARITY_ORDER_ASC: Rarity[] = ['N', 'R', 'SR', 'SSR', 'UR'];
const rarityRank = (r: Rarity) => RARITY_ORDER_ASC.indexOf(r);

function payCost(cost: GachaBannerDef['cost']): boolean {
  if (!cost) return true;
  if (cost.currency === 'GOLD') {
    if (state.player.gold < cost.amount) return false;
    state.player = { ...state.player, gold: state.player.gold - cost.amount };
    return true;
  }
  const id = cost.ticketId;
  if (!id) return false;
  const stack = (state.materials ?? []).find((m) => m.id === id);
  if (!stack || stack.count < cost.amount) return false;
  stack.count -= cost.amount;
  state.materials = (state.materials ?? []).filter((m) => m.count > 0);
  return true;
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
    let drops: DropResult | null = null;
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
      drops = rollDrops(stage);
      if (drops.gold > 0) {
        state.player = { ...state.player, gold: state.player.gold + drops.gold };
      }
      save(state);
    }

    return {
      log,
      rewards,
      player: { ...state.player },
      characters: views(),
      stage,
      drops,
      inventory: inventory(),
    };
  },

  /* ---------- 所持品 / 装備 ---------- */

  async getInventory(): Promise<InventoryResponse> {
    await delay(20);
    return inventory();
  },

  async equip(equipmentUid: string, characterUid: string): Promise<EquipResponse> {
    await delay(30);
    const eq = (state.equipment ?? []).find((e) => e.uid === equipmentUid);
    if (!eq) throw new Error('装備が見つかりません。');
    const owned = state.owned.find((o) => o.uid === characterUid);
    if (!owned) throw new Error('キャラクターが見つかりません。');
    if (eq.equippedBy && eq.equippedBy !== characterUid) {
      throw new Error('その装備は既に他のキャラクターが装備しています。');
    }

    // 同じスロットに既に付いている装備は自動的に外す(付け替え)
    owned.equipment ??= {};
    const prevUid = owned.equipment[eq.slot];
    if (prevUid && prevUid !== eq.uid) {
      const prev = (state.equipment ?? []).find((e) => e.uid === prevUid);
      if (prev) prev.equippedBy = undefined;
    }
    owned.equipment[eq.slot] = eq.uid;
    eq.equippedBy = characterUid;
    save(state);

    const view = toView(owned);
    if (!view) throw new Error('キャラクター定義が見つかりません。');
    return { character: view, inventory: inventory() };
  },

  async unequip(characterUid: string, slot: EquipmentSlot): Promise<EquipResponse> {
    await delay(30);
    const owned = state.owned.find((o) => o.uid === characterUid);
    if (!owned) throw new Error('キャラクターが見つかりません。');
    const uid = owned.equipment?.[slot];
    if (uid) {
      const eq = (state.equipment ?? []).find((e) => e.uid === uid);
      if (eq) eq.equippedBy = undefined;
      delete owned.equipment![slot];
    }
    save(state);
    const view = toView(owned);
    if (!view) throw new Error('キャラクター定義が見つかりません。');
    return { character: view, inventory: inventory() };
  },

  async sellEquipment(equipmentUids: string[]): Promise<SellEquipmentResponse> {
    await delay(30);
    let gold = 0;
    const sellValue: Record<string, number> = {
      COMMON: 20, UNCOMMON: 45, RARE: 110, EPIC: 260, LEGENDARY: 600, MYTHIC: 1400,
    };
    for (const uid of equipmentUids) {
      const eq = (state.equipment ?? []).find((e) => e.uid === uid);
      if (!eq) continue;
      // 装着中は売れない(サーバと同じ規則)
      if (eq.equippedBy) throw new Error('装備中のアイテムは売却できません。');
      gold += sellValue[eq.rarity] ?? 20;
    }
    state.equipment = (state.equipment ?? []).filter((e) => !equipmentUids.includes(e.uid));
    state.player = { ...state.player, gold: state.player.gold + gold };
    save(state);
    return { gold, player: { ...state.player }, inventory: inventory() };
  },

  /* ---------- ガチャ ---------- */

  async getGacha(): Promise<GachaListResponse> {
    await delay(20);
    return {
      banners: gachaBanners,
      player: { ...state.player },
      pityCounters: { ...(state.pity ?? {}) },
      tickets: inventory().tickets,
    };
  },

  async gachaPull(bannerId: string, count: number): Promise<GachaPullResponse> {
    await delay(60);
    const banner = bannerById.get(bannerId);
    if (!banner) throw new Error(`召喚バナーが見つかりません: ${bannerId}`);
    const pulls = count === 10 ? 10 : 1;

    // 支払いを先に行う(残高不足なら1回も引かない)
    const cost = pulls === 10 ? (banner.cost10 ?? banner.cost) : banner.cost;
    const amount = pulls === 10 && !banner.cost10 ? { ...banner.cost, amount: banner.cost.amount * 10 } : cost;
    if (!payCost(amount)) {
      const err = new Error('召喚に必要な数が足りません。');
      (err as Error & { code?: string }).code = 'NOT_ENOUGH_CURRENCY';
      throw err;
    }

    const rng = createRng((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);
    state.pity ??= {};
    let pity = state.pity[bannerId] ?? 0;
    const results: GachaPullResult[] = [];
    let bestRank = -1;

    for (let i = 0; i < pulls; i++) {
      pity += 1;
      let forced: Rarity | undefined;
      let byPity = false;
      // 天井
      if (banner.pity && pity >= banner.pity.count) {
        forced = banner.pity.rarity;
        byPity = true;
      }
      // 10連の最低保証(最後の1回で、まだ保証レアに達していなければ確定させる)
      if (!forced && pulls === 10 && i === pulls - 1 && banner.guarantee10
          && bestRank < rarityRank(banner.guarantee10)) {
        forced = banner.guarantee10;
      }
      const r = pullOnce(banner, rng, forced);
      if (byPity) r.byPity = true;
      if (byPity || (banner.pity && rarityRank(r.rarity as Rarity) >= rarityRank(banner.pity.rarity))) {
        pity = 0;  // 天井レアに到達したらカウントをリセット
      }
      if (!banner.equipment) bestRank = Math.max(bestRank, rarityRank(r.rarity as Rarity));
      results.push(r);
    }

    state.pity[bannerId] = pity;
    save(state);
    return {
      results,
      player: { ...state.player },
      characters: views(),
      inventory: inventory(),
      pityCounter: pity,
    };
  },
};
