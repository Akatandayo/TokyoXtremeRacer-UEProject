/**
 * プレイヤーサービス
 * ------------------------------------------------------------
 * - プレイヤーの自動作成とスターターキャラ配布
 * - OwnedCharacter -> CharacterView (計算済みステータス付き) の組み立て
 *
 * MVP では認証を作らないので単一ローカルプレイヤー ('local') を使うが、
 * すべての関数は playerId を引数で受け取るため、将来の認証導入時に
 * 呼び出し側を差し替えるだけでマルチプレイヤー化できる。
 */
import { randomUUID } from 'node:crypto';
import type {
  CharacterDef, CharacterView, EquipmentInstance, OwnedCharacter, Party, PlayerProfile, Rarity, Skill,
} from '@akatan/shared';
import { PARTY_SIZE, RARITIES } from '@akatan/shared';
import * as repo from '../db/repository.js';
import { getGameData, type GameData } from '../data/loader.js';
import { computeOwnedStats, expToNext } from './progression.js';

/** MVP の固定プレイヤーID(認証なし) */
export const LOCAL_PLAYER_ID = 'local';
export const DEFAULT_PLAYER_NAME = 'あかたん提督';
/** 新規プレイヤーの初期ゴールド */
export const STARTING_GOLD = 1000;
/** スターター配布数(5〜7体) */
export const STARTER_MIN = 5;
export const STARTER_MAX = 7;

/* ============================================================
 * CharacterView の組み立て
 * ========================================================== */

/** マスタに無いスキルIDを参照された場合のプレースホルダ(型を満たしつつ落とさない) */
function placeholderSkill(id: string): Skill {
  return {
    id,
    name: id,
    kind: 'NORMAL',
    description: '(未定義スキル: data/skills に定義がありません)',
    cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [],
  };
}

function resolveSkill(data: GameData, id: string | undefined): Skill {
  if (!id) return placeholderSkill('UNDEFINED');
  return data.skills.get(id) ?? placeholderSkill(id);
}

/**
 * 所持キャラ + マスタ定義 -> CharacterView。
 * ステータスと expToNext は **サーバ側で計算した値だけ** を入れる。
 * `equipmentByUid` を渡すと装着中の装備(Phase3)の効果を stats に反映する
 * (省略時は装備なしとして計算する。装備を解決する必要が無い軽量な呼び出し向け)。
 */
export function buildCharacterView(
  owned: OwnedCharacter,
  def: CharacterDef,
  data: GameData = getGameData(),
  equipmentByUid?: Map<string, EquipmentInstance>,
): CharacterView {
  return {
    owned,
    def,
    // 転生ノードの効果(Phase2 §18)を反映する。data.rebirthNodes が空でも
    // resolveRebirthStatMods が空集計を返すだけで落ちない。
    stats: computeOwnedStats(def, owned, equipmentByUid, data.rebirthNodes, data.rebirthConfig.growthBonusPercent),
    expToNext: expToNext(owned.level, data.progression),
    skills: (def.skills ?? []).map((id) => resolveSkill(data, id)),
    normalAttack: resolveSkill(data, def.normalAttack),
    ultimate: resolveSkill(data, def.ultimate),
  };
}

/**
 * 所持キャラ一覧を CharacterView に変換する。
 * マスタに定義が無い(データ担当がIDを変更した等)キャラは警告して除外する。
 * 装備は playerId の全所持装備を1回だけ取得して各キャラに引き当てる(N+1回避)。
 */
export function listCharacterViews(
  playerId: string,
  data: GameData = getGameData(),
): CharacterView[] {
  const views: CharacterView[] = [];
  const equipmentByUid = new Map(repo.listEquipment(playerId).map((e) => [e.uid, e]));
  for (const owned of repo.listOwnedCharacters(playerId)) {
    const def = data.characters.get(owned.defId);
    if (!def) {
      console.warn(`[player] 所持キャラ ${owned.uid} の定義 '${owned.defId}' がマスタにありません。表示から除外します。`);
      continue;
    }
    views.push(buildCharacterView(owned, def, data, equipmentByUid));
  }
  return views;
}

/* ============================================================
 * スターター配布
 * ========================================================== */

/**
 * レアリティが偏らないようにスターターを選ぶ。
 * 低レア -> 高レアの順に 1 体ずつラウンドロビンで拾い、STARTER_MAX 体まで集める。
 * 決定論的にするため各バケット内は id 昇順。
 */
export function pickStarterCharacters(data: GameData): CharacterDef[] {
  const all = [...data.characters.values()].sort((a, b) => a.id.localeCompare(b.id));
  if (all.length === 0) return [];

  const buckets = new Map<Rarity, CharacterDef[]>();
  for (const r of RARITIES) buckets.set(r, []);
  const unknown: CharacterDef[] = [];
  for (const def of all) {
    const bucket = buckets.get(def.rarity);
    if (bucket) bucket.push(def);
    else unknown.push(def);
  }

  const picked: CharacterDef[] = [];
  const order: Rarity[] = [...RARITIES];
  let round = 0;
  while (picked.length < STARTER_MAX) {
    let addedThisRound = false;
    for (const r of order) {
      const bucket = buckets.get(r)!;
      if (round < bucket.length) {
        picked.push(bucket[round]);
        addedThisRound = true;
        if (picked.length >= STARTER_MAX) break;
      }
    }
    if (!addedThisRound) break;
    round += 1;
  }

  // レアリティ不明のキャラしか無い場合の保険
  for (const def of unknown) {
    if (picked.length >= STARTER_MAX) break;
    picked.push(def);
  }

  // 全体が STARTER_MIN 未満しか無いならあるだけ配る(データ未完成時)
  return picked.slice(0, Math.max(STARTER_MIN, Math.min(STARTER_MAX, picked.length)));
}

function newOwned(def: CharacterDef): OwnedCharacter {
  return {
    uid: `ch_${randomUUID()}`,
    defId: def.id,
    level: 1,
    exp: 0,
    rebirth: 0,
    aiProfile: def.defaultAi,
    obtainedAt: new Date().toISOString(),
  };
}

/** 指定キャラを付与する(ガチャ/報酬からも使える汎用関数) */
export function grantCharacter(playerId: string, def: CharacterDef): OwnedCharacter {
  const owned = newOwned(def);
  repo.insertOwnedCharacter(playerId, owned);
  return owned;
}

/* ============================================================
 * プレイヤー取得 / 自動作成
 * ========================================================== */

function emptyParty(): Party {
  return {
    id: repo.DEFAULT_PARTY_ID,
    name: 'メインパーティ',
    members: new Array<string | null>(PARTY_SIZE).fill(null),
  };
}

export interface PlayerState {
  player: PlayerProfile;
  characters: CharacterView[];
  party: Party;
}

/**
 * プレイヤーを取得し、存在しなければ作成してスターターを配布する。
 * データが 0 件でも 0 体で作成し、サーバは正常応答する。
 */
export function getOrCreatePlayer(
  playerId: string = LOCAL_PLAYER_ID,
  data: GameData = getGameData(),
): PlayerState {
  let player = repo.findPlayer(playerId);

  if (!player) {
    player = repo.inTransaction(() => {
      const created = repo.createPlayer(playerId, DEFAULT_PLAYER_NAME, { gold: STARTING_GOLD });
      const starters = pickStarterCharacters(data);
      const owned = starters.map(newOwned);
      if (owned.length > 0) repo.insertOwnedCharacters(playerId, owned);
      // 付与したキャラで自動編成(先頭 PARTY_SIZE 体)
      const members: (string | null)[] = new Array<string | null>(PARTY_SIZE).fill(null);
      owned.slice(0, PARTY_SIZE).forEach((o, i) => { members[i] = o.uid; });
      repo.saveParty(playerId, { ...emptyParty(), members });
      console.log(`[player] 新規プレイヤー '${playerId}' を作成し、スターター ${owned.length} 体を付与しました。`);
      return created;
    });
  }

  let party = repo.findParty(playerId);
  if (!party) {
    party = repo.saveParty(playerId, emptyParty());
  }

  return {
    player,
    characters: listCharacterViews(playerId, data),
    party,
  };
}

/** 最新のプレイヤープロフィール(ゴールド/クリア済みを含む)を取得 */
export function getPlayerProfile(playerId: string = LOCAL_PLAYER_ID): PlayerProfile {
  const p = repo.findPlayer(playerId);
  if (p) return p;
  return getOrCreatePlayer(playerId).player;
}
