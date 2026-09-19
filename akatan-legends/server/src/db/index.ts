/**
 * SQLite 接続とマイグレーション
 * ------------------------------------------------------------
 * 設計書 §36: 将来 SQLite 以外へ差し替えられるよう、SQL は repository.ts に集約する。
 * ここは「接続を作る」「スキーマを最新にする」だけを担当する。
 *
 * マイグレーションは PRAGMA user_version で管理する。
 * テーブル追加・カラム追加が必要になったら MIGRATIONS の末尾に関数を push するだけでよい。
 * (既存ユーザの data.db も起動時に自動で最新まで進む)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type Db = Database.Database;

/** server/data.db (gitignore 済み)。AKATAN_DB_PATH で上書き可。`:memory:` もOK */
export function resolveDbPath(): string {
  const fromEnv = process.env.AKATAN_DB_PATH;
  if (fromEnv) return fromEnv === ':memory:' ? fromEnv : path.resolve(fromEnv);
  // server/src/db/index.ts -> server/data.db
  return path.resolve(__dirname, '../../data.db');
}

/* ============================================================
 * マイグレーション
 * ========================================================== */

/**
 * 各マイグレーションは「user_version が index と同じとき」に実行され、
 * 終了後に user_version = index + 1 になる。
 * 一度リリースしたマイグレーションは書き換えず、必ず末尾に追加すること。
 */
const MIGRATIONS: ((db: Db) => void)[] = [
  // v0 -> v1: 初期スキーマ
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS players (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        gold        INTEGER NOT NULL DEFAULT 0,
        stamina     INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS owned_characters (
        uid            TEXT PRIMARY KEY,
        player_id      TEXT NOT NULL,
        def_id         TEXT NOT NULL,
        level          INTEGER NOT NULL DEFAULT 1,
        exp            INTEGER NOT NULL DEFAULT 0,
        rebirth        INTEGER NOT NULL DEFAULT 0,
        rebirth_points TEXT,
        limit_break    INTEGER NOT NULL DEFAULT 0,
        equipment      TEXT,
        ai_profile     TEXT,
        obtained_at    TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_owned_characters_player
        ON owned_characters(player_id);

      CREATE TABLE IF NOT EXISTS parties (
        id         TEXT PRIMARY KEY,
        player_id  TEXT NOT NULL,
        name       TEXT NOT NULL,
        members    TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_parties_player ON parties(player_id);

      CREATE TABLE IF NOT EXISTS cleared_stages (
        player_id  TEXT NOT NULL,
        stage_id   TEXT NOT NULL,
        cleared_at TEXT NOT NULL,
        PRIMARY KEY (player_id, stage_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS battle_logs (
        id         TEXT PRIMARY KEY,
        player_id  TEXT NOT NULL,
        stage_id   TEXT,
        seed       INTEGER NOT NULL,
        victory    INTEGER NOT NULL,
        log_json   TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_battle_logs_player_created
        ON battle_logs(player_id, created_at DESC);
    `);
  },
  // v1 -> v2: Phase 3 (ハクスラ) / Phase 5 (ガチャ)
  //   - equipment: 生成済み装備インスタンス(EquipmentInstance)の永続化
  //   - materials: 素材(チケット含む)の所持数。playerId + materialId で1行
  //   - gacha_pity: バナーごとの天井カウンタ
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS equipment (
        uid            TEXT PRIMARY KEY,
        player_id      TEXT NOT NULL,
        base_id        TEXT NOT NULL,
        slot           TEXT NOT NULL,
        rarity         TEXT NOT NULL,
        name           TEXT NOT NULL,
        item_level     INTEGER NOT NULL DEFAULT 1,
        prefix_id      TEXT,
        suffix_id      TEXT,
        stats          TEXT NOT NULL,
        stats_percent  TEXT,
        special        TEXT,
        enhance_level  INTEGER NOT NULL DEFAULT 0,
        seed           INTEGER,
        equipped_by    TEXT,
        obtained_at    TEXT NOT NULL,
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_equipment_player ON equipment(player_id);
      CREATE INDEX IF NOT EXISTS idx_equipment_equipped_by ON equipment(equipped_by);

      CREATE TABLE IF NOT EXISTS materials (
        player_id   TEXT NOT NULL,
        material_id TEXT NOT NULL,
        count       INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, material_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS gacha_pity (
        player_id TEXT NOT NULL,
        banner_id TEXT NOT NULL,
        counter   INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (player_id, banner_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
    `);
  },
  // v2 -> v3: 転生システム(第4ラウンド。設計書§17〜§20)
  //   - owned_characters.rebirth_nodes: 転生ノードの取得状況(JSON: ノードID -> ランク)
  //   - owned_characters.rebirth_points_available: 未使用の転生ポイント
  //   既存の rebirth / rebirth_points 列はそのまま残す(旧形式のセーブを壊さないため。
  //   rebirth_points は非推奨だが読み込みだけ継続する。shared/src/types.ts の
  //   OwnedCharacter.rebirthPoints の @deprecated コメント参照)。
  (db) => {
    db.exec(`
      ALTER TABLE owned_characters ADD COLUMN rebirth_nodes TEXT;
      ALTER TABLE owned_characters ADD COLUMN rebirth_points_available INTEGER NOT NULL DEFAULT 0;
    `);
  },
  // v3 -> v4: レイドバトル(第5ラウンド。設計書§28〜§29)
  //   - raid_states: プレイヤーごと・ボスごとの共有HPプールの進行状況
  //     (remaining_hp/total_hp は REAL: ダメージ集計が将来小数を含む計算に変わっても安全なように)
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS raid_states (
        player_id           TEXT NOT NULL,
        boss_id             TEXT NOT NULL,
        remaining_hp        REAL NOT NULL,
        total_hp             REAL NOT NULL,
        attempts             INTEGER NOT NULL DEFAULT 0,
        total_damage          REAL NOT NULL DEFAULT 0,
        defeated               INTEGER NOT NULL DEFAULT 0,
        triggered_gimmicks      TEXT,
        updated_at                TEXT NOT NULL,
        PRIMARY KEY (player_id, boss_id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
    `);
  },
  // v4 -> v5 以降はここに追記する

  // --- v4 -> v5 ---
  //   - raid_states.clears: 討伐回数。
  //     周回可能なレイドでは撃破のたびにHPが満タンへ戻るので、
  //     「何回倒したか」を別に持たないと実績が残らない。
  (db) => {
    const cols = db.prepare('PRAGMA table_info(raid_states)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'clears')) {
      db.exec('ALTER TABLE raid_states ADD COLUMN clears INTEGER NOT NULL DEFAULT 0');
    }
  },

  // --- v5 -> v6 (第6ラウンド: 装備のお気に入り / 一括売却) ---
  //   - equipment.favorite: 0/1。true の装備は一括売却(sell-bulk)から必ず除外される。
  //     既存行は 0(お気に入りなし)のまま起動できる。
  (db) => {
    const cols = db.prepare('PRAGMA table_info(equipment)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'favorite')) {
      db.exec('ALTER TABLE equipment ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0');
    }
  },

  // --- v6 -> v7 (オンラインPvP: あいことば対戦) ---
  //   - pvp_rooms: あいことば単位のマッチング部屋。
  //     host が先に入って待機(status=WAITING)、guest が同じあいことばで入った瞬間に
  //     runBattle を1回だけ実行して結果を固定する(status=READY)。
  //     host_party/guest_party/log_json はクライアント申告スナップショットや戦闘ログを
  //     JSON で丸ごと保存する(他テーブルの equipment/materials と同じ方針)。
  //     expires_at で一定時間後に失効させ、古い部屋が残り続けないようにする
  //     (server/src/services/pvp-service.ts の purgeExpiredPvpRooms 参照)。
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS pvp_rooms (
        id               TEXT PRIMARY KEY,
        passphrase       TEXT NOT NULL,
        status           TEXT NOT NULL,
        host_player_id   TEXT NOT NULL,
        host_party       TEXT NOT NULL,
        guest_player_id  TEXT,
        guest_party      TEXT,
        seed             INTEGER,
        log_json         TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL,
        expires_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_pvp_rooms_passphrase_status
        ON pvp_rooms(passphrase, status);
      CREATE INDEX IF NOT EXISTS idx_pvp_rooms_expires
        ON pvp_rooms(expires_at);
    `);
  },

  // --- v7 -> v8 (PvP実装中に発覚した既存バグの修正: parties.id が単独PKだった) ---
  //   v0スキーマでは `parties.id` 単独が PRIMARY KEY だったため、`id` は常に
  //   DEFAULT_PARTY_ID('main')固定の実質シングルトンで、**全プレイヤーが1行を奪い合っていた**。
  //   単一プレイヤー('local'固定)だった間は実害が無かったが、PvPで複数プレイヤーを
  //   同時に扱うようになった瞬間、後から作成したプレイヤーの saveParty が
  //   `ON CONFLICT(id)` で先行プレイヤーの行を書き換えてしまい、編成が別プレイヤーの
  //   ものに化ける(最悪、互いの編成を上書きし合う)実データ破損バグとして表面化した。
  //   主キーを (player_id, id) の複合キーへ直す。SQLite は主キーの直接変更ができないため
  //   テーブルを作り直す(id が重複するのは元々このバグの結果そのものなので、
  //   移行時点のデータは「最後に書いた1行」しか残っておらず、失われるのはその1行だけ)。
  (db) => {
    db.exec(`
      CREATE TABLE parties_v8 (
        id         TEXT NOT NULL,
        player_id  TEXT NOT NULL,
        name       TEXT NOT NULL,
        members    TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (player_id, id),
        FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
      );
      INSERT INTO parties_v8 (id, player_id, name, members, updated_at)
        SELECT id, player_id, name, members, updated_at FROM parties;
      DROP TABLE parties;
      ALTER TABLE parties_v8 RENAME TO parties;
      CREATE INDEX IF NOT EXISTS idx_parties_player ON parties(player_id);
    `);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

function migrate(db: Db): { from: number; to: number } {
  const row = db.pragma('user_version', { simple: true }) as number;
  const from = typeof row === 'number' ? row : 0;
  let current = from;
  const runAll = db.transaction(() => {
    for (let i = current; i < MIGRATIONS.length; i += 1) {
      MIGRATIONS[i](db);
      // PRAGMA はプレースホルダを使えないので直接埋め込む(i は内部定数なので安全)
      db.pragma(`user_version = ${i + 1}`);
      current = i + 1;
    }
  });
  runAll();
  return { from, to: current };
}

/* ============================================================
 * 接続
 * ========================================================== */

let instance: Db | null = null;

export interface DbInitResult {
  db: Db;
  path: string;
  migratedFrom: number;
  migratedTo: number;
}

/** 起動時に一度呼ぶ。冪等(何度呼んでも同じ結果)。 */
export function initDb(dbPath = resolveDbPath()): DbInitResult {
  if (instance) {
    return { db: instance, path: dbPath, migratedFrom: SCHEMA_VERSION, migratedTo: SCHEMA_VERSION };
  }
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  const { from, to } = migrate(db);
  instance = db;
  return { db, path: dbPath, migratedFrom: from, migratedTo: to };
}

/** 接続済み DB を取得(未初期化なら初期化する) */
export function getDb(): Db {
  if (!instance) initDb();
  return instance!;
}

/** テスト用: 接続を閉じてシングルトンを破棄する */
export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
