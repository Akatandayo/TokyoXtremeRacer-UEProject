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
| `STAGE_LOCKED` | 400 | **実装済み(第2ラウンド対応)。** `StageDef.unlockAfter` の前提ステージを未クリアで挑戦した |
| `NOT_ENOUGH_CURRENCY` | 400 | **実装済み(第3ラウンド対応)。** ガチャのコスト(GOLD/チケット)が所持数を上回る |
| `SLOT_MISMATCH` | 400 | **実装済み(第3ラウンド対応)。** 装備データ自体の `slot` が不正、または `POST /api/equipment/unequip` の `slot` が `EquipmentSlot` の値でない |
| `ALREADY_EQUIPPED` | 400 | **実装済み(第3ラウンド対応)。** 他キャラが装着中の装備を別キャラへ装着しようとした/装着中の装備を売却しようとした |
| `RAID_DEFEATED` | 400 | **実装済み(第5ラウンド対応)。** 既に撃破済みのレイドボスへ挑戦しようとした |
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
| **装備の中身(ステータス/名前/特殊効果)** | サーバ(**第3ラウンド**。シード付き決定論的生成) | `services/item-generator.ts: rollEquipment()` |
| **戦闘勝利時のドロップ** | サーバ(**第3ラウンド**。勝利時のみ抽選) | `services/drop-service.ts: resolveDrops()` |
| **ガチャの抽選結果・天井・払い戻し** | サーバ(**第3ラウンド**。1トランザクションで残高確認→支払い→付与) | `services/gacha-service.ts: pullGacha()` |
| **装備込みの最終ステータス** | サーバ(装備フラット→%の順で適用) | `services/progression.ts: computeStats() / resolveEquipmentMods()` |
| **レイドの共有HP・ギミック発動・撃破判定** | サーバ(**第5ラウンド**。挑戦のたびに永続化) | `services/raid-service.ts: attackRaidBoss()` |

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
    "combos": 0,
    "warnings": 11,
    "schemaVersion": 1,
    "battleEngine": "ready",
    "loadedAt": "2026-09-17T12:16:06.817Z"
  }
}
```

- `battleEngine`: `ready` = `server/src/battle/index.ts` の `runBattle` をロード済み /
  `fallback` = 未実装のため暫定エンジンを使用中。
- `combos`: `data/combos/*.json` から読み込んだ `ComboDef` の件数(第2ラウンドで追加)。0件でも起動・戦闘は正常に動く。
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
    "chapters":   [ /* ChapterDef[] (stages 入り) */ ],
    "combos":     [ /* ComboDef[] */ ],
    "materials":  [ /* MaterialDef[] — 図鑑・ドロップ演出用(第3ラウンドで追加) */ ],
    "plannedCharacters": [ /* PlannedCharacterDef[] — 未実装キャラのプレースホルダ */ ]
  }
}
```

実測件数の例: `{"characters": 11, "enemies": 13, "skills": 84, "aiProfiles": 24, "chapters": 2, "combos": 7, "materials": 9, "plannedCharacters": 1}`

`combos` / `materials` / `plannedCharacters` はいずれも `shared/src/api.ts` の `MasterDataResponse` に
正式なフィールドとして定義されている(第3ラウンドで確認)。**(P1-1 解消済み)** 第2ラウンド時点では
`combos` が型未定義だったためローカル拡張型でのキャストを使っていたが、第3ラウンドで
`server/src/routes/master.ts` を整理し、正式な `MasterDataResponse` を直接返すようにした。

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

**ステージ開放 (P0-1 / 第2ラウンド)**: 各ステージの `unlockAfter`(前提クリア済みステージID、
省略時は最初から開放)は `StageDef` としてそのまま返している。開放済みかどうかは
クライアントが `unlockAfter` が `clearedStages` に含まれるかで判定できる。
サーバ側で計算済みのフラグ(例: `unlocked: boolean`)を型に持たせたい場合は
`shared/src/api.ts` の `DungeonListResponse`(または `StageDef`)への追加が必要になるため、
現状は変更していない(統括への要望として別途報告)。
**実際の挑戦拒否は必ずサーバ権威で行われる**(`POST /api/battle/start` が `STAGE_LOCKED` を返す)ので、
この画面表示はあくまでUIヒントであり、クライアントのボタン制御に安全性は依存していない。

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
- **(P1-3 / 第2ラウンド) `playerSelectable !== true` のAIプロファイルへの変更を拒否する。**
  `AiProfile.playerSelectable` が `true` でないプロファイル(敵・ボス専用AI)を直接APIで
  設定することはできない(クライアントのID接頭辞フィルタに依存しないサーバ権威の穴埋め)。
  **移行期の配慮**: マスタ全体で `playerSelectable` を1件も持つプロファイルが無い間は、
  この制限を適用せず従来通り全プロファイルを許可する(データ担当がフラグを付与中でも
  API 越しの検証ができなくなることを避けるため)。1件でも付与されたら、以後は
  明示的に `playerSelectable: true` のものだけを許可する。

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
// 敵/ボス専用AIへの変更 (P1-3) -> HTTP 400 (playerSelectable が1件でも付与されている場合のみ)
{"ok":false,"error":{"code":"BAD_REQUEST","message":"このAIプロファイルはプレイヤーが選択できません(敵/ボス専用): ai_boss_gigant"}}
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
2. **(P0-1 / 第2ラウンド) ステージ開放チェック。** `StageDef.unlockAfter` が設定されていて
   かつ未クリアなら `STAGE_LOCKED` (400) を返して処理を中断する
   (`services/battle-service.ts: assertStageUnlocked()`)。クライアントのボタン制御には依存しない。
3. 編成 uid を検証(所持チェック・重複チェック)
4. 味方 `CombatantInput` を構築(**DBのレベル + マスタの成長率から再計算**。`tags` も
   `CharacterDef.tags` からそのまま渡す — TAGコンボ判定用)
5. 敵 `CombatantInput` を構築(`baseStats + growth*(level-1)`)
6. サーバ側でシード生成・時刻確定 → `runBattle(allies, enemies, ctx)` を実行
   (`ctx.combos` に読み込み済みコンボ定義、`ctx.now` に確定済み時刻を渡す。詳細は§6)
7. **勝利時のみ** 報酬確定 → EXP配分(生存/戦闘不能で傾斜。§3参照) / ゴールド加算 / クリア記録
8. 戦闘ログを保存(プレイヤーごとに直近 50 件)

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
    "stage": { "id": "st_test_1", "name": "テスト1", "enemies": [...], "rewards": { "exp": 500, "gold": 120 } },
    "drops": {
      "gold": 22,
      "equipment": [ { "uid": "eq_...", "baseId": "acc_worn_notebook", "slot": "ACCESSORY", "rarity": "UNCOMMON", "name": "書き込みだらけの手帳の活力", "itemLevel": 1, "stats": { "hp": 77, "healing": 9.2 }, "statsPercent": { "speed": 1 }, "suffixId": "sx_vitality", "seed": 968129164 } ],
      "materials": [],
      "characters": [],
      "tickets": []
    },
    "inventory": { "equipment": [ /* InventoryResponse.equipment (ドロップ後の最新値) */ ], "materials": [], "tickets": [] }
  }
}
```

敗北時は `rewards: null`、`log.result.victory: false`、プレイヤーのゴールド/レベルは変化しない。
ログは勝敗にかかわらず保存される。
**`drops` も勝利時のみ抽選される**(第3ラウンド。`services/drop-service.ts: resolveDrops()`)。
`stage.rewards.dropTable` が未設定、またはマスタに該当テーブルが無い場合は
空の `DropResult`(`gold:0` 他すべて空配列)を返すだけで、戦闘自体は失敗しない。
`itemLevel` はそのステージの敵配置の最大レベル(`StageDef.enemies[].level`)を使う。

エラー例:

```json
// ステージ不明 -> HTTP 404
{"ok":false,"error":{"code":"NOT_FOUND","message":"ステージが見つかりません: nope"}}
// stageId 欠落 -> HTTP 400
{"ok":false,"error":{"code":"BAD_REQUEST","message":"stageId は必須の文字列です"}}
// 空編成 -> HTTP 400
{"ok":false,"error":{"code":"PARTY_EMPTY","message":"パーティにキャラクターが編成されていません"}}
// 未開放ステージ (P0-1) -> HTTP 400
{"ok":false,"error":{"code":"STAGE_LOCKED","message":"このステージはまだ開放されていません。先に 'ch1-1' をクリアしてください。","details":{"stageId":"ch1-2","unlockAfter":"ch1-1"}}}
```

---

### GET /api/inventory

`InventoryResponse`。所持装備・素材・チケットの一覧。

- `materials` と `tickets` は同じ DB テーブル(`materials`)から取得するが、
  `data/gacha/banners.json` の `cost(10).ticketId` と `data/items/droptables/*.json` の
  `SUMMON_TICKET` エントリが参照している素材IDを「チケット」として振り分ける
  (`GameData.ticketMaterialIds`。`server/src/data/loader.ts`)。`MaterialDef` 自体には
  種別を示すフィールドが無いため、この逆引きで判定している(詳細は §7)。

```bash
curl -s localhost:8787/api/inventory
```

```json
{
  "ok": true,
  "data": {
    "equipment": [ { "uid": "eq_...", "baseId": "wpn_bokuto", "slot": "WEAPON", "rarity": "COMMON", "name": "古びた木刀", "itemLevel": 1, "stats": { "attack": 12 }, "seed": 424242 } ],
    "materials": [ { "id": "mat_dup_fragment_low", "count": 2 } ],
    "tickets": [ { "id": "ticket_summon_standard", "count": 1 } ]
  }
}
```

---

### POST /api/equipment/equip

`EquipRequest` → `EquipResponse`。実装は `server/src/services/equipment-service.ts: equipItem()`。

検証(すべてサーバ側):

1. `equipmentUid` / `characterUid` は必須の文字列。
2. `equipmentUid` はそのプレイヤーの所持装備でなければならない(`NOT_FOUND`)。
3. `characterUid` はそのプレイヤーの所持キャラでなければならない(`NOT_FOUND`)。
4. 対象装備が **他キャラに装着中** なら `ALREADY_EQUIPPED`(同じキャラへの再装着はno-opで成功扱い)。
5. 対象キャラの同じスロットに既に別の装備があれば **自動的に外してから付け替える**。
6. 反映後のキャラの `stats` は装備込みで再計算して返す(§3参照)。

```bash
curl -s -X POST localhost:8787/api/equipment/equip -H 'content-type: application/json' \
  -d '{"equipmentUid":"eq_b5108264-...","characterUid":"ch_0bdc99e8-..."}'
```

```json
{
  "ok": true,
  "data": {
    "character": { "owned": { "...": "equipment: {\"WEAPON\":\"eq_b5108264-...\"}" }, "stats": { "attack": 129, "speed": 106, "critical": 15.5, "...": "他は変化なし" } },
    "inventory": { "equipment": [ { "uid": "eq_b5108264-...", "equippedBy": "ch_0bdc99e8-..." } ], "materials": [], "tickets": [] }
  }
}
```

実測(装着前 attack=112/speed=101/critical=15、`{"stats":{"attack":17,"speed":5,"critical":0.5}}` のフラット加算のみを持つ装備を装着):
装着後 `attack=129 / speed=106 / critical=15.5`(すべて期待通りの加算値)。

エラー例:

```json
// 他キャラが装着中 -> HTTP 400
{"ok":false,"error":{"code":"ALREADY_EQUIPPED","message":"この装備は既に他のキャラクターが装着しています: eq_... (equippedBy=ch_...)"}}
```

---

### POST /api/equipment/unequip

`UnequipRequest` → `{ character: CharacterView, inventory: InventoryResponse }`(`shared/src/api.ts` の記述通り、専用の
レスポンス型は無いためこの形で返す)。

- `slot` が `WEAPON` / `ARMOR` / `ACCESSORY` のいずれでもない場合は `SLOT_MISMATCH`。
- 指定スロットに何も装備していなければ何もせず成功扱い(冪等)。

```bash
curl -s -X POST localhost:8787/api/equipment/unequip -H 'content-type: application/json' \
  -d '{"characterUid":"ch_0bdc99e8-...","slot":"WEAPON"}'
```

```json
// 不正なslot -> HTTP 400
{"ok":false,"error":{"code":"SLOT_MISMATCH","message":"slot は WEAPON/ARMOR/ACCESSORY のいずれかである必要があります: HELMET"}}
```

---

### POST /api/equipment/sell

`SellEquipmentRequest` → `SellEquipmentResponse`。

- **装着中の装備は売れない**(先に unequip が必要。`ALREADY_EQUIPPED`)。
- 売却額はレアリティ基準額 × `1 + (itemLevel-1) * 0.05` で決まる暫定バランス値
  (`equipment-service.ts: SELL_BASE_GOLD`)。

```bash
curl -s -X POST localhost:8787/api/equipment/sell -H 'content-type: application/json' \
  -d '{"equipmentUids":["eq_b5108264-..."]}'
```

```json
{ "ok": true, "data": { "gold": 25, "player": { "...": "gold加算後" }, "inventory": { "equipment": [], "materials": [], "tickets": [] } } }
```

```json
// 装着中の装備を売却しようとした -> HTTP 400
{"ok":false,"error":{"code":"ALREADY_EQUIPPED","message":"装着中の装備は売却できません(先に外してください): eq_..."}}
```

---

### GET /api/gacha

`GachaListResponse`。バナー一覧・天井カウンタ・所持チケット。

```bash
curl -s localhost:8787/api/gacha
```

```json
{
  "ok": true,
  "data": {
    "banners": [ /* GachaBannerDef[] (data/gacha/banners.json) */ ],
    "player": { "...": "PlayerProfile" },
    "pityCounters": { "banner_standard_char": 3, "banner_pickup_momiji_kc": 0, "banner_equipment": 0 },
    "tickets": [ { "id": "ticket_summon_standard", "count": 1 } ]
  }
}
```

---

### POST /api/gacha/pull

`GachaPullRequest` → `GachaPullResponse`。**サーバ権威(設計書§37)の中核。**
実装は `server/src/services/gacha-service.ts: pullGacha()`。処理順は §7 参照。

- `count` は `1` または `10` のみ。それ以外は `BAD_REQUEST`。
- コスト不足は `NOT_ENOUGH_CURRENCY`(GOLD/TICKETいずれも)。**残高確認は支払いより前に行い、
  支払い・付与・天井カウンタ更新は1トランザクション**(`repo.inTransaction`)。
- 重複キャラは `duplicate:true` にして素材へ変換(`mat_dup_fragment_low`=N〜SR / `mat_dup_fragment_high`=SSR〜UR。
  §7の実データ規約に合わせている)。

```bash
curl -s -X POST localhost:8787/api/gacha/pull -H 'content-type: application/json' \
  -d '{"bannerId":"banner_standard_char","count":1}'
```

```json
{
  "ok": true,
  "data": {
    "results": [ { "character": { "defId": "yomi", "name": "黄泉", "rarity": "SR", "duplicate": false, "uid": "ch_5dba3108-..." }, "rarity": "SR", "byPity": false } ],
    "player": { "...": "gold -300" },
    "characters": [ /* 更新後の CharacterView[] */ ],
    "inventory": { "...": "InventoryResponse" },
    "pityCounter": 1
  }
}
```

残高不足の実測例(`banner_standard_char` を10連で引こうとし、所持1000ゴールドに対して必要2700ゴールド):

```json
{"ok":false,"error":{"code":"NOT_ENOUGH_CURRENCY","message":"ゴールドが不足しています(必要: 2700 / 所持: 1000)","details":{"currency":"GOLD","required":2700,"owned":1000}}}
```

### GET /api/raid

`RaidListResponse`。レイドボス一覧 + プレイヤーごとの進行状況(`RaidState`)。
未挑戦のボスは DB に行が無いので `remainingHp = totalHp` の初期状態をその場で組み立てて返す
(GET では書き込みを行わない)。実装は `server/src/services/raid-service.ts: getRaidListResponse()`。

```bash
curl -s localhost:8787/api/raid
```

### POST /api/raid/attack

`RaidAttackRequest` → `RaidAttackResponse`。**§10「レイドバトル」参照。**

```bash
curl -s -X POST localhost:8787/api/raid/attack -H 'content-type: application/json' \
  -d '{"bossId":"raid_hitori_stand"}'
```

- 撃破済みボスへの挑戦は `RAID_DEFEATED`(400)。
- `bossId` がマスタに無い場合は `NOT_FOUND`。
- `members` 省略時は保存済みパーティを使う(`battle-service.resolveBattleMembers()` と共通)。

---

## 3. ハクスラ / ガチャ (第3ラウンド)

設計書§37の通り、**装備生成・ドロップ抽選・ガチャ結果はすべてサーバ側で確定させる**。
クライアントから受け取るのは「どのバナーを何回引くか」「どの装備をどのキャラへ付けるか」
という意図だけで、数値やシードそのものは一切受け取らない。

### 3.1 装備生成(`server/src/services/item-generator.ts`)

構造は `Base + Prefix + Suffix + ランダムステータス(ボーナス行) + 特殊効果`。

- **決定論**: `rollEquipment(ctx, { seed, itemLevel, rarity?, slot?, baseId? })` は
  `server/src/battle/rng.ts` の `createRng(seed)`(mulberry32、読み取り専用で再利用)を使い、
  同じ `seed` + 同じ入力なら必ず同じ結果を返す。ロール順序は
  **レアリティ → ベース選択 → Prefix → Suffix → ボーナスステータス行** で固定。
  `EquipmentInstance.seed` に使用シードを保存するので、不具合再現や検算に使える。
  `generateEquipment()` はこれに `uid`/`obtainedAt` を足した実インスタンスを返す(こちらは非決定)。
- **レアリティ別チューニング**(`RARITY_TUNING`。バランス調整用の暫定値、コード側の定数):

  | レアリティ | Prefix/Suffix数 | ボーナス行数 | mainValue倍率 | 特殊効果発動率 |
  |---|---|---|---|---|
  | COMMON | 0 | 0 | ×1.0 | 0% |
  | UNCOMMON | 1(どちらか) | 1 | ×1.15 | 0% |
  | RARE | 2 | 2 | ×1.35 | 20% |
  | EPIC | 2 | 3 | ×1.6 | 45% |
  | LEGENDARY | 2 | 4 | ×1.9 | 75% |
  | MYTHIC | 2 | 5 | ×2.3 | 100% |

  `EquipmentInstance` は `prefixId`/`suffixId` を1個ずつしか持てない構造なので、
  「オプション数」は (a) Prefix/Suffix の有無(0〜2個)と (b) 名前の付かないボーナス
  ステータス行の本数、の2軸で表現している。特殊効果は Prefix/Suffix 自身が
  `AffixDef.special` を持っている場合のみ、上表の確率で「実際に発動」させるかを判定する
  (対象の Affix に special が無ければ何も付かない)。
- **itemLevel 補正**: 主ステータスは `base.mainValue + base.mainPerLevel*(itemLevel-1)`(`mainPerLevel` 省略時は
  `mainValue*0.1` を既定値として使う)。Affix/ボーナス行も `itemLevel` に応じて緩やかに増加する
  (`ITEM_LEVEL_FLAT_SCALE = 0.08` = 1レベルあたり+8%)。
- **表示名**: 実データの Prefix/Suffix 名には既に助詞(「灼熱の」「の活力」)が入っているため、
  `Prefix名 + Base名 + Suffix名` の単純連結で自然な日本語になる
  (例: `px_scorching`(灼熱の) + `wpn_bokuto`(古びた木刀) + `sx_vitality`(の活力)
  → 「灼熱の古びた木刀の活力」)。
- ベース/アフィックス候補が1件も無い(スロット不一致・データ未整備)場合は `null` を返し、
  呼び出し側(drop-service/gacha-service)がそのロールをスキップする。**データが空でも例外を投げない。**

### 3.2 ドロップ抽選(`server/src/services/drop-service.ts`)

- `StageDef.rewards.dropTable` を `data.dropTables` から引き、`DropTableDef.rolls` 回、
  `nothingWeight` を含めた重み付き抽選を行う(**勝利時のみ**。`battle-service.ts: startBattle()`)。
- `kind` ごとの処理:
  - `GOLD` → 所持金へ加算。
  - `EQUIPMENT` → `item-generator` で生成(`entry.slot`/`entry.rarityWeights` を尊重)してインベントリへ。
  - `MATERIAL` / `SUMMON_TICKET` → 素材スタックへ加算。
  - `CHARACTER` → `entry.id` が指定されていればそのキャラ、**省略時は実装済み全キャラから
    ランダムに1体**を抽選する(実データの `dt_ch1_common` 等がこの形。id指定なし)。
    未所持なら付与、既所持なら重複として素材へ変換する(§3.3)。
- すべての DB 書き込みは `repo.inTransaction` で1トランザクションにまとめる
  (better-sqlite3 の SAVEPOINT ベースのネストで、更に外側の戦闘報酬トランザクションと入れ子にできる)。
- `dropTableId` がマスタに無い場合は空の `DropResult` を返すだけで、戦闘自体は失敗しない。

### 3.3 重複キャラの変換規約

実データ (`data/items/materials.json`) に合わせ、2段階で変換する
(`drop-service.ts: duplicateShardMaterialId()`。gacha-service もこれを共有):

- `N` / `R` / `SR` → `mat_dup_fragment_low`(「探索者の欠片・並」)
- `SSR` / `UR` → `mat_dup_fragment_high`(「探索者の欠片・特」)

該当素材がマスタに無い場合は警告ログを出し、レアリティ別の固定額(`DUPLICATE_FALLBACK_GOLD`:
N=20 / R=50 / SR=150 / SSR=500 / UR=2000)を GOLD として加算するフォールバックに切り替える
(「重複が完全なハズレにならない」設計書§27の方針を、データ未整備時も守るため)。

### 3.4 ガチャ(`server/src/services/gacha-service.ts`)

1回のガチャあたりの抽選順序:

1. `count`(1 or 10)からコストを解決(`cost10` があれば10連時はそちらを使う。無ければ `cost * 10`)。
2. **残高確認**(`assertAffordable`)。ここで不足していれば **何も変更せず** `NOT_ENOUGH_CURRENCY`。
3. DB から天井カウンタを読む。
4. 1回ごとに: 天井到達済みなら `pity.rarity` を確定、そうでなければ `rates.rarity` の重みで抽選。
   当選レアリティが `pity.rarity` 以上ならカウンタを0に戻し、そうでなければ+1する。
5. レアリティ内で `pool`(省略時は全キャラ)から1体選ぶ。`pickup` があれば
   **「このレアリティが当選した後、pickup対象へ落ちる確率(%)」** として解釈する
   (実データ例: `rates.rarity.UR=6%` × `pickup.rate=70%` → そのキャラを引ける確率は
   4.2%/回 になる、典型的なピックアップガチャの設計に合わせた)。
6. 重複キャラは §3.3 と同じ規約で素材へ変換。
7. **10連のみ**: `guarantee10` 以上の結果が1件も無ければ、最後の1件を強制的に
   `guarantee10` レアリティへ差し替える。
8. 装備バナー(`banner.equipment`)はキャラ抽選(4〜7)をスキップし、
   `equipment.dropTable` の **EQUIPMENT エントリ群を重み付き抽選**してスロット/レアリティ傾向を決め、
   `item-generator` で `count` 回生成する(実データの `dt_gacha_equipment` はWEAPON/ARMOR/ACCESSORYの
   3エントリに均等配分しており、これを正しく重み付き抽選しないと装備が特定スロットに偏るバグになる
   — 実際に発生させて修正済み。検証結果は下記「検証」参照)。
9. 支払い・付与・天井カウンタ更新をすべて1トランザクションで確定する。

天井カウンタは `gacha_pity` テーブル(playerId + bannerId)に永続化し、プロセス再起動をまたいで保持される。
300回の10連(3000回抽選)をローカルでシミュレーションし、`guarantee10` 違反0件を確認済み(§検証参照)。

---

## 4. 育成計算

### 最終ステータス

```
stat = baseStats[key] + growth[key] * (level - 1)      … ① レベル成長
     + rebirthPoints[key]                               … ② 転生ポイント (Phase 2)
     + equipmentFlat[key]                                … ③ 装備の固定値加算 (Phase 3。実装済み)
     * (1 + limitBreakRate * limitBreak)                 … ④ 限界突破 (Phase 2。現状は係数 0 で無効)
     * (1 + equipmentPercent[key] / 100)                 … ⑤ 装備の%加算 (Phase 3。実装済み)
```

**(第3ラウンドで装備反映を実装)** ③④⑤ の順序は固定(`services/progression.ts: computeStats()` に
コメントで明示)。**装備の%は必ず「装備フラット適用後の値」に対する割合として一番最後に乗算する**
(`EquipmentInstance.statsPercent` は「装備フラット適用後の値に対する割合加算」という仕様)。
装備の集計は `resolveEquipmentMods(owned, equipmentByUid)` が
`OwnedCharacter.equipment`(スロット→装備uid)を引き当てて `stats`(フラット)/`statsPercent`(%)を
合算する。`computeOwnedStats(def, owned, equipmentByUid?)` の第3引数を省略すると装備なしとして
計算する(装備テーブルを引く必要がない軽量な呼び出し向け)。

**実測**(装着前 `attack=112/speed=101/critical=15` のキャラに、フラット加算のみ
`{attack:+17, speed:+5, critical:+0.5}` の装備を装着): 装着後 `attack=129/speed=106/critical=15.5`
(すべて加算値通り)。%込みの計算も別途 `(base+equipFlat) * (1+equipPercent/100)` で検算済み
(例: attack 88 に +50フラット・+20%装備 → `round((88+50)*1.20) = 166`。実測値と一致)。

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

**(P1-4 / 第2ラウンド差し戻し対応で変更)**
ステージ `rewards.exp` を、**生存者には全額・戦闘不能になった者には
`DEFEATED_EXP_RATE`(既定 50%)** で配分する(`server/src/services/progression.ts:
grantBattleExp()`、`DEFEATED_EXP_RATE` 定数)。生存/戦闘不能の判定は
`BattleLog.result.stats`(側 `ALLY`)の `survived` を uid で突き合わせて行う。

変更の理由:

- 第1回評価(`docs/REVIEW_ROUND1.md` B節)で「全員生き残る編成を組む動機が無い」ことが
  30戦30勝・ほぼ無傷という結果の一因と指摘された。
- 前任(第1ラウンド担当)は「オート戦闘のため誰が落ちるかをプレイヤーが操作でコントロール
  できず、戦闘不能を減EXPで罰すると育成が遅れたキャラがさらに育たない負のループになる」と
  警告しており、**この指摘自体は妥当**と判断した。そのため **0%(無配布)ではなく 50%** を
  選び、「負けたら痛いが再起不能ではない」バランスにした。
- P0-1(ステージ開放制御)の導入で、そもそも身の丈に合わない高難度ステージへ直行できなく
  なったため、「弱いキャラだけが延々ハンデを受け続ける」状況は起きにくくなっている。
- 控えメンバーには配らないので「編成して出す」動機は変わらず保たれる。

`GrantExpResult.expPerMember`(≒ `BattleRewards.exp`)は**生存者基準の表示用の値**であり、
戦闘不能者への実際の付与量はそれより少ない場合がある点に注意(`LevelUpInfo.expGained` は
実際にレベルアップに使われた量なので個々の差はそちらで正確に追える)。

将来、与ダメージ量に応じた傾斜配分を入れる場合は `grantBattleExp()` に
`BattleUnitStat[]` を末尾引数で追加する(既存呼び出しを壊さないため)。

---

## 5. データローダ

`server/src/data/loader.ts` が起動時に `data/` を読み、メモリにキャッシュする。

| 置き場所 | 期待する内容 |
|---|---|
| `data/characters/*.json` | `CharacterDef` 単体 または 配列 |
| `data/skills/*.json` | `Skill[]` |
| `data/enemies/*.json` | `EnemyDef[]` |
| `data/ai/*.json` | `AiProfile[]` |
| `data/dungeons/*.json` | `ChapterDef` 単体 または 配列 |
| `data/combos/*.json` | `ComboDef` 単体 または 配列 (**第2ラウンドで追加**) |
| `data/system/affinity.json` | `AffinityTable` |
| `data/system/progression.json` | `ProgressionConfig` |
| `data/items/bases/*.json` | `ItemBaseDef[]` (**第3ラウンドで追加**) |
| `data/items/affixes/*.json` | `AffixDef[]` (**第3ラウンドで追加**) |
| `data/items/materials.json` | `MaterialDef[]` (**第3ラウンドで追加**。単一ファイル/`items/materials/*.json`ディレクトリのどちらでも可) |
| `data/items/droptables/*.json` | `DropTableDef[]` (**第3ラウンドで追加**) |
| `data/gacha/banners.json` | `GachaBannerDef[]` (**第3ラウンドで追加**。単一ファイル/`gacha/*.json`ディレクトリのどちらでも可) |
| `data/system/planned-characters.json` | `PlannedCharacterDef[]` (**第3ラウンドで追加**) |

- **寛容なパース**: 単一オブジェクト / 配列 / `{ "items": [...] }` 等のラッパ、BOM付きJSON、
  サブディレクトリの再帰探索すべてに対応。`data/combos/` も他カテゴリと同じ方針でパースする。
  第3ラウンドで追加したアイテム/ガチャ系も同じ寛容パースを踏襲し、単一ファイル運用の
  `materials.json`/`banners.json`/`planned-characters.json` は「そのファイル」と
  「同名ディレクトリ」の両方を探索してマージする(`collectJsonSources()`)ので、
  データ担当がファイル1本運用からディレクトリ分割運用に変えても壊れない。
- **落ちない**: ファイル欠損・空ファイル・JSON破損・ID重複・参照切れはすべて起動時の警告ログに留め、
  サーバは起動する。データが 0 件でも全エンドポイントが 200 を返す(`data/combos/` /
  `data/items/**` / `data/gacha/**` が空でも戦闘・ガチャAPIは200を返し、結果が空になるだけ)。
- ID重複は **先に読んだ定義が勝つ**(ファイル名昇順)。
- `progression.json` が欠損/部分的でも既定値でマージされる。
- インデックス: `characters` / `skills` / `enemies` / `aiProfiles` / `chapters` / `stages` / `combos` /
  `itemBases` / `affixes` / `materials` / `dropTables` / `gachaBanners` / `plannedCharacters`
  (`stages` は全チャプター横断の `stageId -> {stage, chapterId}` 平坦インデックス)。
- **`ticketMaterialIds`**(第3ラウンド追加): `MaterialDef` 自体には種別を示すフィールドが無いため、
  `gachaBanners` の `cost(10).ticketId` と `dropTables` の `SUMMON_TICKET` エントリが参照している
  素材IDを収集して「チケット扱いにする素材ID集合」を作る(データ駆動、コード変更不要)。
  `InventoryResponse.materials` / `.tickets` の振り分けに使う(`equipment-service.ts: buildInventoryResponse()`)。
- 第3ラウンド分の参照整合性チェック(警告のみ・落とさない): `AffixDef.minRarity`/`slots` の妥当性、
  `ItemBaseDef.slot` の妥当性、`DropTableDef.entries` の `MATERIAL`/`SUMMON_TICKET` の `id` が
  `materials` に存在するか、`CHARACTER` の `id` が `characters`/`plannedCharacters` に存在するか、
  `GachaBannerDef.pool`/`pickup`/`equipment.dropTable`/`cost.ticketId` の参照切れ。
- コンボの参照整合性チェック(`members` / `trigger.actor` / `trigger.skill` /
  `effects[].performer` / `effects[].skill`)も他カテゴリ同様、警告のみで落とさない。
- `StageDef.unlockAfter` が指すステージIDがマスタに存在しない場合も起動時警告に留める
  (その場合は「絶対にロックされ続ける」事故を避けるため `assertStageUnlocked` は通す)。
- `AiProfile.playerSelectable` を1件も持つプロファイルが無い場合も起動時警告に留める
  (移行期は全プロファイルをプレイヤー選択可能として扱う。詳細は §2 の PUT /api/characters/:uid/ai)。

---

## 6. データベース

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

### v1 → v2 マイグレーション(第3ラウンド: ハクスラ / ガチャ)

`server/src/db/index.ts` の `MIGRATIONS` 配列に関数を1つ追加しただけで、
既存の `server/data.db` も次回起動時に自動で v2 へ進む(`user_version` を見て未実行の
マイグレーションだけ順番に流すため、既存データは一切壊れない。実機で確認済み:
v1 で作った DB を v2 のコードで開くと `schema v1 -> v2` とログに出て正常起動する)。

```sql
CREATE TABLE equipment (
  uid            TEXT PRIMARY KEY,
  player_id      TEXT NOT NULL,
  base_id        TEXT NOT NULL,
  slot           TEXT NOT NULL,
  rarity         TEXT NOT NULL,
  name           TEXT NOT NULL,
  item_level     INTEGER NOT NULL DEFAULT 1,
  prefix_id      TEXT,
  suffix_id      TEXT,
  stats          TEXT NOT NULL,   -- JSON Partial<Record<StatKey, number>>
  stats_percent  TEXT,            -- JSON Partial<Record<StatKey, number>>
  special        TEXT,            -- JSON ItemSpecialEffect
  enhance_level  INTEGER NOT NULL DEFAULT 0,
  seed           INTEGER,         -- 再現用の生成シード
  equipped_by    TEXT,            -- owned_characters.uid。NULL = 未装備
  obtained_at    TEXT NOT NULL,
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
CREATE INDEX idx_equipment_player ON equipment(player_id);
CREATE INDEX idx_equipment_equipped_by ON equipment(equipped_by);

CREATE TABLE materials (
  player_id   TEXT NOT NULL,
  material_id TEXT NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, material_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
-- ガチャチケットも同じテーブルに入る。「チケットかどうか」は
-- GameData.ticketMaterialIds (loader.ts) で判定する(§5参照)。

CREATE TABLE gacha_pity (
  player_id TEXT NOT NULL,
  banner_id TEXT NOT NULL,
  counter   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id, banner_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
```

- `OwnedCharacter.equipment`(スロット→装備uid の JSON)は既存の `owned_characters.equipment` 列を
  そのまま使う(Phase1から型は定義済みだったが第3ラウンドで初めて実際に書き込む)。
  `equipment.equipped_by` と `owned_characters.equipment` は常に両方向で同期させる
  (`repository.ts: setEquipmentEquippedBy()` / `setCharacterEquipmentSlot()` を必ずセットで呼ぶ。
  `equipment-service.ts` の equip/unequip はどちらも `repo.inTransaction` で1トランザクションにしている)。
- `materials` は `MAX(0, count + delta)` の `UPSERT` で増減する(`repo.addMaterial()`)。
  マイナス方向(ガチャ/装備コストの消費)でも0未満にはならない安全弁。
- `gacha_pity` は `(playerId, bannerId)` 単位でカウンタを永続化し、プロセス再起動をまたいで保持される。

### v3 → v4 マイグレーション(第5ラウンド: レイドバトル)

```sql
CREATE TABLE raid_states (
  player_id           TEXT NOT NULL,
  boss_id             TEXT NOT NULL,
  remaining_hp        REAL NOT NULL,   -- 共有HPプールの残量
  total_hp             REAL NOT NULL,  -- 挑戦開始時点の totalHp を保持(後からマスタの値を変えても既存進行が壊れない)
  attempts             INTEGER NOT NULL DEFAULT 0,
  total_damage          REAL NOT NULL DEFAULT 0,
  defeated               INTEGER NOT NULL DEFAULT 0,
  triggered_gimmicks      TEXT,        -- JSON string[] (発動済みギミック名)
  updated_at                TEXT NOT NULL,
  PRIMARY KEY (player_id, boss_id),
  FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
);
```

- 未挑戦(行が無い)状態は `repo.findRaidState()` が `null` を返すだけで、`GET /api/raid` 側が
  `remainingHp = totalHp` の初期状態をその場で組み立てる(§2 参照)。行は初回の `POST /api/raid/attack` で
  初めて作られる。
- `raid-service.ts: attackRaidBoss()` が1回の挑戦で行うこと(すべて1トランザクション):
  状態の保存(`repo.saveRaidState()`)→ EXP/ゴールド付与 → 参加報酬抽選(`attemptDropTable`)→
  (このターンで撃破したときだけ)撃破報酬抽選(`dropTable`)。

---

## 7. 戦闘エンジンとの結合

- エンジンは `server/src/battle/index.ts` から `runBattle` を
  `RunBattle` 署名 (`server/src/battle/contract.ts`) で export する。
- API 層は `server/src/services/battle-engine.ts` 経由でこれを **動的 import** する。
  エンジン未実装でもサーバが起動できるよう、読み込めない場合は通常攻撃のみの
  暫定フォールバックエンジンに自動で切り替わる(`/api/health` の `battleEngine` で判別可能)。
- エンジンに渡す `BattleContext` は
  `{ skills, aiProfiles, affinity, config: progression.battle, seed, stageId, combos, now }`。
  (`combos` / `now` は第2ラウンドで追加。`combos` は `data/combos/*.json` から読み込んだ
  `Map<string, ComboDef>`、`now` は `new Date().toISOString()` でAPI層が確定した時刻)
- **`now` (P0-3)**: `BattleLog.createdAt` の時刻付与はAPI層の責務。エンジン内で
  `Date.now()` を呼ぶとログ全体のハッシュ比較(決定論の検証)が壊れるため、`ctx.now` を
  そのまま `createdAt` に使うことがエンジン側の契約。API層はエンジンが `createdAt` を
  埋めなかった場合のフォールバックとして同じ `now` の値を使う。
  **既知の未整合(第2ラウンド時点)**: `server/src/battle/engine.ts` はまだ
  `ctx.now` を参照せず `createdAt: new Date().toISOString()` を直接呼んでいる
  (`server/src/battle/engine.ts:282` 付近)。バトルエンジン担当への申し送り事項として
  下記「他担当への依頼事項」に記載。
- **`combos` (P0-2)**: 味方編成から成立するコンボをエンジンが判定・発動する契約。
  データが空でも `combos` は空 `Map` として渡るため、コンボ0件でも戦闘は問題なく動く。
  **既知の未整合(第2ラウンド時点)**: `engine.ts` はまだ `ctx.combos` を参照していない
  (実装はバトルエンジン担当が進行中)。
- **`tags` (CombatantInput)**: `ComboDef` の TAG コンボ (`requireTag`) 判定用に
  `CombatantInput.tags` が追加された。API層は `CharacterDef.tags` / `EnemyDef.tags` を
  そのまま渡している(`server/src/services/battle-service.ts`)。
- エンジンは副作用なし・決定論的であることが契約。報酬付与は API 層が行う。

---

## 8. 統括への型変更要望

`shared/` はバックエンド担当の書き込み禁止範囲のため、以下は実装せず要望のみ記載する。

**(第3ラウンドで解消済み)** 第2ラウンドで要望していた `MasterDataResponse.combos?: ComboDef[]` は
その後 `shared/src/api.ts` に正式追加されていることを確認した(`materials?` / `plannedCharacters?` も
同時に追加済み)。第3ラウンドで `server/src/routes/master.ts` の暫定ワークアラウンド
(ローカル拡張型でのキャスト)を廃止し、正式フィールドを直接返すよう整理した。

残っている要望:

1. **ステージ開放フラグ** (例: `StageDef.unlocked?: boolean` または
   `DungeonListResponse` に `unlockedStageIds: string[]` 等)
   現状は `StageDef.unlockAfter` + `clearedStages` をクライアント側で突き合わせれば
   開放判定を再現できるため必須ではないが、判定ロジックの二重管理(クライアントとサーバ)を
   避けたいなら追加を検討してほしい。挑戦拒否自体はサーバ権威で完結しているので緊急度は低い。
2. **編成コンボ判定API用の型** (P1-2, 任意)
   「指定した5人編成で成立するコンボ一覧」を返す新エンドポイントを作る場合、
   `shared/src/api.ts` にリクエスト/レスポンス型が必要(`ActiveCombo[]` を返す想定)。
   フロントは `MasterDataResponse.combos` があればクライアント側でも判定可能なため、
   バックエンド側では今回実装していない(要望があれば追加する)。
3. **`GachaPity.rarity` が `Rarity`(N〜UR)固定** (`shared/src/types.ts`。第3ラウンドで新規)
   装備バナー(`GachaBannerDef.equipment` あり)には天井の概念を実装していない。
   `GachaPity` は `rarity: Rarity` 固定のため、`ItemRarity`(COMMON〜MYTHIC)の装備には
   使えない。装備バナーにも天井を入れたい場合、`GachaPity` を `Rarity | ItemRarity` にするか、
   別の `EquipmentGachaPity` 型を追加してほしい。緊急度は低い(実データの `banner_equipment` は
   現状 `pity` を設定していない)。
4. **`EquipRequest`/`UnequipRequest` に明示的な `slot` が無い点の確認**
   実装では「装備は自身の `EquipmentInstance.slot` にしか付けられない」前提で `SLOT_MISMATCH` を
   (a) 装備データ自体のスロット値が壊れている場合、(b) `unequip` の `slot` パラメータが
   `EquipmentSlot` の値でない場合、の2ケースに用いている(§2 装備エンドポイント参照)。
   意図と違えば仕様を教えてほしい。

## 9. 他担当への依頼事項

**(第3ラウンド時点で解消を確認できた第2ラウンドの依頼)**
`server/src/battle/engine.ts` は `ctx.now` / `ctx.combos` を既に参照している
(`createdAt: this.ctx.now ?? ''`、`comboRuntimes = ctx.combos ? qualifyCombos(...) : []`)。
`data/ai/*.json` の `playerSelectable` は11件付与済み、`data/dungeons/*.json` の
`unlockAfter` も全ステージに設定済みで、P0-1/P0-2/P1-3 の制約は実際に機能している
(`tools/smoke.mjs` の §8「ステージ開放制御」も実測で成功することを確認済み)。

第3ラウンドで新たに確認・お願いしたい点:

- **バトルエンジン担当**: `CombatantInput.specials?: ItemSpecialEffect[]` を
  `contract.ts` に追加してもらったのに合わせて、API層(`battle-service.ts: toAllyCombatant()`)は
  装着中の装備の `special` を集めて渡すようにした。`engine.ts` 側の発動処理
  (`fireBattleStartSpecials` 等、現状ビルドエラーになっている未定義メソッド)の実装が進めば、
  装備の特殊効果(灼熱付与・凍結障壁など)が戦闘に反映されるようになる。
- **データ担当への確認事項(統括経由で確認済みの2点を記録として残す)**:
  1. `banner_equipment` の `rates.rarity` は型を満たすためだけに埋まっており、実装では
     **意図的に一切参照していない**(レアリティ傾向は `equipment.dropTable` 側の
     `EQUIPMENT` エントリの `rarityWeights` を使う。`gacha-service.ts` にコメントで明記)。
  2. `DropEntry.kind:"CHARACTER"` で `id` 省略時は「実装済み全キャラからランダムに1体」抽選する
     という解釈で実装し、実データ (`dt_ch1_common` 等) と整合することを確認した
     (`drop-service.ts: pickRandomCharacterId()`)。
  3. 重複キャラの変換素材は実データの2段階規約(`mat_dup_fragment_low`=N〜SR /
     `mat_dup_fragment_high`=SSR〜UR)にコードを合わせた。
- **フロント / オフライン単体版担当**: `standalone/localApi.ts` からも
  `server/src/services/item-generator.ts` を import する構成のため、このファイルは
  `node:crypto`(`randomUUID`)以外の Node 専用APIを使わない純粋関数として維持している
  (`rollEquipment()` はサーバ/ブラウザのどちらでも同じ結果を返す)。今後この方針を崩す
  変更(ファイルI/O・DB直参照など)を加える場合は、standalone 側と要相談。
- **データ担当(第5ラウンド)**: 実装中に `data/raid/bosses.json` /
  `data/items/droptables/raid.json` がデータ担当側の作業と衝突し、こちらが最初に置いた
  サンプルデータ(`raid_vald_reborn` / `raid_null_awakened` 等)がデータ担当の
  `raid_hitori_stand`(実装済みキャラ `hitori_stand` を使うレイド限定ボス)に上書きされた。
  最終的にはデータ担当版で問題なく動作することを確認済み(§10参照)なので対応不要だが、
  同じディレクトリを複数担当が同時に編集する運用だと今後も起こり得るので共有しておく。

---

## 10. レイドバトル (第5ラウンド。設計書 §28〜§29)

### 設計方針

レイドボスは「巨大な共有HPプール」(`RaidBossDef.totalHp`)を持つ。**1回の挑戦は
通常の戦闘(`battle-service.startBattle` と全く同じ組み立て)をそのまま `runBattle` に
流すだけ**で、その戦闘で味方が与えた合計ダメージ(`BattleResult.stats` の `side:'ALLY'` の
`damageDealt` 合計)を共有HPプールから引く。**戦闘エンジン(`server/src/battle/**`)には
一切手を入れていない。** 1回では削りきれない量の `totalHp` を持たせることで
「何度も挑む」体験を作る。実装は `server/src/services/raid-service.ts`。

### 味方の組み立て(装備・転生・コンボを反映)

`battle-service.ts` の `resolveBattleMembers()` / `toAllyCombatant()` をそのまま再利用している。
装備・転生ノード・コンボはすべて通常戦闘と同じ経路で反映されるため、レイド専用の特別扱いは無い。

### ボスの組み立てとギミック

ボスは `RaidBossDef.enemyId` + `level` から `toEnemyCombatant()` で1体だけ作る
(雑魚は付けない。最速で入れるための判断)。挑戦開始時点の残りHP割合(`hpBefore / totalHp`)で
発動済みの `RaidGimmick`(`hpBelow` 以下で発動)を求め、その `statBonus`(%)をボスの
最終ステータスへ乗算し、`unlockSkills` があればボスの `skills` へ追加する。

- **`grant`(状態異常の直接付与)は今回は未対応。** `CombatantInput` に「戦闘開始時に
  付与する状態異常」の受け口が無いため(`contract.ts` は FROZEN)。
  `raid-service.ts: applyGimmicksToBoss()` にコメントで TODO を残してある。
  対応する場合はバトルエンジン担当と `contract.ts` の拡張を相談すること。
- 挑戦後、削った後のHP割合で新たに閾値を跨いだギミックを `newGimmicks` として返し、
  `RaidState.triggeredGimmicks`(発動済みギミック名の配列)に積み上げていく。

### 報酬

- **毎回**: `attemptDropTable` の参加報酬(勝敗を問わず抽選する。ボスを削りきれなくても
  何かは持ち帰れるようにするため)。
- **撃破時のみ**: そのターンで撃破した(`hpAfter <= 0` に到達した)ときだけ `dropTable` の
  撃破報酬を追加で抽選する。両方の `DropResult` は `raid-service.ts: mergeDropResults()` で
  1つにまとめてレスポンスに載せる。
- **EXP/ゴールド**: ボス定義に個別の値が無いため、`exp ≈ boss.level × 35` /
  `gold ≈ boss.level × 20`(通常ステージ報酬の大まかな水準を参考にした簡易係数。
  バランス調整は今回のスコープ外なので雑な固定係数のままにしてある)。

### 状態の永続化

`raid_states` テーブル(§6 参照)へ `(playerId, bossId)` 単位でUPSERTする。
状態の保存・EXP/ゴールド付与・ドロップ付与はすべて `repo.inTransaction()` の中で行うため、
途中で例外が起きても中途半端な状態が残らない。

### 実機確認(`AKATAN_DATA_DIR` で一時ディレクトリを指した検証データ)

本番の `data/raid/bosses.json`(`totalHp` が非常に大きい終盤ボス)とは別に、
`totalHp` を小さくしたテストデータで確認した:
1. 挑戦を繰り返すと `remainingHp` が減り、`hpBelow` の閾値を跨ぐたびに `newGimmicks` が
   1回だけ発火し、`triggeredGimmicks` に積み上がる。
2. 撃破すると `RaidState.defeated = true` になり、以後の挑戦は `RAID_DEFEATED` で拒否される。
3. 撃破報酬(`dropTable`)からキャラクタードロップ(`hitori_stand`)を実際に付与できることを確認
   (初回は新規付与、2回目以降は `mat_dup_fragment_high` への重複変換。`drop-service.ts` の
   既存ロジックをそのまま再利用しており、レイド専用の分岐は無い)。
