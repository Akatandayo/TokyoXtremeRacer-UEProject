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
import type { BattleLog, OwnedCharacter, Party, PlayerProfile, StatKey } from '@akatan/shared';
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
       (uid, player_id, def_id, level, exp, rebirth, rebirth_points, limit_break, equipment, ai_profile, obtained_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    owned.uid,
    playerId,
    owned.defId,
    owned.level,
    owned.exp,
    owned.rebirth,
    owned.rebirthPoints ? JSON.stringify(owned.rebirthPoints) : null,
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
 * トランザクションヘルパ
 * ========================================================== */

/** 複数の書き込みを 1 トランザクションにまとめる(報酬付与など) */
export function inTransaction<T>(fn: () => T, db: Db = getDb()): T {
  return db.transaction(fn)();
}
