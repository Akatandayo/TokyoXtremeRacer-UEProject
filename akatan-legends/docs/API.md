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
    "combos":     [ /* ComboDef[] — 暫定フィールド。下記の注意参照 */ ]
  }
}
```

実測件数の例: `{"characters": 4, "enemies": 1, "skills": 78, "aiProfiles": 1, "chapters": 1, "combos": 0}`

> **注意 (P1-1 / 第2ラウンド)**: `combos` は `shared/src/api.ts` の `MasterDataResponse` 型には
> まだ定義されていない。バックエンド担当は `shared/` を書き込み禁止のため型は追加できず、
> 実データにだけ `combos` を足して返している(`server/src/routes/master.ts`)。
> クライアントが `shared` の型経由で厳密に読むと `combos` は見えないので、
> 型として正式に使うには統括に `MasterDataResponse.combos?: ComboDef[]` の追加を依頼する必要がある
> (本ドキュメント末尾「統括への要望」参照)。

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
// 未開放ステージ (P0-1) -> HTTP 400
{"ok":false,"error":{"code":"STAGE_LOCKED","message":"このステージはまだ開放されていません。先に 'ch1-1' をクリアしてください。","details":{"stageId":"ch1-2","unlockAfter":"ch1-1"}}}
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

## 4. データローダ

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

- **寛容なパース**: 単一オブジェクト / 配列 / `{ "items": [...] }` 等のラッパ、BOM付きJSON、
  サブディレクトリの再帰探索すべてに対応。`data/combos/` も他カテゴリと同じ方針でパースする。
- **落ちない**: ファイル欠損・空ファイル・JSON破損・ID重複・参照切れはすべて起動時の警告ログに留め、
  サーバは起動する。データが 0 件でも全エンドポイントが 200 を返す(`data/combos/` が空でも戦闘は動く)。
- ID重複は **先に読んだ定義が勝つ**(ファイル名昇順)。
- `progression.json` が欠損/部分的でも既定値でマージされる。
- インデックス: `characters` / `skills` / `enemies` / `aiProfiles` / `chapters` / `stages` / `combos`
  (`stages` は全チャプター横断の `stageId -> {stage, chapterId}` 平坦インデックス)。
- コンボの参照整合性チェック(`members` / `trigger.actor` / `trigger.skill` /
  `effects[].performer` / `effects[].skill`)も他カテゴリ同様、警告のみで落とさない。
- `StageDef.unlockAfter` が指すステージIDがマスタに存在しない場合も起動時警告に留める
  (その場合は「絶対にロックされ続ける」事故を避けるため `assertStageUnlocked` は通す)。
- `AiProfile.playerSelectable` を1件も持つプロファイルが無い場合も起動時警告に留める
  (移行期は全プロファイルをプレイヤー選択可能として扱う。詳細は §2 の PUT /api/characters/:uid/ai)。

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

## 7. 統括への型変更要望 (第2ラウンド)

`shared/` はバックエンド担当の書き込み禁止範囲のため、以下は実装せず要望のみ記載する。

1. **`MasterDataResponse.combos?: ComboDef[]`** (`shared/src/api.ts`)
   編成画面で「今の編成で発動するコンボ」を表示するため。現状は `GET /api/master` の
   レスポンス実データに `combos` を型を拡張したローカル型で追加しているが(`server/src/routes/master.ts`)、
   `shared` の型からは見えないため、フロントが正式に使うには型追加が必要。
2. **ステージ開放フラグ** (例: `StageDef.unlocked?: boolean` または
   `DungeonListResponse` に `unlockedStageIds: string[]` 等)
   現状は `StageDef.unlockAfter` + `clearedStages` をクライアント側で突き合わせれば
   開放判定を再現できるため必須ではないが、判定ロジックの二重管理(クライアントとサーバ)を
   避けたいなら追加を検討してほしい。挑戦拒否自体はサーバ権威で完結しているので緊急度は低い。
3. **編成コンボ判定API用の型** (P1-2, 任意)
   「指定した5人編成で成立するコンボ一覧」を返す新エンドポイントを作る場合、
   `shared/src/api.ts` にリクエスト/レスポンス型が必要(`ActiveCombo[]` を返す想定)。
   フロントは `MasterDataResponse.combos` があればクライアント側でも判定可能なため、
   バックエンド側では今回実装していない(要望があれば追加する)。

## 8. 他担当への依頼事項 (第2ラウンド)

- **バトルエンジン担当**: `server/src/battle/engine.ts` が `ctx.now` / `ctx.combos` を
  まだ参照していない(`contract.ts` の契約は更新済み)。`BattleLog.createdAt` は
  `ctx.now` を使うよう、コンボ発動は `ctx.combos` を見るよう実装してほしい
  (API層は両方すでに渡している)。
- **データ担当**: `data/combos/*.json` が未作成(0件)。`data/ai/*.json` の
  `playerSelectable` も未付与(1件も無い間は移行的に全AI許可)。`data/dungeons/*.json` の
  `unlockAfter` もまだ設定されていない(現状は全ステージ実質開放のまま)。
  この3点が入ると、それぞれ P0-2 / P1-3 / P0-1 の制約が実際に機能し始める。
- **フロント担当**: `PUT /api/characters/:uid/ai` が敵/ボス専用AIを 400 で拒否するように
  なった。クライアント側のID接頭辞フィルタに加えて、このエラーコード
  (`BAD_REQUEST`)のハンドリングを確認してほしい。また `GET /api/master` の
  レスポンス実データには(型未定義だが)`combos` が乗っているので、暫定的に
  `any` キャストや実行時チェックで読める(正式な型は要望3を参照)。
