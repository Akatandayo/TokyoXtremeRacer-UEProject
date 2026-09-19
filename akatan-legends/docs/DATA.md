# データ設計ガイド (Phase 1 / MVP)

`data/**` はゲームのマスターデータ置き場です。**数値バランスはすべてここにあり、コードにハードコードしません。**
型の唯一の正解は `shared/src/types.ts` です。ここに書かれていないフィールドは足さないでください。

検証は依存ゼロのスクリプト1本で行います。

```bash
node scripts/validate-data.mjs
```

エラーがあれば日本語で全件列挙して exit 1、無ければ件数サマリを出して exit 0 します。
**データを触ったら必ず実行してからコミットしてください。**

---

## 1. ファイル配置規約

| パス | 中身 | 対応する型 |
|---|---|---|
| `data/skills/normal.json` | 全ユニットの通常攻撃 | `Skill[]` |
| `data/skills/active.json` | 味方キャラのアクティブスキル | `Skill[]` |
| `data/skills/ultimate.json` | 味方キャラの必殺技 | `Skill[]` |
| `data/skills/awakened.json` | 覚醒時に置換される強化版スキル | `Skill[]` |
| `data/skills/enemy.json` | 敵・ボスのアクティブ / ボス必殺技 | `Skill[]` |
| `data/characters/<id>.json` | **1ファイル1キャラ** | `CharacterDef` |
| `data/enemies/common.json` | 通常敵 | `EnemyDef[]` |
| `data/enemies/bosses.json` | ボス (`boss: true`) | `EnemyDef[]` |
| `data/ai/profiles.json` | AI戦術プリセット | `AiProfile[]` |
| `data/dungeons/chapter1.json` `chapter2.json` | **1ファイル1章** | `ChapterDef` |
| `data/system/affinity.json` | 属性相性表 | `AffinityTable` |
| `data/system/progression.json` | レベル曲線・戦闘定数 | `ProgressionConfig` |
| `data/system/planned-characters.json` | まだ実装されていないがコンボから参照されるキャラ | `PlannedCharacterDef[]` |
| `data/combos/combos.json` | キャラクターコンボ | `ComboDef[]` |
| `data/items/bases/*.json` | 装備ベース(武器/防具/装飾品) | `ItemBaseDef[]` |
| `data/items/affixes/*.json` | Prefix / Suffix | `AffixDef[]` |
| `data/items/materials.json` | 強化・転生・重複変換・召喚チケット素材 | `MaterialDef[]` |
| `data/items/droptables/*.json` | ドロップテーブル(`StageDef.rewards.dropTable` / `GachaBannerDef.equipment.dropTable` から参照) | `DropTableDef[]` |
| `data/gacha/banners.json` | ガチャバナー | `GachaBannerDef[]` |
| `data/system/rebirth.json` | 転生の全体設定(必要Lv・獲得ポイント・コスト) | `RebirthConfig` |
| `data/rebirth/nodes.json` | 転生ツリーの全ノード | `RebirthNodeDef[]` |

### 命名規約(IDは全ファイル横断で一意)

| 接頭辞 | 用途 | 例 |
|---|---|---|
| `na_` | 通常攻撃 | `na_hitori_ping` |
| `sk_` | アクティブ(味方) | `sk_rin_thunderstep` |
| `sk_en_` / `sk_boss_` | アクティブ(敵 / ボス) | `sk_boss_gigant_quake` |
| `ult_` | 必殺技 | `ult_amagi_dawn` |
| `ai_` | AIプロファイル | `ai_enji_burst` |
| `en_` / `boss_` | 敵 | `en_wolf_gale` / `boss_null_daemon` |
| `chN-M` | ステージ | `ch1-5` |

キャラIDだけは接頭辞なし(`hitori`, `momiji` …)で、**ファイル名と `id` を一致させます**。

---

## 2. キャラを1体追加する手順

1. **スキルを先に作る。** `data/skills/normal.json` に通常攻撃1件、`active.json` にアクティブ2件、`ultimate.json` に必殺技1件。
   - `fx` は必須です。フロントはこのキーで演出を出し分けるので、既存キーを流用するか新規キーを足して**フロント担当に伝えます**。
   - `power` の目安: 通常攻撃 0.8〜1.1 / アクティブ単体 1.3〜2.0 / アクティブ全体 0.85〜1.45 / 必殺技 2.0〜3.0(全体)、多段なら `power × hits` の合計で見ます。
2. **AIプロファイルを作る。** `data/ai/profiles.json` に `ai_<id>_<役割>` を追加。
   - `rules` は **priority 昇順**。上から評価され、最初に条件を満たしたものが実行されます。
   - **末尾は必ず `{ "condition": { "type": "ALWAYS" }, "skill": "NORMAL" }`** にします(バリデータが弾きます)。
   - `skill` にはそのキャラが所持しているスキルIDか `'NORMAL'` しか書けません。他キャラのスキルIDを書くとエラーになります。
3. **`data/characters/<id>.json` を作る。** 必須は `id` `name` `rarity` `element` `roles` `baseStats` `growth` `normalAttack` `skills` `ultimate` `defaultAi` `description`。
   このプロジェクトではさらに **`awakening` `art` `trpg` も全キャラ必須**の運用です。
4. `node scripts/validate-data.mjs` を実行してエラー0を確認する。

### `art` の書き方(仮キャラ画像の代わり)

```json
"art": { "primary": "#2B1B4D", "secondary": "#0E0A18", "accent": "#4DF0FF", "sigil": "独", "pattern": "circuit" }
```

- `primary` / `secondary` / `accent` は `#RRGGBB` 固定。**キャラ同士で一目で見分けが付く配色**にします。
- `accent` は発光色なので、`primary` より明度を上げます。
- `sigil` は1文字。`pattern` は `grid | wave | burst | circuit | petal | void` のみ。
- **敵は暗色系**(`primary` の明度を落とし、`secondary` をほぼ黒に)で味方と区別します。

### `trpg` の書き方(重要)

`trpg` は身内TRPGをモチーフにした**架空の仮設定**しか書きません。
**実在の人物名・所属・個人を特定できる情報は一切書かないでください。** `visibility` は既定 `PRIVATE` です。
`player` は `PL-A(仮)` のような匿名表記、`note` に架空である旨を明記します。

---

## 3. バランス設計の意図

### 3-1. 戦闘の長さ (`data/system/progression.json` の `battle`)

| 定数 | 値 | 根拠 |
|---|---|---|
| `gaugeRate` | 0.1 | `speed × 0.1` が1ティックのゲージ増加。速度100のキャラが10ティックに1回行動する基準。速度62(黒鉄)〜142(独)で**行動回数に約2.3倍の差**が付き、速度がちゃんとステータスとして機能する幅になります。 |
| `gaugeMax` | 100 | 上記の基準値。 |
| `ultGainOnAction` | 22 | 行動4〜5回で必殺が溜まる計算。1戦闘で**必殺が1回撃てるかどうか**という緊張感を狙っています。 |
| `ultGainOnHit` | 8 | 殴られ役(壁)のほうが必殺が早く溜まる。黒鉄や漣の全体シールドが「耐えた分だけ返ってくる」設計です。 |
| `defenseConstant` | 300 | ダメージ = `攻撃力 × 倍率 × 300 / (300 + 防御)` を想定。防御60で軽減17%、防御200(壁)で40%。**防御を上げれば確実に効くが、無敵にはならない**中間値です。 |
| `maxTicks` | 240 | 通常戦闘は40〜60ティックで終わるので、引き分け判定は**通常の4〜5倍**に置いて事故だけを拾います。 |
| `damageVariance` | 0.08 | ±8%。リプレイに揺らぎは欲しいが、編成研究の結果を乱数が上書きしてはいけないので小さめ。 |

**実測(400試行のシミュレーション、状態異常・バフ未計算)**

| ステージ | 味方Lv | 平均総行動数 | 勝率 |
|---|---|---|---|
| ch1-1 | 1 | 9.4 | 100% |
| ch1-2 | 3 | 11.8 | 100% |
| ch1-4 | 7 | 13.9 | 100% |
| ch1-5 (ボス) | 9 | 33.9 | 100% |
| ch2-3 (中ボス) | 15 | 34.3 | 100% |
| ch2-5 (ボス) | 16 | 45.3 | 16% |
| ch2-5 (ボス) | 20 | 42.5 | 80% |
| ch2-5 (ボス) | 24 | 35.8 | 100% |

雑魚戦10〜14行動 / ボス戦30〜42行動で、**目標の15〜40行動帯**に収まっています。
ch1-1 が意図的に短いのはチュートリアルだからです。

### 3-2. レベル曲線 (`expCurve`)

`Lv n → n+1 に必要なEXP = round(30 × n^1.5)`。`levelCap` は 60。

- Lv2まで30 / Lv4まで累計271 / Lv5まで累計511。**ch1-1(60EXP)を数回周回するとLv3〜4**に届きます。
- Lv9到達に累計2522。ch1-4(280EXP)を8回前後で第1章ボスの適正になります。
- Lv20到達に累計20141。ch2-4(1700EXP)を10回前後。**Phase 1 の到達点をLv20〜24**に置き、Lv60は転生・限界突破が入るPhase 2以降の伸びしろとして空けてあります。

報酬EXPは「1ステージ = 現在レベル帯の必要EXPの 1/3〜1/2」を目安に置いています。周回が数回で目に見えて進み、かつ1回でレベルが飛びすぎない幅です。

### 3-3. 属性相性 (`affinity.json`)

有利 **1.25** / 不利 **0.8** に抑えています(設計書§5)。

- 4属性の循環: **FIRE → WIND → EARTH → WATER → FIRE**。
- LIGHT ⇔ DARK は相互1.25、同属性同士は0.8(光で光を殴っても通りにくい)。
- **VOID は特殊**: VOID から他属性へはすべて等倍で、相性で有利を取れません。代わりに LIGHT / DARK からは **1.1倍で受けます**。「相性の輪の外側にいるが、光と闇にだけは弱い」という独の立ち位置を数値で表現しています。

1.25 という幅は、**属性を完全に無視した編成でも押し切れるが、揃えれば戦闘が2〜3行動短くなる**程度です。相性だけで勝敗が決まらないという要件を満たすため、あえて1.5倍以上にはしていません。バリデータは 0.5〜1.6 の範囲外の倍率をエラーにします。

### 3-4. レアリティと役割 (設計書§4 / §44 / §50)

**レアリティは「汎用性」であって「強さ」ではありません。** 低レアは特化性能で高レアを明確に上回ります。

| キャラ | レア | その役割で勝っている点 |
|---|---|---|
| 黒鉄 巌 | **N** | 挑発 + 防御バフを両立できる唯一のキャラ。壁性能は UR を含めて全キャラ中最高(Lv1で HP1100 / 防御120、成長も防御+11/Lv)。 |
| 雫 | **N** | 全体状態異常解除を最短クールダウン(3)で回せる。毒・出血・凍結軸の相手には UR の天城より確実に機能する。 |
| 凛 | **R** | 素の速度128は全キャラ2位。敵の最大火力役を先制で気絶させる仕事では高レアの妨害役を上回る。 |
| 北斗 | **R** | 対DARK火力が編成中最高。闇属性ボス相手なら R のまま最終編成に残る。 |
| 天城 彼方 | **UR** | 何でもできるが、解除速度では雫に、シールド厚では漣に、壁性能では黒鉄に劣る。**強いのではなく、外れが無い**。 |

強さの調整は **ステータス総量ではなく「尖り方」** で行ってください。
低レアを弱くしたいときに数値を一律で下げるのではなく、**得意分野を狭くします**(例: 北斗は対闇以外では平凡)。

### 3-5. 成長率 (`growth`)

ロールごとに伸びる方向を変え、レベルが上がるほどロールの差が開くようにしています。

| ロール | 伸ばす | 抑える |
|---|---|---|
| TANK | `hp` (+95/Lv) `defense` (+11/Lv) | `speed` (+0.5/Lv) |
| ATTACKER | `attack` (+7.4〜9.0/Lv) `criticalDamage` | `defense` |
| HEALER / SUPPORT | `healing` `hp` | `attack` |
| CONTROL | `speed` (+1.6/Lv) | `hp` `defense` |
| SPECIALIST (独) | `attack` (+8.8) `speed` (+1.9) | `hp` (+44) `defense` (+2.8) |

独は攻撃・速度が全キャラ最高で、HP・防御が全キャラ最低です。**Lvを上げるほど「速いが脆い」が極端になる**設計で、覚醒条件(HP20%以下)に自然に噛み合います。

### 3-6. 覚醒 (`awakening`)

全キャラ必須です。条件はキャラの物語と一致させます。

- 独 `glitch_overload`: HP20%以下 **かつ** `sk_hitori_packet_storm` を3回使用。追い込まれて初めて安全装置を切る。攻撃+45% / 速度+35%、スキルと必殺技が強化版に置換されます。
- 紅葉 `crimson_link`: **編成に独が居る** かつ 3ターン経過。`withAlly` を使った唯一の覚醒で、コンボ `network_link` の物語的な裏付けになっています。
- 雫 `tearless_vow` / 天城 `dawnbreaker`: 味方が倒れた数が条件。回復役は「救えなかった」ことをトリガーにします。
- 北斗 `starfire_resolve`: 敵撃破数が条件。アタッカーは戦果で乗ってきます。

`skillReplace` の置換先は `data/skills/awakened.json` に置き、**置換元をそのキャラが所持していること**をバリデータが検査します。

### 3-7. AIプロファイル

`AiRule.skill` にはスキルIDか `'NORMAL'` しか書けないため、**AIプロファイルはユニットごとに1本**用意しています(キャラ10 + 通常敵10 + ボス3 = 23本)。
プレイヤーが選べる汎用プリセットにするには型の拡張が必要です(下記「型への要望」参照)。

共通の優先順位パターン:

1. `ULT_READY` → 必殺技(回復役だけは `ALLY_HP_BELOW` を必殺より優先し、満タンで撃つ無駄をなくす)
2. `ALLY_HP_BELOW 40〜70` → 回復 / シールド
3. `ENEMY_COUNT_ATLEAST 3` → 範囲攻撃
4. `ENEMY_HP_BELOW 30〜45` → フィニッシャー(単体高倍率)
5. `ALWAYS` → 主力スキル
6. `ALWAYS` → `NORMAL`(**必須のフォールバック**)

> **戦闘エンジンへの前提**: ルールに書かれたスキルが**クールダウン中 / 必殺ゲージ不足**の場合は、そのルールをスキップして次の priority を評価する想定です。この前提が崩れると、`priority 20` に `ALWAYS` を置いているプロファイル(紅葉・漣・天城など)が通常攻撃しか撃たなくなります。

---

## 4. バリデータが検査していること

`scripts/validate-data.mjs` は依存ゼロの Node スクリプトです。

- 全JSONがパースできる
- ID重複がない(スキル / キャラ / 敵 / AIプロファイル / チャプター / ステージ、キャラIDと敵IDの衝突も)
- キャラ・敵が参照する全スキルIDが存在し、**`kind` も合っている**(`normalAttack` は NORMAL、`ultimate` は ULTIMATE など)
- `defaultAi` が存在する
- **AIルールの参照スキルが、そのユニットの所持スキル(覚醒置換先を含む)または `'NORMAL'` である**
- AIプロファイルの `rules` が priority 昇順で、**末尾に `ALWAYS` + `NORMAL` のフォールバックがある**
- ダンジョンが参照する敵IDが存在する / `boss: true` のステージにボス敵が配置されている
- 必須フィールドの欠落、列挙値の誤り(属性・ロール・レアリティ・状態異常・効果種別・対象パターンなど)
- `CharacterDef` / `EnemyDef` に**型に無いフィールドが紛れていない**
- `art` のhexカラー形式・`sigil` の文字数・`pattern` の値
- `awakening` の条件キー・`skillReplace` の整合・`withAlly` が実在キャラか
- 属性相性の倍率が 0.5〜1.6 に収まっているか
- `art.portrait` が指定されたキャラについて `client/public/portraits/<key>.webp` が実在するか(読み取りのみ。`client/` へは書き込まない)
- 装備ベース(`ItemBaseDef.mainStat` が `StatKey` か)・アフィックス(`stats[].min <= max`・`special.trigger` が既定値か)・素材・ID重複
- ドロップテーブルが参照する素材ID/キャラID/装備スロットが妥当か、`weight` が正か、ステージの `rewards.dropTable` が実在するか
- ガチャバナーの `rates.rarity` 合計が100か、`pool`/`pickup` のキャラIDが実在するか、`cost.ticketId` が素材として実在するか、`pity.rarity` が妥当か
- コンボの `members`/`trigger.actor`/`effect.performer` が「実キャラ」または `data/system/planned-characters.json` の未実装キャラのどちらかとして実在するか
- 転生ノード(`data/rebirth/nodes.json`): ID重複 / `path` が4系統のいずれか / `effects[].kind` が既定6種のいずれか / `STAT_FLAT`・`STAT_PERCENT`・`GROWTH_PERCENT` に `stat` があり `StatKey` として妥当か / `cost`・`maxRank` が正の数値か / **`requiresPathPoints` が同系統の他ノードの総コストを超えていないか(超えていれば全振りしても永久に取れないノードになる)**
- 転生設定(`data/system/rebirth.json`): `requiredLevel` が `levelCap` 以下か / `cost`・`resetCost` の素材が実在するか、かつ**どれかのドロップテーブルから実際に入手できるか**(入手不能な素材を要求すると転生が永久に不可能になる) / **`pointsPerRebirth × maxRebirth` が全転生ノードの総コスト以上になっていないか**(以上だと最大転生時に全ノードを取り切れてしまい、設計書§19のビルド分岐が壊れる。1系統も完成できない場合は警告)
- (警告) どこからも参照されていないスキル / AIプロファイル、`rewards.dropTable` 未設定のステージ、スロットあたりのベースアイテムが4種未満、Prefix/Suffixが10種未満

---

## 5. 型への要望 (`shared/src/types.ts` は未変更)

データ側では表現しきれなかった点です。変更は統括経由で相談します。

1. **`AiRule.skill` に総称指定が欲しい** — `'ULTIMATE'` `'ANY_ACTIVE'` `'HIGHEST_POWER'` のようなセンチネルがあれば、全キャラで使い回せる汎用戦術プリセット(`AiProfile.description` が言う「プレイヤーが選べる戦術プリセット」)が作れます。現状はスキルIDべた書きのため、ユニット数ぶんプロファイルが必要です。
2. **`SkillEffect` に属性/タグ特効の条件が無い** — 北斗の「対DARK特効」を属性相性1.25とスキル倍率でしか表現できていません。`bonusVsElement?: Partial<Record<Element, number>>` か `condition?: { targetElement?: Element; targetHasStatus?: StatusType }` があると、低レアの特化役割を数値で明示できます。
3. ~~**コンボの型が無い**~~ → `ComboDef`/`PlannedCharacterDef` が追加され解消。`data/combos/combos.json` に7件実装済み。
4. **`Awakening.statBonus` の単位が曖昧** — コメントは「%」ですが、`Partial<Record<StatKey, number>>` なので加算値とも読めます。`statBonusPercent` へのリネームか、コメントの明確化を希望します。
5. **`StageDef.recommendedPower` の定義が無い** — 本データでは**推奨レベル**を入れています。戦闘力スコアを意味するなら算出式の定義が必要です。
6. **`GachaBannerDef.rates` が装備専用バナーでも必須** — `equipment` フィールドを持つバナー(キャラを排出しない)でも `rates.rarity`(`Rarity` 型、N〜UR)を埋める必要があり、意味的に使われません。`rates` を optional にするか、装備バナー用に `ItemRarity` ベースの別フィールドを検討してほしいです。

---

## 6. 装備 / ハクスラ / ガチャ (Phase 3 / Phase 5)

- **装備生成**: `ItemBaseDef`(スロット3種 × 6種 = 18種) + `AffixDef`(Prefix12 / Suffix12、`stats` は `min`〜`max` の幅を持ち生成時に乱数で確定)。一部のアフィックスは `special`(`ON_ATTACK` / `ON_HIT_TAKEN` / `ON_BATTLE_START` / `ON_KILL`)を持ち、`minRarity` / `slots` で出現条件を絞っている。
- **素材**: `data/items/materials.json` に10種。強化素材3段階・転生素材2種(`mat_rebirth_echo` / `mat_rebirth_seal`、詳細は第7章)・重複キャラ変換素材2段階・アフィックス再抽選素材・召喚チケット2種(`ticket_summon_standard` / `ticket_summon_pickup`)。召喚チケットも `MaterialDef` として定義し、`GachaBannerDef.cost.ticketId` から参照する。
- **ドロップテーブル**: 章・難易度で4種+ガチャ専用1種を用意(`dt_ch1_common` / `dt_ch1_boss` / `dt_ch2_common` / `dt_ch2_boss` / `dt_gacha_equipment`)。ボスほど装備の高レア率とキャラドロップ率を上げ、`nothingWeight` で「何も出ない」枠も必ず作っている。全ステージの `rewards.dropTable` に紐付け済み。
- **ガチャ**: 3バナー(常設 / ピックアップ / 装備)。`rates.rarity` は合計100%になるようバリデータで検査。`pity`(天井)と `guarantee10`(10連最低保証)を設定し、重複はサーバ側で素材へ自動変換される(完全なハズレにならない)。コストは既存経済(ステージ報酬GOLD 40〜1500、初期所持1000G)と釣り合わせてある(詳細は評価報告を参照)。
- **未実装キャラを先に参照する仕組み**: `data/system/planned-characters.json` に `id`/`name`/`note` だけ登録すると、`ComboDef.members` / `trigger.actor` / `effect.performer` からその未実装キャラを参照できる。バリデータは「実キャラ or 未実装キャラ」のどちらかであれば通す。実装され次第 `data/characters/<id>.json` を追加し、`planned-characters.json` から当該エントリを削除する。
- **立ち絵 (`art.portrait`)**: `CharacterArt.portrait` にアセットキーを入れると、`client/public/portraits/<key>.webp` を参照する(バリデータがファイル存在を読み取り専用でチェックする)。未設定のキャラは従来通りプロシージャル描画にフォールバックするため、両方式が混在してよい。

---

## 7. 転生 (Phase 2 / 設計書§17〜§20)

第3回評価(`docs/REVIEW_ROUND3.md`)が「次に着手する価値が最も高い」と結論した機能。
**転生=長期的な育成 / 覚醒=戦闘中の特殊状態**、という役割分担(設計書§20)を型コメント(`shared/src/types.ts`)がすでに明文化している前提の上に、`data/system/rebirth.json`(`RebirthConfig`)と `data/rebirth/nodes.json`(`RebirthNodeDef[]`)を追加した。

### 7-1. 数値の根拠(`data/system/rebirth.json`)

**まず「Lv1→60 に累計でどれだけEXPが必要か」を計算した。**
`expCurve`(`base:30, exponent:1.5`)から `Lv n→n+1 の必要EXP = round(30 × n^1.5)` を Lv59まで積み上げると、

| 到達Lv | 累計EXP |
|---|---|
| 5 | 511 |
| 9 | 2,522 |
| 20 | 20,141 |
| 40 | 117,661 |
| **60** | **327,684** |

現状もっとも効率の良い稼ぎ場は第2章最終ボス `ch2-5`(`dt_ch2_boss`、報酬 **2,600 EXP/戦**)。
**327,684 ÷ 2,600 ≈ 126戦**が、Lv1から転生後に再びLv60まで戻す下限の目安になる(章が増えればもっと速くなるが、Phase 1〜3時点ではこれが最速)。
「転生1回=短時間のミニゲーム」ではなく「かなりの周回を経てから踏む長期的な意思決定」になるよう、この試算に基づいて数値を決めた。

| 項目 | 値 | 根拠 |
|---|---|---|
| `requiredLevel` | **60** | `levelCap`(`progression.json`)と同値。転生は「レベルを使い切った後の伸びしろ」という Phase 1 時点からの設計意図(`docs/DATA.md` 3-2)をそのまま踏襲する。 |
| `pointsPerRebirth` | **5** | 1回の転生で得るノードポイント。後述のノード総コスト(1系統あたり41、全4系統で164)に対し、この値は「1系統を単独で全振りできるが、複数系統には広がらない」量を狙って逆算した。 |
| `growthBonusPercent` | **3** | 転生1回ごとに基礎成長率+3%(加算、`rebirth回数 × 3%` として累積)。**下記「いつ転生するか」の試算に使う値。** |
| `maxRebirth` | **10** | 総獲得ポイントを `5 × 10 = 50` に固定するための上限。10回という数はガチャの天井(60連)や強化素材3段階と並ぶ「長期目標」として桁を揃えた。 |
| `cost` | `mat_rebirth_echo × 3` | 既存素材(第3回評価時点で `data/items/materials.json` に既存)。`dt_ch2_boss` から重み8/全体重み124前後で落ち、期待値は**ボス1戦あたり約0.26個**。3個集めるのに**目安11〜12戦**。転生そのものにも周回を要求することで「思いつきで転生し直す」を防ぐ。 |
| `resetCost` | `mat_rebirth_seal × 2`(**新規追加**) | 振り直しは「積んだポイントの割り振りを変える」だけでレベルは減らないため、転生本体より軽くしてよいが、**素材は別種で希少にした**(LEGENDARY、`dt_ch2_boss` に重み4で追加)。期待値はボス1戦あたり約0.13個、2個で目安16戦。ビルドを試行錯誤する余地は残しつつ、毎戦ノリで組み直せるほど軽くはしていない。 |

**「いつ転生するかの判断」が発生する理由(§18)**:
攻撃力などのステータスは概ね `base + growth × (level - 1)` で伸びる。転生でLvを1に戻すと、その瞬間の攻撃力は激減する。
`growthBonusPercent` は成長率に対して `+3% × 転生回数` の倍率がかかるので、1回転生した場合の損益分岐点は

```
base + growth × 59(転生前Lv60時点) = base + growth × 1.03 × (L - 1)
→ L ≈ 58.3
```

つまり**Lv59付近まで再び上げないと、成長率ボーナスだけでは転生前の強さに戻らない**。1回だけの転生は「成長率の上昇」目的では見返りが薄く、実際に得るものは**転生ポイント(ノード)**の方が大きい。これにより、「レベルを吐き出す短期的な弱体化」と「ノード+成長率という長期的な上積み」を比較して転生タイミングを選ぶ、という設計書§18の要求どおりの意思決定が発生する。転生を繰り返すほど`growthBonusPercent`が積み重なり損益分岐点も早まるため、**後半の転生ほど「割に合う」**ようになっている。

### 7-2. 4系統の役割とノード一覧(`data/rebirth/nodes.json`、計24ノード)

各系統6ノード。構成は全系統共通(下位2つは無条件、中位2つが `requiresPathPoints: 6`、上位1つが `requiresPathPoints: 16` かつ `requiresRebirth: 2`、頂点1つが `requiresPathPoints: 28` かつ `requiresRebirth: 4`)。
1系統をすべて取ると **cost×maxRank の合計は 5+5+8+8+9+6 = 41**。

| 系統 | 役割 | ノード(基本→頂点) |
|---|---|---|
| **ATTACK**(刃) | 火力を伸ばす攻撃特化 | `rb_atk_edge`(攻撃力%)→`rb_atk_eye`(会心率%)→`rb_atk_finish`(会心ダメ%)/`rb_atk_flow`(スキル威力%)→`rb_atk_philosophy`(攻撃成長率%、転生2回目以降)→`rb_atk_zenith`(攻撃力+スキル威力、転生4回目以降) |
| **SPEED**(疾) | 先手・行動回数を伸ばす速度特化 | `rb_spd_stride`(速度%)→`rb_spd_ready`(開始時行動ゲージ%)→`rb_spd_instinct`(開始時必殺ゲージ%)/`rb_spd_accel`(速度%追加)→`rb_spd_chaser`(速度成長率%、転生2回目以降)→`rb_spd_instant`(速度+必殺ゲージ、転生4回目以降) |
| **ENDURANCE**(盾・礎) | 生存力を伸ばす耐久特化 | `rb_end_stance`(HP%)→`rb_end_wall`(防御%)→`rb_end_grit`(状態異常耐性+)/`rb_end_foundation`(防御%追加)→`rb_end_bloodline`(HP成長率%、転生2回目以降)→`rb_end_bastion`(防御+耐性、転生4回目以降) |
| **SPECIAL**(術・因果) | 回復・スキル・複合効果の特殊型 | `rb_spc_mercy`(回復力%)→`rb_spc_insight`(スキル威力%)→`rb_spc_duality`(攻撃%+防御%の複合)/`rb_spc_resonance`(開始時行動ゲージ+必殺ゲージの複合)→`rb_spc_legacy`(回復力成長率%、転生2回目以降)→`rb_spc_axiom`(スキル威力+回復力、転生4回目以降) |

`RebirthEffectKind` は型どおり6種(`STAT_FLAT`/`STAT_PERCENT`/`GROWTH_PERCENT`/`SKILL_POWER`/`GAUGE_START`/`ULT_GAUGE_START`)のみを使用し、`STAT_FLAT`/`STAT_PERCENT`/`GROWTH_PERCENT` には必ず妥当な `stat`(`StatKey`)を付けている。SPECIAL系統だけは1ノードに2つの効果を持たせ、「特化ではなく複合」という役割をノード単位でも表現した。

### 7-3. ビルド分岐がどう成立するか(§19)

- **全ノード総コストは 41 × 4系統 = 164。総獲得ポイントは `pointsPerRebirth(5) × maxRebirth(10) = 50`。**
  50 < 164 なので、最大転生(10回)を積んでも**絶対に全ノードは取り切れない**(バリデータがこの不等式を検査し、崩れていればエラーにする)。
- **1系統への全振り(41)は50以内に収まる**ので、「攻撃型に全振り」「速度型に全振り」はどちらも完成できる。ただし50−41=9ポイントしか残らないため、**2系統目は基本ノードの一部にしか手が回らない**(例: 2系統目の下位2ノード=10ポイントにすら届かない)。
  → 同じキャラでも「攻撃全振り」「速度全振り」「耐久全振り」「特殊全振り」で明確に異なる性能になり、かつ「4系統に薄く広く振る」ことは**どの系統の頂点ノードにも届かない**(頂点は `requiresPathPoints: 28` を要求するため)分だけ尖りを失う。これが設計書§19「同じキャラクター＝同じ性能にならない」を数値面で保証する。
- 頂点ノード(`requiresRebirth: 4`)と成長率ノード(`requiresRebirth: 2`)は**転生回数そのもの**を要求するため、「1回だけ転生してポイントを貯める」のではなく「同じ系統に長く投資し続ける」ことそのものにも価値を持たせている。
- バリデータは `requiresPathPoints` が「同系統の他ノードの総コスト」を超えていないかも検査する。今回のノードは全系統で頂点28 ≤ 他ノード総35、上位16 ≤ 他ノード総32 なので、**その系統に全振りすれば必ず頂点まで届く**(散らせば届かない、が全振りなら詰まない、という設計)。

### 7-4. 追加した素材と入手経路

- `mat_rebirth_echo`(EPIC、既存): 転生本体のコスト。`dt_ch2_boss`(第2章ボス)に重み8で存在。
- `mat_rebirth_seal`(LEGENDARY、**新規**): 振り直し(`resetCost`)専用。`dt_ch2_boss` に重み4で追加。転生素材より入手率を下げ、「積んだポイントの組み替え」を本転生よりレアな行為にしている。

両方とも `node scripts/validate-data.mjs` が「ドロップテーブルから実際に入手できるか」まで検査するため、今後どちらかのドロップエントリを削除すると即エラーになる(=転生が詰む事故を機械的に防止)。

### 7-5. 他担当への依頼事項

- **バックエンド**: 転生API(レベルリセット・成長率再計算・`OwnedCharacter.rebirthNodes`/`rebirthPointsAvailable` の更新・`RebirthStatus` の算出)は本ラウンドで並行実装中と認識。データ側は `RebirthConfig`/`RebirthNodeDef[]` の形で確定させたので、そのまま読み込んで問題ない。
- **フロント**: 転生画面で `pathPoints` ごとの内訳(系統別の投資量)を表示できると、「今どの系統に何ポイント入れているか」がプレイヤーに伝わりやすい。ノードの `requiresPathPoints`/`requiresRebirth` を満たしていない場合の理由表示も欲しい。
- **既存の覚醒データとの混同注意**: `awakening`(`data/characters/*.json`)は戦闘中の一時的な強化、転生ノードは永続強化。両方とも `STAT_PERCENT` 的な効果を持つため、実装時に加算順序(基礎ステータス→転生→装備→覚醒、など)を揃えておくとバグが出にくい。

## 8. 第5ラウンド: 新キャラ「電子 独(幽波紋)」とレイドボス

### 8-1. `hitori_stand`(電子 独(幽波紋))

- `id: "hitori_stand"`。`data/system/planned-characters.json` から参照されていたIDと一致させ、実装完了に伴い同ファイルからエントリを削除した(現在は `[]`)。
- 既存の `hitori`(SSR / VOID / 架空設定)とは**別個体**。ユーザー本人の探索者としてキャラシートの数値(STR7 / CON10 / POW16 / DEX18 / APP16 / SIZ10 / INT16 / EDU11 / HP10 / MP16)を素直に反映し、`baseStats.hp`(540)と `defense`(34)をUR最低クラスに、`speed`(148)を最速級(ただし `momiji_kc` の150は超えない)に振っている。
- スキル名はユーザー指定のものをそのまま採用: `normalAttack`=「拳銃」、アクティブ=「一手、遅かったな。」(DISC抽出=ダメージ+SILENCE+ATK_DOWN)/「アンタは磔刑だ...!!」(拘束=STUN+DEF_DOWN+継続ダメージ)、`ultimate`=「人は【天国】に行かなければならない。」、覚醒=「【天国】を夢見て。」。
- 覚醒条件は `withAlly: "momiji_kc"`(孤月紅葉が編成にいること)+ `hpBelow: 40` の組み合わせ。対になるペアコンボ `kc_epitaph_link`(「引き合う引力」)は `hitori_stand` の実装により実際に成立するようになった(`trigger.skill` は `momiji_kc` 側の既存スキルIDを参照しており、修正不要だった)。

### 8-2. レイドボス `raid_hitori_stand`

- `data/raid/bosses.json` を新設。敵定義は `data/enemies/bosses.json` の `boss_raid_hitori_stand`(既存のどのボスより明確に強い attack/defense/speed。かつ `baseStats.hp` を260,000という桁にして、レベル40換算でも通常パーティが1回の戦闘中に討ち切れない値にしている。理由: 戦闘エンジンは「片方の陣営が全滅したら終了」する仕様なので、ボス側の戦闘内HPが低すぎると1回の挑戦がボスの早期撃破で打ち切られ、`RaidBossDef.totalHp` から引かれるダメージが頭打ちになってしまう)。
- `totalHp: 2,000,000`。「適正パーティが1回の挑戦で与えるダメージ」を防御軽減式(`mitigation = def/(def+K)`, K=300, ボス防御491時点で約62%軽減)から逆算した概算値(1回あたり数万ダメージ想定)の20〜40倍程度になるよう設定。バランスの厳密な検証はしていない(今回はスコープ外)。
- `gimmicks` は §29 の例に沿って3段階(80%: DISCシールド展開 / 50%: 全方位展開でATK上昇 / 20%: 【天国】暴走でATK・SPD・会心ダメージ上昇)。`grant` フィールドは定義しているが、`raid-service.ts` 側は現状 `statBonus`/`unlockSkills` のみ反映し `grant` は未対応(コード側コメントで明記済み・§28実装の既知の制限)。
- `weakElements: ["LIGHT"]` / `immuneStatuses: ["SILENCE"]`。
- 撃破報酬 `dt_raid_hitori_stand_defeat` に `kind: "CHARACTER", id: "hitori_stand"` を重み1(全体重み126分の1 × rolls5)で追加。参加報酬 `dt_raid_hitori_stand_attempt` には `hitori_stand` を含めていない。

### 8-3. `hitori_stand` を「レイド限定」にするための対応

`hitori_stand` を通常のガチャ/ダンジョンから排出しないようにするため、以下を実施した:

- **ガチャ**: `banner_standard_char` と `banner_pickup_momiji_kc` は `pool` が未指定だと `gacha-service.ts` が「全実装済みキャラ」にフォールバックする仕様だったため、両バナーに明示的な `pool`(`hitori_stand` を除く既存11キャラ)を追加した。
- **既知の未解決の漏れ(要バックエンド対応)**: `server/src/services/drop-service.ts` の `pickRandomCharacterId()` は、`kind: "CHARACTER"` かつ `id` 省略のドロップエントリで「実装済み全キャラからランダム1体」を選ぶ(`data.characters.keys()` をソートして `rng.pick`)。`data/items/droptables/chapter1.json`(`dt_ch1_common`/`dt_ch1_boss`)と `chapter2.json`(`dt_ch2_common`/`dt_ch2_boss`)がこの「id省略」形式を使っているため、**`hitori_stand` の実装により、通常のダンジョン周回でも(低確率だが)排出され得る状態になっている**。この関数にはキャラ単位の除外機構が無く、データ側(`data/**`)だけでは対処できない。`CharacterDef` に `raidExclusive` 等のフラグを追加して `pickRandomCharacterId` 側でフィルタする対応をバックエンド担当に依頼したい(`spawn_task` でタスク登録を試みたがツールがタイムアウトしたため、ここに明記しておく)。
  - **第6ラウンド時点の追記**: `pickRandomCharacterId()` は既にバックエンド側で修正済みで、`def.limited !== true` によるフィルタが入っている(`server/src/services/drop-service.ts:187`)。`gacha-service.ts` の `pickCharacterDefId()` も `pool` 未指定時は同様に `limited` を除外する。したがって8-3の懸念は解消済みで、`limited: true` を付けたキャラは「明示的に `pool`/`id` を書いたエントリ」からしか出なくなっている。第6ラウンドの新規2キャラもこの仕組みに乗せている(9-4参照)。

## 9. 第6ラウンド: 新キャラ「加那星蒼太」「月島風花」とSPDの天井

### 9-1. `sota`(加那星蒼太)

- ユーザーの友人PLの探索者(アカルア卓(旧卓) / PL: 虚無プリン / 探索者名: 加那星蒼太 / 所属: 虚構memory)。`rarity: "UR"`、`element: "VOID"`(統括指定。「対象の存在ごと切る」能力がVOIDらしいため)、`roles: ["ATTACKER", "SPECIALIST"]`。
- **コンボを持たない代わりに、基礎ステータスを同レアリティ(UR)の相場よりおよそ10%高く**している。既存UR中「攻撃寄りの専門職」型である `momiji_kc`/`hitori_stand` の平均値(hp580/atk131/def38/crit26/critDmg172.5/res22)を基準に、`speed` 以外の主要ステータスへ約10%上乗せした(hp640/atk145/def42/crit29/critDmg190/res24)。`speed`(138)だけは意図的に基準そのままとし、`fuuka` のSPD天井(9-3参照)を超えないよう別枠で調整した。
- 技名はユーザー指定のものをそのまま採用: `normalAttack`=「日本刀」(単体)、アクティブ=「《斬》」(全体・CT4・「対象の存在ごと切る」演出としてDEF_DOWN付き)/「/招来\」(単体・CT5・`SkillEffect.adaptElement: true` で対象の弱点属性に変化)、`ultimate`=「｛impulse｝」(《衝動》。自身に `INVULNERABLE`+`IMMUNE` を `actionDuration: 3`(=3回行動するまで)付与)、覚醒=「新星」(HP50%以下で `statBonus: { attack: 80, criticalDamage: -20 }`)。
- `INVULNERABLE`/`IMMUNE` は STATUS effect として `duration` も同じ値(3)を入れている。`actionDuration`(自身の行動回数基準)は型コメントのとおり「エンジン側が対応していればそちらを優先する」設計なので、`duration`(ターン基準)を保険として併記した。エンジン側の実装が `actionDuration` に未対応の間は `duration: 3` ターンとして動く。
- `combos` フィールドは持たせていない(コンボ無しの代替として上記のステータス上乗せを選んだため)。

### 9-2. `fuuka`(月島風花)

- ユーザーの友人PLの探索者(アカルア卓(旧卓) / PL: Theルーフ / 探索者名: 月島 風花 / 所属: 秘密結社「花鳥風月」)。`rarity: "UR"`、`element: "WIND"`、`roles: ["SUPPORT", "SPECIALIST"]`。本人要望「SPDの天井(最速)になりたい・バッファーでありたい」を反映し、`attack`(95)は既存URの中でも低め、`speed`(158)は全キャラ中最速にしている(9-3参照)。
- 技名はユーザー指定のものをそのまま採用: `normalAttack`=「アウトロー・レッドノート」(単体・赤黒いスナイパーライフル)、アクティブ=「弾幕」(全体・CT3)/「【鳥獣戯画】」(バフ・CT4)、`ultimate`=「【花鳥風月】」(`Skill.randomEffect: true` で4効果からランダムに1つ)、覚醒=「RISING」(HP50%以下で `statBonus: { speed: 60 }`)。
- **近似せざるを得なかった箇所(いずれもスキルの `description` にも明記済み)**:
  - 「【鳥獣戯画】」本来の設定は『次に味方が攻撃するタイミングで、攻撃前にそのSPDを2倍にし、2倍後のSPDが敵SPDの2倍以上なら2回行動させる』という条件付き効果。エンジンは「次の特定タイミングで効果を差し替える」条件分岐に未対応のため、代わりに攻撃力最上位の味方(`HIGHEST_ATK`)へ `SPD_UP` potency100(=2倍相当)+行動ゲージ大回復(`GAUGE` amount100)を即座に付与し、「実質もう1回動ける」状態を作る近似にした。
  - 「【花鳥風月】」本来は花=次のダメージ+10%増幅/鳥=次の攻撃・デバフを絶対回避/風=ランダムな味方のスキルCTを0/月=ランダムな敵のスキルCTを+2、の4つ。エンジンには「ランダムな相手のクールダウンを直接操作する」機構が無く、`randomEffect` も「4つの中から1つを選んで適用する」までしか対応しないため、以下に置き換えた: 花→`ATK_UP`付与、鳥→自身に短時間`INVULNERABLE`付与(本来はデバフ無効=`IMMUNE`も同時に付くはずだが、`randomEffect` の1エントリ=1 `SkillEffect` という制約上、複数ステータスを同時に持たせられないため`IMMUNE`は省略した)、風→味方全体の行動ゲージ回復、月→敵単体への`SILENCE`。
  - 覚醒「RISING」も本来は『覚醒中は自身のスキルCTを1下げる』効果を併せ持つ想定だったが、クールダウン短縮を表現する仕組みがエンジンに無いため、`statBonus: { speed: 60 }` のみに絞った(`description` に明記)。
- `combos: ["kachou_fuugetsu_bond"]`(9-4参照)。

### 9-3. SPDの天井を `fuuka` の158に設定

- これまでの最速は `momiji_kc` の150、次点が `hitori_stand` の148だった。`fuuka` 本人の要望「SPDのボーダーライン(天井)になりたい」を受け、`baseStats.speed: 158` を**全キャラ中で明確に最速**にした。
- **以降、新規キャラの `baseStats.speed` は `fuuka` の158を超えないことを設計上の天井とする。** 既存キャラの `growth.speed`(レベル成長)による逆転は許容するが、Lv1のベースSPDでこの値を超えるキャラは今後追加しない方針。次点候補を作る場合も155〜157程度に留めること。
- 同ラウンドで追加した `sota` は意図的にこの天井よりだいぶ低い138に設定し、「基礎ステータス+10%」の対象からも `speed` を除外した(9-1参照)。

### 9-4. コンボ「《花鳥風月》」(`kachou_fuugetsu_bond`)

- `kind: "TAG"`、`requireTag: { tag: "花鳥風月", count: 2 }`。`data/combos/combos.json` の末尾に追加。
- 既存キャラのうち、名前・設定から花鳥風月に関係すると判断できる3人に `tags` へ `"花鳥風月"` を追加した: `momiji`(紅葉=花)、`rin`(凛=風)、`momiji_kc`(孤月紅葉=月)。「鳥」に対応する既存キャラは見当たらなかったため付けていない(付けすぎを避けるため)。`fuuka` 自身にも当然 `"花鳥風月"` タグを付けている。
- 本来の設定は『関わるキャラが多いほどお互いのATKが上がる』という人数依存の可変ボーナスだが、`ComboEffect` に人数に応じたスケーリングを表現する仕組みが無いため、**成立時にパーティ全体のATKを固定値(+15%)で底上げする効果**に近似した。この近似である旨は `combos.json` の `description` に明記している。
- `trigger.type: "ON_BATTLE_START"` / `maxPerBattle: 1`。`effects[0].performer` は省略しており、エンジンは成立に寄与した参加キャラ(タグ保有者)の中から自動で1人を実行役に選ぶ(`fuuka` が編成にいなくても、`momiji`+`rin` など他の2人だけで成立し得るため、特定キャラをハードコードしなかった)。

### 9-5. チケットガチャ限定バナー `banner_pickup_sota_fuuka`

- `sota`・`fuuka` はともに `limited: true`。「他のバナー・ドロップから絶対に出ない」ようにするため、新設した `banner_pickup_sota_fuuka` 以外の `pool` には一切追加していない(8-3で確認済みのとおり、`pool` 省略時の自動抽選やダンジョンの「id省略」ドロップは `limited` を自動で除外するので、他バナー側の修正は不要だった)。
- コストは `cost.currency: "TICKET"`、`ticketId: "ticket_summon_kachoufuugetsu"`(新規素材、`data/items/materials.json` に追加)。単発1枚/10連9枚。
- `rates.rarity` は `{ N: 34, R: 30, SR: 20, SSR: 15.9, UR: 0.1 }`(合計100)。**UR枠を0.1%** にし、`pool` には `sota`/`fuuka` の2人だけを UR候補として明示し、他は N〜SSRの既存非限定9キャラ(`amagi`/`hitori_stand`/`momiji_kc` などUR勢は含めない)を「ハズレ枠」として入れている。こうすることで、このバナーでUR(0.1%)を引いた場合は必ず `sota` か `fuuka` のどちらかになる(2人の中から均等抽選)。
- `pity: { count: 80, rarity: "UR" }` / `guarantee10: "SSR"` を設定し、極端な連続ハズレでも80連目までに必ずどちらか1人が確定するようにした。
- **チケットの入手経路(必須)**: `ticket_summon_kachoufuugetsu` を `dt_ch2_boss`(第2章ボスドロップ、重み3)と `dt_raid_hitori_stand_defeat`(レイド撃破報酬、重み5)の2箇所に追加した。どちらか一方が将来削除されると「チケットが入手不能になる」ため、削除する場合はもう一方が残っているか必ず確認すること(`validate-data.mjs` は素材の入手可否を転生コストについてのみ検査しており、ガチャチケットの入手可否までは検査しない点に注意)。

### 9-6. `skillSfx` の割り当て(`data/system/audio.json`)

- `AudioConfig.skillSfx` に4件追加。ファイルは配置済み(`client/public/audio/skill_itteosokattana.wav` / `skill_tokitobasi.wav`)。
  - `sk_hitori_stand_disc_extract` / 覚醒後の `sk_hitori_stand_disc_extract_ex` → `skill_itteosokattana.wav`(「一手、遅かったな。」)
  - `sk_momiji_kc_timeskip` / 覚醒後の `sk_momiji_kc_timeskip_ex` → `skill_tokitobasi.wav`(「時飛ばし」)
- EX版にも同じ音を当てているのは、覚醒後もプレイヤーには「同じ技の強化版」として認識してほしいため。

### 9-7. バリデータの追随修正

- `scripts/validate-data.mjs` の `STATUS_TYPES` に `INVULNERABLE`/`IMMUNE` を追加した(`shared/src/types.ts` の追加に合わせる必須修正。これが無いとSTATUS効果や覚醒の`grant`で使った瞬間にエラーになる)。
- `SkillEffect.adaptElement`/`SkillEffect.actionDuration`/`Skill.randomEffect`/`AudioConfig.skillSfx` は、バリデータの現状の実装では `SkillEffect`/`Skill` オブジェクト自体に対する「未知キー」の総当たりチェックが(他の型と違って)存在しないため、追加の許可リスト修正は不要だった(該当箇所を確認済み)。`audio.json` 自体もバリデータの検査対象外(スキーマ検査なし)なので `skillSfx`追加も無修正で通っている。
