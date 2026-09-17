# あかたんLegends API リファレンス (Phase 1 / MVP)

バックエンド担当が提供する HTTP API の仕様。型の正本は `shared/src/api.ts` / `shared/src/types.ts`。
本ドキュメントはその契約の説明と実レスポンス例。

- ベースURL: `http://localhost:8787/api` (開発時。Vite が `/api` をここへプロキシ)
- ポート変更: 環境変数 `PORT`
- データディレクトリ変更: 環境変数 `AKATAN_DATA_DIR` (既定: リポジトリの `data/`)
- DBファイル変更: 環境変数 `AKATAN_DB_PATH` (既定: `server/data.db`、`:memory:` も可)

---

## 0. 共通仕様

### レスポンス封筒

全エンドポイントが `ApiResponse<T>` で返る。

```jsonc
// 成功
{ "ok": true, "data": { /* エンドポイントごとの型 */ } }

// 失敗
{ "ok": false, "error": { "code": "PARTY_INVALID", "message": "...", "details": null } }
```

### エラーコードと HTTP ステータス

| code | HTTP | 意味 |
|---|---|---|
| `BAD_REQUEST` | 400 | 入力のバリデーション失敗(型・必須・長さ) |
| `PARTY_EMPTY` | 400 | パーティに1体も編成されていない |
| `PARTY_INVALID` | 400 | 重複編成・未所持キャラ・枠数超過 |
| `NOT_FOUND` | 404 | ステージ/キャラ/エンドポイントが存在しない |
| `STAGE_LOCKED` | 403 | (Phase 2 予約) 未解放ステージ |
| `INTERNAL` | 500 | サーバ内部エラー。**スタックはサーバログのみ**、レスポンスには出さない |

バリデーションは zod を使わず自前実装 (`server/src/routes/_helpers.ts`)。
JSON パース失敗も `BAD_REQUEST` に変換される。

### プレイヤー識別

MVP では認証を作らず、固定の `player_id = 'local'` を使う。
ただし DB リポジトリ層 (`server/src/db/repository.ts`) とサービス層はすべて `playerId` を
引数で受け取るため、`routes/_helpers.ts` の `currentPlayerId()` をセッション解決に差し替えるだけで
マルチプレイヤー化できる。

---

## 1. サーバ権威の方針 (設計書 §37)

**クライアントから来た数値は一切信用しない。**

| 項目 | 誰が決めるか | 実装箇所 |
|---|---|---|
| キャラの最終ステータス | サーバ (`baseStats + growth*(level-1)`) | `services/progression.ts: computeStats()` |
| レベル / EXP | サーバ (DBの値 + ステージ報酬) | `services/progression.ts: applyExp()` |
| 敵の構成・レベル | サーバ (ステージ定義から再構築) | `services/battle-service.ts: buildEnemies()` |
| 乱数シード | サーバ生成。リクエストでの指定は受け付けない | `services/battle-service.ts: generateSeed()` |
| ダメージ・戦闘結果 | サーバ (戦闘エンジンを server 上で実行) | `server/src/battle/**` |
| 報酬 (EXP/ゴールド) | サーバ (ステージ定義の `rewards`) | `services/battle-service.ts: grantRewards()` |
| 所持キャラの検証 | サーバ (DB 照合) | `services/party-service.ts: validateMembers()` |

`POST /api/battle/start` がクライアントから受け取るのは **`stageId` と編成の `uid` だけ**。
編成に含まれる `uid` は必ず DB でそのプレイヤーの所持キャラかを検証し、保存済みパーティ経由の場合も
再確認する。ダメージ・報酬・レベルアップ値をクライアントが送っても完全に無視される。

---

## 2. エンドポイント

### GET /api/health

死活監視とマスタ件数。初期化されていなくても 200 を返す。
(この応答だけは、単純なヘルスチェックからも読めるようトップレベルに `status` も持つ)

```bash
curl -s localhost:8787/api/health
```

```json
{
  "ok": true,
  "status": "ok",
  "data": {
    "dataDir": "/home/user/TokyoXtremeRacer-UEProject/akatan-legends/data",
    "characters": 10,
    "skills": 78,
    "enemies": 0,
    "aiProfiles": 0,
    "chapters": 0,
    "stages": 0,
    "warnings": 11,
    "schemaVersion": 1,
    "battleEngine": "ready",
    "loadedAt": "2026-09-17T12:16:06.817Z"
  }
}
```

- `battleEngine`: `ready` = `server/src/battle/index.ts` の `runBattle` をロード済み /
  `fallback` = 未実装のため暫定エンジンを使用中。
- `warnings`: 起動時のデータ不整合件数。詳細はサーバログに出る。

---

### GET /api/player

`PlayerStateResponse` を返す。**初回アクセス時にプレイヤーを自動作成し、スターターキャラを付与する。**

- スターター: `data/characters/` からレアリティが偏らないように 5〜7 体
  (レアリティ別バケットを N→R→SR→SSR→UR のラウンドロビンで拾う。決定論的)
- パーティ: 付与したキャラの先頭 5 体で自動編成
- データが 0 件でも 0 体で作成され、200 を返す

```bash
curl -s localhost:8787/api/player
```

```json
{
  "ok": true,
  "data": {
    "player": {
      "id": "local",
      "name": "あかたん提督",
      "gold": 1000,
      "stamina": 0,
      "createdAt": "2026-09-17T12:15:19.829Z",
      "clearedStages": []
    },
    "characters": [
      {
        "owned": {
          "uid": "ch_997b560b-0a2b-444b-9e7f-467b405f9cff",
          "defId": "momiji",
          "level": 1,
          "exp": 0,
          "rebirth": 0,
          "obtainedAt": "2026-09-17T12:15:19.839Z",
          "aiProfile": "ai_momiji_support"
        },
        "def": { "id": "momiji", "name": "紅葉", "rarity": "SR", "element": "FIRE", "...": "CharacterDef 全体" },
        "stats": { "hp": 760, "attack": 96, "defense": 62, "speed": 108, "critical": 12, "criticalDamage": 150, "resistance": 8, "healing": 100 },
        "expToNext": 30,
        "skills": [ { "id": "sk_momiji_...", "...": "Skill 全体" } ],
        "normalAttack": { "id": "na_momiji_...", "...": "Skill" },
        "ultimate": { "id": "ult_momiji_...", "...": "Skill" }
      }
    ],
    "party": {
      "id": "main",
      "name": "メインパーティ",
      "members": ["ch_fcad...", "ch_997b...", "ch_c55c...", "ch_8def...", null]
    }
  }
}
```

`stats` と `expToNext` は **サーバが計算した値** であり、クライアントは表示にのみ使う。
マスタに定義が無くなった所持キャラは警告ログを出して一覧から除外される(500 にはしない)。

---

### GET /api/characters

`CharacterListResponse`。`/api/player` の `characters` と同一内容。

```bash
curl -s localhost:8787/api/characters
```

```json
{ "ok": true, "data": { "characters": [ /* CharacterView[] */ ] } }
```

---

### GET /api/master

`MasterDataResponse`。図鑑/UI表示用の読み取り専用マスタ一括取得。

```bash
curl -s localhost:8787/api/master
```

```json
{
  "ok": true,
  "data": {
    "characters": [ /* CharacterDef[] */ ],
    "enemies":    [ /* EnemyDef[] */ ],
    "skills":     [ /* Skill[] */ ],
    "aiProfiles": [ /* AiProfile[] */ ],
    "chapters":   [ /* ChapterDef[] (stages 入り) */ ]
  }
}
```

実測件数の例: `{"characters": 4, "enemies": 1, "skills": 78, "aiProfiles": 1, "chapters": 1}`

---

### GET /api/dungeons

`DungeonListResponse`。チャプター一覧とクリア済みステージID。

```bash
curl -s localhost:8787/api/dungeons
```

```json
{
  "ok": true,
  "data": {
    "chapters": [
      { "id": "ch_test", "name": "テスト章", "stages": [ { "id": "st_test_1", "name": "テスト1", "enemies": [...], "rewards": { "exp": 500, "gold": 120 } } ] }
    ],
    "clearedStages": ["st_test_1"]
  }
}
```

---

### PUT /api/party

`UpdatePartyRequest` → `UpdatePartyResponse`。

検証ルール(すべてサーバ側):

1. `members` は配列。長さは最大 5 (`PARTY_SIZE`)。足りない分は `null` 埋めして保存する。
2. 各要素は `string` (キャラの `uid`) または `null`。
3. 同じ `uid` を 2 枠以上に入れられない。
4. `uid` は **そのプレイヤーの所持キャラ** でなければならない (DB照合)。
5. 全枠 `null` の空編成は拒否 (`PARTY_EMPTY`)。

```bash
curl -s -X PUT localhost:8787/api/party \
  -H 'content-type: application/json' \
  -d '{"members":["ch_997b...","ch_c55c...","ch_fcad..."]}'
```

```json
{
  "ok": true,
  "data": {
    "party": {
      "id": "main",
      "name": "メインパーティ",
      "members": ["ch_997b560b-...", "ch_c55c103b-...", "ch_fcad8a49-...", null, null]
    }
  }
}
```

エラー例:

```bash
# 重複編成
curl -s -X PUT localhost:8787/api/party -H 'content-type: application/json' \
  -d '{"members":["ch_997b...","ch_997b..."]}'
# HTTP 400
{"ok":false,"error":{"code":"PARTY_INVALID","message":"同じキャラクターを複数枠に編成できません: ch_997b..."}}

# 未所持
curl -s -X PUT localhost:8787/api/party -H 'content-type: application/json' -d '{"members":["nope"]}'
# HTTP 400
{"ok":false,"error":{"code":"PARTY_INVALID","message":"所持していないキャラクターです: nope"}}
```

---

### PUT /api/characters/:uid/ai

`UpdateAiRequest` → 更新後の `CharacterView`。

- `uid` は所持キャラでなければ 404。
- `aiProfile` はマスタに存在する ID でなければ 400。
  ただし **`data/ai/` がまだ 0 件のときは実在チェックをスキップ** する
  (データ担当の作業中でも API を止めないため)。

```bash
curl -s -X PUT localhost:8787/api/characters/ch_997b.../ai \
  -H 'content-type: application/json' -d '{"aiProfile":"ai_test_aggressive"}'
```

```json
{
  "ok": true,
  "data": {
    "owned": {
      "uid": "ch_997b560b-0a2b-444b-9e7f-467b405f9cff",
      "defId": "momiji", "level": 4, "exp": 229, "rebirth": 0,
      "obtainedAt": "2026-09-17T12:15:19.839Z",
      "aiProfile": "ai_test_aggressive"
    },
    "def": { "...": "CharacterDef" },
    "stats": { "...": "再計算済み Stats" },
    "expToNext": 120,
    "skills": [], "normalAttack": {}, "ultimate": {}
  }
}
```

エラー例:

```json
// 存在しないAI -> HTTP 400
{"ok":false,"error":{"code":"BAD_REQUEST","message":"存在しないAIプロファイルです: bogus"}}
// 未所持uid -> HTTP 404
{"ok":false,"error":{"code":"NOT_FOUND","message":"所持していないキャラクターです: xxx"}}
```

---

### POST /api/battle/start

`BattleStartRequest` → `BattleStartResponse`。**このAPIの本体はサーバ権威処理。**

リクエストで受け付けるのは以下 2 つだけ:

| フィールド | 必須 | 説明 |
|---|---|---|
| `stageId` | ○ | ステージID。マスタに無ければ 404 |
| `members` | — | `(string\|null)[]`。省略時は保存済みパーティを使う。指定時も所持チェックを行う |

処理の流れ:

1. ステージをマスタから解決
2. 編成 uid を検証(所持チェック・重複チェック)
3. 味方 `CombatantInput` を構築(**DBのレベル + マスタの成長率から再計算**)
4. 敵 `CombatantInput` を構築(`baseStats + growth*(level-1)`)
5. サーバ側でシード生成 → `runBattle(allies, enemies, ctx)` を実行
6. **勝利時のみ** 報酬確定 → EXP配分 / ゴールド加算 / クリア記録
7. 戦闘ログを保存(プレイヤーごとに直近 50 件)

```bash
curl -s -X POST localhost:8787/api/battle/start \
  -H 'content-type: application/json' -d '{"stageId":"st_test_1"}'
```

```json
{
  "ok": true,
  "data": {
    "log": {
      "id": "btl_b580gb",
      "seed": 673899851,
      "stageId": "st_test_1",
      "createdAt": "2026-09-17T12:15:40.001Z",
      "units": [ /* BattleUnit[] 開始時スナップショット */ ],
      "events": [ /* BattleEvent[] (BATTLE_START / TURN_START / SKILL_USE / DAMAGE / STATUS_APPLY / DEFEAT / ACTION_END / BATTLE_END ...) */ ],
      "result": {
        "victory": true,
        "ticks": 78,
        "turns": 30,
        "stats": [ /* BattleUnitStat[] */ ],
        "rewards": { "exp": 500, "gold": 120, "levelUps": [ /* 下と同じ */ ] }
      }
    },
    "rewards": {
      "exp": 500,
      "gold": 120,
      "levelUps": [
        {
          "uid": "ch_997b560b-0a2b-444b-9e7f-467b405f9cff",
          "name": "紅葉",
          "fromLevel": 1,
          "toLevel": 4,
          "expGained": 500,
          "statGain": { "hp": 180, "attack": 19, "defense": 14, "speed": 3, "resistance": 1.2 }
        }
      ]
    },
    "player": {
      "id": "local", "name": "あかたん提督", "gold": 1120, "stamina": 0,
      "createdAt": "2026-09-17T12:15:19.829Z",
      "clearedStages": ["st_test_1"]
    },
    "characters": [ /* 戦闘後の最新 CharacterView[] */ ],
    "stage": { "id": "st_test_1", "name": "テスト1", "enemies": [...], "rewards": { "exp": 500, "gold": 120 } }
  }
}
```

敗北時は `rewards: null`、`log.result.victory: false`、プレイヤーのゴールド/レベルは変化しない。
ログは勝敗にかかわらず保存される。

エラー例:

```json
// ステージ不明 -> HTTP 404
{"ok":false,"error":{"code":"NOT_FOUND","message":"ステージが見つかりません: nope"}}
// stageId 欠落 -> HTTP 400
{"ok":false,"error":{"code":"BAD_REQUEST","message":"stageId は必須の文字列です"}}
// 空編成 -> HTTP 400
{"ok":false,"error":{"code":"PARTY_EMPTY","message":"パーティにキャラクターが編成されていません"}}
```

---

## 3. 育成計算

### 最終ステータス

```
stat = baseStats[key] + growth[key] * (level - 1)
     + rebirthPoints[key]     (Phase 2: 転生ポイント)
     + equipmentFlat[key]     (Phase 2: 装備)
     * limitBreak 補正         (Phase 2: 限界突破 / 現状は係数 0 で無効)
```

Phase 1 では **level と growth のみ** 反映する。拡張点は
`server/src/services/progression.ts` の `computeStats()` にコメントで明示してある。
`hp / attack / defense / speed` は整数丸め、`critical / criticalDamage / resistance / healing` は
小数1桁まで保持する。

### EXP テーブル

`data/system/progression.json` の `expCurve` から算出する。

```
expToNext(level) = round(base * level ^ exponent)     (level < levelCap)
expToNext(levelCap) = 0
```

- レベルアップは繰り上がりループで **一度に複数レベル上がることを許容** する。
- `levelCap` で頭打ちになり、**上限到達後の余剰EXPは捨てる** (`exp = 0` 固定)。

### EXP 配分

ステージ `rewards.exp` を **生存/戦闘不能を問わず出撃した全員に同額** 配る。

理由:

- 完全オート戦闘のため「誰が落ちるか」をプレイヤーが操作でコントロールできない。
  戦闘不能を減EXPで罰すると、育っていないキャラがさらに育たない負のループになる。
- 控えメンバーには配らないので「編成して出す」動機は保たれる。

将来、与ダメージや生存に応じた傾斜配分を入れる場合は `grantBattleExp()` に
`BattleUnitStat[]` を末尾引数で追加する(既存呼び出しを壊さないため)。

---

## 4. データローダ

`server/src/data/loader.ts` が起動時に `data/` を読み、メモリにキャッシュする。

| 置き場所 | 期待する内容 |
|---|---|
| `data/characters/*.json` | `CharacterDef` 単体 または 配列 |
| `data/skills/*.json` | `Skill[]` |
| `data/enemies/*.json` | `EnemyDef[]` |
| `data/ai/*.json` | `AiProfile[]` |
| `data/dungeons/*.json` | `ChapterDef` 単体 または 配列 |
| `data/system/affinity.json` | `AffinityTable` |
| `data/system/progression.json` | `ProgressionConfig` |

- **寛容なパース**: 単一オブジェクト / 配列 / `{ "items": [...] }` 等のラッパ、BOM付きJSON、
  サブディレクトリの再帰探索すべてに対応。
- **落ちない**: ファイル欠損・空ファイル・JSON破損・ID重複・参照切れはすべて起動時の警告ログに留め、
  サーバは起動する。データが 0 件でも全エンドポイントが 200 を返す。
- ID重複は **先に読んだ定義が勝つ**(ファイル名昇順)。
- `progression.json` が欠損/部分的でも既定値でマージされる。
- インデックス: `characters` / `skills` / `enemies` / `aiProfiles` / `chapters` / `stages`
  (`stages` は全チャプター横断の `stageId -> {stage, chapterId}` 平坦インデックス)。

---

## 5. データベース

`better-sqlite3` / ファイルは `server/data.db` (gitignore 済み)。
スキーマはコードで冪等に構築し、`PRAGMA user_version` でマイグレーション管理する
(`server/src/db/index.ts` の `MIGRATIONS` 配列に関数を追加していくだけで拡張可能)。

**SQL は `server/src/db/repository.ts` にのみ書く** (設計書 §36)。
routes / services は必ずリポジトリ層経由で永続化するため、将来 SQLite を差し替えられる。

```sql
CREATE TABLE players (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  gold        INTEGER NOT NULL DEFAULT 0,
  stamina     INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);

CREATE TABLE owned_characters (
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
CREATE INDEX idx_owned_characters_player ON owned_characters(player_id);

CREATE TABLE parties (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  name       TEXT NOT NULL,
  members    TEXT NOT NULL,   -- JSON: (string|null)[] 長さ5
  updated_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX idx_parties_player ON parties(player_id);

CREATE TABLE cleared_stages (
  player_id  TEXT NOT NULL,
  stage_id   TEXT NOT NULL,
  cleared_at TEXT NOT NULL,
  PRIMARY KEY (player_id, stage_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);

CREATE TABLE battle_logs (
  id         TEXT PRIMARY KEY,
  player_id  TEXT NOT NULL,
  stage_id   TEXT,
  seed       INTEGER NOT NULL,
  victory    INTEGER NOT NULL,
  log_json   TEXT NOT NULL,   -- BattleLog 全体 (将来のリプレイ用)
  created_at TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX idx_battle_logs_player_created ON battle_logs(player_id, created_at DESC);
```

`battle_logs` はプレイヤーごとに **直近 50 件** だけ残す(挿入と同一トランザクションで超過分を削除)。
リプレイ API (`GET /api/battle/logs` 等) は Phase 2 で追加予定。リポジトリ層には
`findBattleLog()` / `listBattleLogSummaries()` を実装済み。

---

## 6. 戦闘エンジンとの結合

- エンジンは `server/src/battle/index.ts` から `runBattle` を
  `RunBattle` 署名 (`server/src/battle/contract.ts`) で export する。
- API 層は `server/src/services/battle-engine.ts` 経由でこれを **動的 import** する。
  エンジン未実装でもサーバが起動できるよう、読み込めない場合は通常攻撃のみの
  暫定フォールバックエンジンに自動で切り替わる(`/api/health` の `battleEngine` で判別可能)。
- エンジンに渡す `BattleContext` は
  `{ skills, aiProfiles, affinity, config: progression.battle, seed, stageId }`。
- エンジンは副作用なし・決定論的であることが契約。報酬付与は API 層が行う。
