/**
 * リポジトリ層 (設計書 §36)
 * ------------------------------------------------------------
 * **SQL はこのファイルにだけ書く。** routes / services は必ずここ経由で永続化する。
 * 将来 SQLite を別のストレージ(Postgres / KVS など)に差し替えるときは
 * このファイルの実装だけを入れ替えればよい。
 *
 * すべての関数は playerId を引数で受け取る。MVP では 'local' 固定だが、
 * 認証を入れた時に呼び出し側を変えるだけでマルチプレイヤー化できる。
 */
import type {
  BattleLog, EquipmentInstance, EquipmentSlot, ItemSpecialEffect, MaterialStack,
  OwnedCharacter, Party, PlayerProfile, RaidState, StatKey,
} from '@akatan/shared';
import { PARTY_SIZE } from '@akatan/shared';
import { getDb, type Db } from './index.js';

/** battle_logs はプレイヤーごとに直近この件数だけ残す(リプレイ用) */
export const BATTLE_LOG_KEEP = 50;

/* ============================================================
 * 行 <-> ドメイン型 の変換
 * ========================================================== */

interface PlayerRow {
  id: string;
  name: string;
  gold: number;
  stamina: number;
  created_at: string;
}

interface OwnedRow {
  uid: string;
  player_id: string;
  def_id: string;
  level: number;
  exp: number;
  rebirth: number;
  rebirth_points: string | null;
  /** v3 (第4ラウンド): 転生ノードの取得状況(JSON: ノードID -> ランク) */
  rebirth_nodes: string | null;
  /** v3 (第4ラウンド): 未使用の転生ポイント */
  rebirth_points_available: number;
  limit_break: number;
  equipment: string | null;
  ai_profile: string | null;
  obtained_at: string;
}

interface PartyRow {
  id: string;
  player_id: string;
  name: string;
  members: string;
  updated_at: string;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toOwnedCharacter(row: OwnedRow): OwnedCharacter {
  const owned: OwnedCharacter = {
    uid: row.uid,
    defId: row.def_id,
    level: row.level,
    exp: row.exp,
    rebirth: row.rebirth,
    obtainedAt: row.obtained_at,
  };
  const rebirthPoints = parseJson<Partial<Record<StatKey, number>> | null>(row.rebirth_points, null);
  if (rebirthPoints) owned.rebirthPoints = rebirthPoints;
  const rebirthNodes = parseJson<Record<string, number> | null>(row.rebirth_nodes, null);
  if (rebirthNodes) owned.rebirthNodes = rebirthNodes;
  if (row.rebirth_points_available) owned.rebirthPointsAvailable = row.rebirth_points_available;
  if (row.limit_break) owned.limitBreak = row.limit_break;
  const equipment = parseJson<OwnedCharacter['equipment'] | null>(row.equipment, null);
  if (equipment) owned.equipment = equipment;
  if (row.ai_profile) owned.aiProfile = row.ai_profile;
  return owned;
}

function toParty(row: PartyRow): Party {
  const members = parseJson<(string | null)[]>(row.members, []);
  return {
    id: row.id,
    name: row.name,
    members: normalizeMembers(members),
  };
}

/** 長さを PARTY_SIZE に揃える(DB に古い長さの行があっても壊れないように) */
export function normalizeMembers(members: (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < PARTY_SIZE; i += 1) {
    const v = members[i];
    out.push(typeof v === 'string' && v.length > 0 ? v : null);
  }
  return out;
}

/* ============================================================
 * プレイヤー
 * ========================================================== */

export function findPlayer(playerId: string, db: Db = getDb()): PlayerProfile | null {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as PlayerRow | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    gold: row.gold,
    stamina: row.stamina,
    createdAt: row.created_at,
    clearedStages: listClearedStages(playerId, db),
  };
}

export function createPlayer(
  playerId: string,
  name: string,
  opts: { gold?: number; stamina?: number } = {},
  db: Db = getDb(),
): PlayerProfile {
  const createdAt = new Date().toISOString();
  db.prepare(
    'INSERT INTO players (id, name, gold, stamina, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(playerId, name, opts.gold ?? 0, opts.stamina ?? 0, createdAt);
  return { id: playerId, name, gold: opts.gold ?? 0, stamina: opts.stamina ?? 0, createdAt, clearedStages: [] };
}

export function addGold(playerId: string, amount: number, db: Db = getDb()): void {
  if (amount === 0) return;
  db.prepare('UPDATE players SET gold = MAX(0, gold + ?) WHERE id = ?').run(amount, playerId);
}

export function renamePlayer(playerId: string, name: string, db: Db = getDb()): void {
  db.prepare('UPDATE players SET name = ? WHERE id = ?').run(name, playerId);
}

/* ============================================================
 * 所持キャラ
 * ========================================================== */

export function listOwnedCharacters(playerId: string, db: Db = getDb()): OwnedCharacter[] {
  const rows = db
    .prepare('SELECT * FROM owned_characters WHERE player_id = ? ORDER BY obtained_at ASC, uid ASC')
    .all(playerId) as OwnedRow[];
  return rows.map(toOwnedCharacter);
}

export function findOwnedCharacter(
  playerId: string,
  uid: string,
  db: Db = getDb(),
): OwnedCharacter | null {
  const row = db
    .prepare('SELECT * FROM owned_characters WHERE player_id = ? AND uid = ?')
    .get(playerId, uid) as OwnedRow | undefined;
  return row ? toOwnedCharacter(row) : null;
}

export function insertOwnedCharacter(
  playerId: string,
  owned: OwnedCharacter,
  db: Db = getDb(),
): OwnedCharacter {
  db.prepare(
    `INSERT INTO owned_characters
       (uid, player_id, def_id, level, exp, rebirth, rebirth_points, rebirth_nodes,
        rebirth_points_available, limit_break, equipment, ai_profile, obtained_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    owned.uid,
    playerId,
    owned.defId,
    owned.level,
    owned.exp,
    owned.rebirth,
    owned.rebirthPoints ? JSON.stringify(owned.rebirthPoints) : null,
    owned.rebirthNodes ? JSON.stringify(owned.rebirthNodes) : null,
    owned.rebirthPointsAvailable ?? 0,
    owned.limitBreak ?? 0,
    owned.equipment ? JSON.stringify(owned.equipment) : null,
    owned.aiProfile ?? null,
    owned.obtainedAt ?? new Date().toISOString(),
  );
  return owned;
}

/** 複数キャラをまとめて付与(スターター配布用)。トランザクションで一括。 */
export function insertOwnedCharacters(
  playerId: string,
  list: OwnedCharacter[],
  db: Db = getDb(),
): OwnedCharacter[] {
  const tx = db.transaction((items: OwnedCharacter[]) => {
    for (const o of items) insertOwnedCharacter(playerId, o, db);
  });
  tx(list);
  return list;
}

/** レベル/EXP の更新(育成計算の結果をサーバ側で書き戻す) */
export function updateCharacterProgress(
  playerId: string,
  uid: string,
  level: number,
  exp: number,
  db: Db = getDb(),
): void {
  db.prepare(
    'UPDATE owned_characters SET level = ?, exp = ? WHERE player_id = ? AND uid = ?',
  ).run(level, exp, playerId, uid);
}

export function updateCharacterProgressBulk(
  playerId: string,
  updates: { uid: string; level: number; exp: number }[],
  db: Db = getDb(),
): void {
  const tx = db.transaction((items: typeof updates) => {
    for (const u of items) updateCharacterProgress(playerId, u.uid, u.level, u.exp, db);
  });
  tx(updates);
}

/* ============================================================
 * 転生 (設計書§17〜§20, 第4ラウンド)
 * ========================================================== */

/**
 * 転生の実行(POST /api/characters/:uid/rebirth)。
 * レベル/EXPリセット・転生回数+1・転生ポイント加算を1行のUPDATEで確定させる。
 * **転生ノードの取得状況(rebirth_nodes)はここでは変更しない**
 * (取得済みノードは転生をまたいで維持する仕様。呼び出し側 rebirth-service.ts のコメント参照)。
 * 素材消費(materials テーブル)は呼び出し側が同じ `repo.inTransaction` の中で行うこと。
 */
export function updateCharacterRebirth(
  playerId: string,
  uid: string,
  fields: { level: number; exp: number; rebirth: number; rebirthPointsAvailable: number },
  db: Db = getDb(),
): void {
  db.prepare(
    `UPDATE owned_characters
        SET level = ?, exp = ?, rebirth = ?, rebirth_points_available = ?
      WHERE player_id = ? AND uid = ?`,
  ).run(fields.level, fields.exp, fields.rebirth, fields.rebirthPointsAvailable, playerId, uid);
}

/**
 * 転生ノードの割り振り・振り直し(POST /rebirth/allocate, /rebirth/reset)で使う。
 * `nodes` をそのまま JSON で書き込み、`pointsAvailable`(割り振り後の残ポイント、
 * または振り直し後の全額返却後ポイント)を同時に更新する。
 */
export function updateCharacterRebirthNodes(
  playerId: string,
  uid: string,
  nodes: Record<string, number>,
  pointsAvailable: number,
  db: Db = getDb(),
): void {
  const hasAny = Object.keys(nodes).length > 0;
  db.prepare(
    `UPDATE owned_characters SET rebirth_nodes = ?, rebirth_points_available = ? WHERE player_id = ? AND uid = ?`,
  ).run(hasAny ? JSON.stringify(nodes) : null, pointsAvailable, playerId, uid);
}

export function updateCharacterAi(
  playerId: string,
  uid: string,
  aiProfile: string,
  db: Db = getDb(),
): boolean {
  const info = db
    .prepare('UPDATE owned_characters SET ai_profile = ? WHERE player_id = ? AND uid = ?')
    .run(aiProfile, playerId, uid);
  return info.changes > 0;
}

/* ============================================================
 * パーティ
 * ========================================================== */

export const DEFAULT_PARTY_ID = 'main';

export function findParty(
  playerId: string,
  partyId = DEFAULT_PARTY_ID,
  db: Db = getDb(),
): Party | null {
  const row = db
    .prepare('SELECT * FROM parties WHERE player_id = ? AND id = ?')
    .get(playerId, partyId) as PartyRow | undefined;
  return row ? toParty(row) : null;
}

/** 作成 or 更新(冪等) */
export function saveParty(playerId: string, party: Party, db: Db = getDb()): Party {
  const members = normalizeMembers(party.members);
  db.prepare(
    `INSERT INTO parties (id, player_id, name, members, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, members = excluded.members, updated_at = excluded.updated_at`,
  ).run(party.id, playerId, party.name, JSON.stringify(members), new Date().toISOString());
  return { ...party, members };
}

/* ============================================================
 * クリア済みステージ
 * ========================================================== */

export function listClearedStages(playerId: string, db: Db = getDb()): string[] {
  const rows = db
    .prepare('SELECT stage_id FROM cleared_stages WHERE player_id = ? ORDER BY cleared_at ASC')
    .all(playerId) as { stage_id: string }[];
  return rows.map((r) => r.stage_id);
}

export function isStageCleared(playerId: string, stageId: string, db: Db = getDb()): boolean {
  const row = db
    .prepare('SELECT 1 AS hit FROM cleared_stages WHERE player_id = ? AND stage_id = ?')
    .get(playerId, stageId) as { hit: number } | undefined;
  return !!row;
}

export function markStageCleared(playerId: string, stageId: string, db: Db = getDb()): void {
  db.prepare(
    `INSERT INTO cleared_stages (player_id, stage_id, cleared_at) VALUES (?, ?, ?)
     ON CONFLICT(player_id, stage_id) DO NOTHING`,
  ).run(playerId, stageId, new Date().toISOString());
}

/* ============================================================
 * 戦闘ログ
 * ========================================================== */

/** ログを保存し、直近 BATTLE_LOG_KEEP 件を超えた古いものを削除する */
export function saveBattleLog(playerId: string, log: BattleLog, db: Db = getDb()): void {
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO battle_logs (id, player_id, stage_id, seed, victory, log_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      log.id,
      playerId,
      log.stageId ?? null,
      log.seed,
      log.result?.victory ? 1 : 0,
      JSON.stringify(log),
      log.createdAt ?? new Date().toISOString(),
    );
    // 上限処理: 新しい順に BATTLE_LOG_KEEP 件だけ残す
    db.prepare(
      `DELETE FROM battle_logs
        WHERE player_id = ?
          AND id NOT IN (
            SELECT id FROM battle_logs WHERE player_id = ?
             ORDER BY created_at DESC, rowid DESC LIMIT ?
          )`,
    ).run(playerId, playerId, BATTLE_LOG_KEEP);
  });
  tx();
}

export function findBattleLog(playerId: string, logId: string, db: Db = getDb()): BattleLog | null {
  const row = db
    .prepare('SELECT log_json FROM battle_logs WHERE player_id = ? AND id = ?')
    .get(playerId, logId) as { log_json: string } | undefined;
  return row ? parseJson<BattleLog | null>(row.log_json, null) : null;
}

export interface BattleLogSummary {
  id: string;
  stageId: string | null;
  seed: number;
  victory: boolean;
  createdAt: string;
}

export function listBattleLogSummaries(
  playerId: string,
  limit = BATTLE_LOG_KEEP,
  db: Db = getDb(),
): BattleLogSummary[] {
  const rows = db
    .prepare(
      `SELECT id, stage_id, seed, victory, created_at FROM battle_logs
        WHERE player_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?`,
    )
    .all(playerId, limit) as
    { id: string; stage_id: string | null; seed: number; victory: number; created_at: string }[];
  return rows.map((r) => ({
    id: r.id,
    stageId: r.stage_id,
    seed: r.seed,
    victory: r.victory === 1,
    createdAt: r.created_at,
  }));
}

export function countBattleLogs(playerId: string, db: Db = getDb()): number {
  const row = db
    .prepare('SELECT COUNT(*) AS n FROM battle_logs WHERE player_id = ?')
    .get(playerId) as { n: number };
  return row.n;
}

/* ============================================================
 * 装備 (Phase 3: ハクスラ)
 * ========================================================== */

interface EquipmentRow {
  uid: string;
  player_id: string;
  base_id: string;
  slot: string;
  rarity: string;
  name: string;
  item_level: number;
  prefix_id: string | null;
  suffix_id: string | null;
  stats: string;
  stats_percent: string | null;
  special: string | null;
  enhance_level: number;
  seed: number | null;
  equipped_by: string | null;
  obtained_at: string;
}

function toEquipmentInstance(row: EquipmentRow): EquipmentInstance {
  const item: EquipmentInstance = {
    uid: row.uid,
    baseId: row.base_id,
    slot: row.slot as EquipmentSlot,
    rarity: row.rarity as EquipmentInstance['rarity'],
    name: row.name,
    itemLevel: row.item_level,
    stats: parseJson<EquipmentInstance['stats']>(row.stats, {}),
    obtainedAt: row.obtained_at,
  };
  if (row.prefix_id) item.prefixId = row.prefix_id;
  if (row.suffix_id) item.suffixId = row.suffix_id;
  const statsPercent = parseJson<EquipmentInstance['statsPercent'] | null>(row.stats_percent, null);
  if (statsPercent) item.statsPercent = statsPercent;
  const special = parseJson<ItemSpecialEffect | null>(row.special, null);
  if (special) item.special = special;
  if (row.enhance_level) item.enhanceLevel = row.enhance_level;
  if (typeof row.seed === 'number') item.seed = row.seed;
  if (row.equipped_by) item.equippedBy = row.equipped_by;
  return item;
}

export function insertEquipment(playerId: string, item: EquipmentInstance, db: Db = getDb()): EquipmentInstance {
  db.prepare(
    `INSERT INTO equipment
       (uid, player_id, base_id, slot, rarity, name, item_level, prefix_id, suffix_id,
        stats, stats_percent, special, enhance_level, seed, equipped_by, obtained_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.uid,
    playerId,
    item.baseId,
    item.slot,
    item.rarity,
    item.name,
    item.itemLevel,
    item.prefixId ?? null,
    item.suffixId ?? null,
    JSON.stringify(item.stats ?? {}),
    item.statsPercent ? JSON.stringify(item.statsPercent) : null,
    item.special ? JSON.stringify(item.special) : null,
    item.enhanceLevel ?? 0,
    typeof item.seed === 'number' ? item.seed : null,
    item.equippedBy ?? null,
    item.obtainedAt ?? new Date().toISOString(),
  );
  return item;
}

export function listEquipment(playerId: string, db: Db = getDb()): EquipmentInstance[] {
  const rows = db
    .prepare('SELECT * FROM equipment WHERE player_id = ? ORDER BY obtained_at ASC, uid ASC')
    .all(playerId) as EquipmentRow[];
  return rows.map(toEquipmentInstance);
}

export function findEquipment(playerId: string, uid: string, db: Db = getDb()): EquipmentInstance | null {
  const row = db
    .prepare('SELECT * FROM equipment WHERE player_id = ? AND uid = ?')
    .get(playerId, uid) as EquipmentRow | undefined;
  return row ? toEquipmentInstance(row) : null;
}

/** 装着先キャラを更新する(null = 未装備に戻す) */
export function setEquipmentEquippedBy(
  playerId: string,
  uid: string,
  characterUid: string | null,
  db: Db = getDb(),
): void {
  db.prepare('UPDATE equipment SET equipped_by = ? WHERE player_id = ? AND uid = ?')
    .run(characterUid, playerId, uid);
}

/** 売却などで完全に削除する。装着中の行を消すと owned_characters 側の参照が浮くので、
 *  呼び出し側(equipment-service)が必ず先に unequip してから呼ぶこと。 */
export function deleteEquipment(playerId: string, uid: string, db: Db = getDb()): boolean {
  const info = db.prepare('DELETE FROM equipment WHERE player_id = ? AND uid = ?').run(playerId, uid);
  return info.changes > 0;
}

/** OwnedCharacter.equipment (JSON列) のスロットを更新する */
export function setCharacterEquipmentSlot(
  playerId: string,
  uid: string,
  slot: EquipmentSlot,
  equipmentUid: string | null,
  db: Db = getDb(),
): void {
  const owned = findOwnedCharacter(playerId, uid, db);
  if (!owned) return;
  const equipment: Partial<Record<EquipmentSlot, string>> = { ...(owned.equipment ?? {}) };
  if (equipmentUid) equipment[slot] = equipmentUid;
  else delete equipment[slot];
  const hasAny = Object.keys(equipment).length > 0;
  db.prepare('UPDATE owned_characters SET equipment = ? WHERE player_id = ? AND uid = ?')
    .run(hasAny ? JSON.stringify(equipment) : null, playerId, uid);
}

/* ============================================================
 * 素材 / チケット (Phase 3/5)
 * ========================================================== */

export function listMaterials(playerId: string, db: Db = getDb()): MaterialStack[] {
  const rows = db
    .prepare('SELECT material_id, count FROM materials WHERE player_id = ? AND count > 0 ORDER BY material_id ASC')
    .all(playerId) as { material_id: string; count: number }[];
  return rows.map((r) => ({ id: r.material_id, count: r.count }));
}

export function getMaterialCount(playerId: string, materialId: string, db: Db = getDb()): number {
  const row = db
    .prepare('SELECT count FROM materials WHERE player_id = ? AND material_id = ?')
    .get(playerId, materialId) as { count: number } | undefined;
  return row?.count ?? 0;
}

/**
 * 所持数を増減する(負の delta で消費)。0未満にはならない。
 *
 * **バグ修正(第4ラウンドで発見)**: 以前は `ON CONFLICT ... DO UPDATE SET count = MAX(0, count + excluded.count)`
 * だったため、負の delta(消費)が既存行に対して一切効かなかった。`excluded.count` は
 * 「INSERT側で提案された値」(= `MAX(0, delta)` で既に0に丸められた後の値)を指すため、
 * delta が負の場合は常に `excluded.count = 0` になり、`count + 0 = count` で減らせていなかった。
 * (INSERT新規行の場合は `MAX(0, delta)` がそのまま入るため負のdeltaで新規行を作る分には
 * 問題なかったが、既存の所持数を消費する処理――ガチャのチケット消費・転生の素材消費など――が
 * 実質的に無効化されていた。今回 `AKATAN_DB_PATH` を使った実機確認で発覚した。)
 * 修正: UPDATE側で `excluded.count` ではなく生の `delta` を直接使うよう、パラメータを2回束縛する。
 */
export function addMaterial(playerId: string, materialId: string, delta: number, db: Db = getDb()): void {
  if (!delta) return;
  db.prepare(
    `INSERT INTO materials (player_id, material_id, count) VALUES (?, ?, MAX(0, ?))
     ON CONFLICT(player_id, material_id) DO UPDATE SET count = MAX(0, count + ?)`,
  ).run(playerId, materialId, delta, delta);
}

/* ============================================================
 * ガチャ天井 (Phase 5)
 * ========================================================== */

export function getPityCounter(playerId: string, bannerId: string, db: Db = getDb()): number {
  const row = db
    .prepare('SELECT counter FROM gacha_pity WHERE player_id = ? AND banner_id = ?')
    .get(playerId, bannerId) as { counter: number } | undefined;
  return row?.counter ?? 0;
}

export function listPityCounters(playerId: string, db: Db = getDb()): Record<string, number> {
  const rows = db
    .prepare('SELECT banner_id, counter FROM gacha_pity WHERE player_id = ?')
    .all(playerId) as { banner_id: string; counter: number }[];
  const out: Record<string, number> = {};
  for (const r of rows) out[r.banner_id] = r.counter;
  return out;
}

export function setPityCounter(playerId: string, bannerId: string, counter: number, db: Db = getDb()): void {
  db.prepare(
    `INSERT INTO gacha_pity (player_id, banner_id, counter) VALUES (?, ?, ?)
     ON CONFLICT(player_id, banner_id) DO UPDATE SET counter = excluded.counter`,
  ).run(playerId, bannerId, Math.max(0, Math.floor(counter || 0)));
}

/* ============================================================
 * レイドバトル (第5ラウンド。設計書§28〜§29)
 * ========================================================== */

interface RaidStateRow {
  player_id: string;
  boss_id: string;
  remaining_hp: number;
  total_hp: number;
  attempts: number;
  total_damage: number;
  defeated: number;
  clears: number | null;
  triggered_gimmicks: string | null;
  updated_at: string;
}

function toRaidState(row: RaidStateRow): RaidState {
  return {
    bossId: row.boss_id,
    remainingHp: row.remaining_hp,
    totalHp: row.total_hp,
    attempts: row.attempts,
    totalDamage: row.total_damage,
    defeated: row.defeated === 1,
    clears: row.clears ?? 0,
    triggeredGimmicks: parseJson<string[]>(row.triggered_gimmicks, []),
    updatedAt: row.updated_at,
  };
}

/** 未挑戦(行が無い)なら null を返す。呼び出し側で初期状態(remainingHp = totalHp)を組み立てること。 */
export function findRaidState(playerId: string, bossId: string, db: Db = getDb()): RaidState | null {
  const row = db
    .prepare('SELECT * FROM raid_states WHERE player_id = ? AND boss_id = ?')
    .get(playerId, bossId) as RaidStateRow | undefined;
  return row ? toRaidState(row) : null;
}

/** playerId が挑戦済みの全ボスの進行状況(ボスID -> RaidState) */
export function listRaidStates(playerId: string, db: Db = getDb()): Map<string, RaidState> {
  const rows = db
    .prepare('SELECT * FROM raid_states WHERE player_id = ?')
    .all(playerId) as RaidStateRow[];
  return new Map(rows.map((r) => [r.boss_id, toRaidState(r)]));
}

/** 作成 or 更新(冪等)。挑戦のたびにこれを呼んで進行状況を丸ごと書き戻す。 */
export function saveRaidState(playerId: string, state: RaidState, db: Db = getDb()): void {
  db.prepare(
    `INSERT INTO raid_states
       (player_id, boss_id, remaining_hp, total_hp, attempts, total_damage, defeated, clears, triggered_gimmicks, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id, boss_id) DO UPDATE SET
       remaining_hp = excluded.remaining_hp,
       total_hp = excluded.total_hp,
       attempts = excluded.attempts,
       total_damage = excluded.total_damage,
       defeated = excluded.defeated,
       clears = excluded.clears,
       triggered_gimmicks = excluded.triggered_gimmicks,
       updated_at = excluded.updated_at`,
  ).run(
    playerId,
    state.bossId,
    state.remainingHp,
    state.totalHp,
    state.attempts,
    state.totalDamage,
    state.defeated ? 1 : 0,
    state.clears ?? 0,
    JSON.stringify(state.triggeredGimmicks ?? []),
    state.updatedAt ?? new Date().toISOString(),
  );
}

/* ============================================================
 * トランザクションヘルパ
 * ========================================================== */

/** 複数の書き込みを 1 トランザクションにまとめる(報酬付与など) */
export function inTransaction<T>(fn: () => T, db: Db = getDb()): T {
  return db.transaction(fn)();
}
