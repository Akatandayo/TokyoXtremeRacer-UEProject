# あかたんLegends — フロントエンド仕様 (client/)

React 18 + TypeScript + Vite。外部UI/アニメーションライブラリは不使用で、演出はすべて
CSS / SVG / Web Animations API で自作している。

```
npm run dev -w client      # http://localhost:5173 (/api は 8787 へプロキシ)
npm run build -w client
npx tsc -p client/tsconfig.json --noEmit
```

---

## 1. 画面遷移図

ルーティングは自前(`client/src/state/store.tsx` の `route: { screen, charUid? }`)。
URLは変えず、ヘッダのナビゲーションと画面内ボタンで遷移する。

```
                        ┌──────────────────────────────┐
                        │            HOME              │
                        │  名前 / 所持金 / 進行状況     │
                        │  各画面への導線 / 最近の戦闘  │
                        └─┬──┬──┬──┬──┬──┬──┬──────────┘
                          │  │  │  │  │  │  │
      ┌───────────────────┘  │  │  │  │  │  └────────────┐
      ▼                      ▼  │  ▼  │  ▼               ▼
┌───────────┐        ┌─────────┴┐┌───┴──────┐    ┌────────────┐ ┌──────────┐
│CHARACTERS │        │  PARTY   ││ EQUIPMENT │    │ COLLECTION │ │ SETTINGS │
│ カード一覧 │        │ 5枠編成  ││ 装備一覧  │    │   図鑑     │ │  設定    │
└─────┬─────┘        └────┬─────┘└─────┬─────┘    └────────────┘ └──────────┘
      │ カードをクリック     │「編成へ」   ▲ 「装備を変更→」
      ▼                    ▼            │
┌──────────────────┐  ┌───────────┐      │
│ CHARACTER DETAIL │◄─│  DUNGEON  │      │
│  §39 の詳細画面   │  │ 章/ステージ│      │
│  (装備スロット3つ) │  └─────┬─────┘      │
└─────────┬────────┘        │「戦闘開始」  │
          └───────────────────────────────┘ POST /api/battle/start
                             ▼
                       ┌───────────┐
                       │  BATTLE   │  ← ヘッダの「戦闘中」タブでも復帰できる
                       │  ログ再生  │
                       └─────┬─────┘
                             │ 終了 → リザルト(EXP/ゴールド→レベルアップ→ドロップ→MVP)
                             ├── 「ダンジョンへ戻る」 → DUNGEON
                             └── 「もう一度戦う」 → 同ステージで再度 start

┌───────────┐   GET /api/gacha       ┌──────────────────────────┐
│   HOME    │──────────────────────► │          SUMMON           │
│ / 各画面   │   POST /api/gacha/pull │ バナー選択→単発/10連→演出 │
└───────────┘                        └──────────────────────────┘
```

| 画面 | 役割 | 主なAPI |
|---|---|---|
| HOME | プレイヤー名 / 所持金 / 編成戦力 / クリア数、次の目標、最近の戦闘6件(localStorage) | `GET /api/player` |
| CHARACTERS | 所持キャラのカードグリッド。属性・ロール・レアリティで絞り込み、4種のソート | `GET /api/player` |
| CHARACTER DETAIL | 立ち絵(またはプロシージャル画像) / レアリティ / Lv / 転生回数 / 全ステータス / 通常攻撃・スキル・必殺技 / 覚醒条件 / **装備スロット3つ(WEAPON/ARMOR/ACCESSORY)** / コンボ(未実装キャラは「名前(実装予定)」表示) / TRPG設定 / AI戦術の変更 | `PUT /api/characters/:uid/ai` |
| PARTY | 5枠の編成。D&D + クリック選択。属性・ロール構成と合計戦力をリアルタイム表示。発動コンボ欄も未実装キャラを名前で表示 | `PUT /api/party` |
| **EQUIPMENT** | 所持装備一覧(スロット/レアリティ/アイテムLv/能力値で絞り込み、能力値ソートを含む)、装着前後の比較、売却(装着中は不可) | `GET /api/inventory`, `POST /api/equipment/{equip,unequip,sell}` |
| **SUMMON** | ガチャ。バナー選択、排出率の常時公開、単発/10連、天井・重複変換演出 | `GET /api/gacha`, `POST /api/gacha/pull` |
| DUNGEON | 章タブ、ステージカード(クリア済み✓ / 推奨戦力比較 / 敵サムネ / 報酬 / BOSS) | `GET /api/dungeons`, `POST /api/battle/start` |
| BATTLE | `BattleLog` のタイムライン再生 + ドロップ表示。倍速 / 一時停止 / スキップ / 再生し直し | (再生のみ。計算しない) |
| COLLECTION | `GET /api/master` のキャラ・敵一覧。未入手はシルエット | `GET /api/master` |
| SETTINGS | 既定倍速、軽量モード、ダメージ数値、カットイン、画面揺れ、ログ行数、自動リザルト、モックモード | — |

### エラー / ローディング

- API呼び出しは `client/src/api/client.ts` に集約。`ApiResponse<T>` 封筒をここで剥がし、
  失敗は `ApiClientError`(`code` + 日本語メッセージ)として **例外** で投げる。
- バックエンド未起動でも画面は白くならない。`ErrorView` が日本語のエラー文・コード・
  **再試行ボタン** を出し、「モックモードで確認できる」旨を案内する。
- 戦闘中(`screen === 'BATTLE'`)はデータ取得状態に関係なく再生を優先する。

---

## 2. 仮キャラクター画像 (CharacterArt)

`client/src/components/CharacterArt.tsx`。画像アセットは使わず、`CharacterArt`
(`primary` / `secondary` / `accent` / `sigil` / `pattern`)から合成する。

構成レイヤー(下から):

1. `cart-base` — `primary → secondary` の斜めグラデーション + `accent` の放射光
2. `cart-svg` — `pattern` ごとのインラインSVG(`mix-blend-mode: screen`)
3. `cart-vignette` — 周辺減光
4. `cart-sigil` — 紋章文字(`accent` で二重グロー)
5. レアリティ演出(SSR/UR のスパークル、UR のプリズム掃引)
6. `cart-scan` — 走査線

### pattern 6種の描き分け

| pattern | 見た目 | 実装 |
|---|---|---|
| `grid` | 方眼 + 節点ドット + 二重の和風角枠 | `<pattern>` タイル + 上方向フェードマスク |
| `wave` | 青海波(和) + 下部の波形シルエット | 半円アークの `<pattern>` タイル |
| `burst` | 中心からの放射光条 26本 + 同心円 | 名前から決定論的に角度/太さを生成 |
| `circuit` | 基板の配線 + パッド + 破線枠 | ランダムな L字トレース14本 |
| `petal` | 桜の五弁花 + 散る花びら | ベジェの花びらパスを回転/散布 |
| `void` | 黒い球体 + 同心リング + 星屑 | 内側へ吸い込む放射グラデーション |

未知の `pattern` や `art` 未設定は `grid` + 既定色にフォールバックする。
乱数はキャラ名＋紋章からのハッシュなので、**同じキャラは常に同じ絵**になる。

### レアリティ差別化

| レアリティ | 枠 | 追加演出 |
|---|---|---|
| N | 灰の細枠 | なし |
| R | 青枠 + 薄いリング | なし |
| SR | 紫枠 + グロー | なし |
| SSR | 金のコニックグラデ枠(回転) + 強いグロー | スパークル6粒 |
| UR | 虹色コニックグラデ枠(回転) + マゼンタの強発光 | スパークル10粒 + プリズム掃引 |

図鑑の未入手は `silhouette` で彩度0・輝度28%、紋章は `?` に置換する。

### 立ち絵 (portrait) 対応

`CharacterArt.portrait` にアセットキー(例 `"momiji_kc"`)が入っている場合、`CharacterArtView`
はプロシージャル描画の代わりに実画像を敷く。**解決順は1箇所(`CharacterArt.tsx` の
`resolvePortraitSrc`)にまとめてある**:

1. `window.__AKATAN_PORTRAITS__[key]` — オフライン単体版にビルド時埋め込まれる data URL。
   `file://` では相対パスが解決できないため、単体版のビルドスクリプトがこのオブジェクトへ
   立ち絵を data URL として注入する。存在すれば最優先で使う。
2. `${import.meta.env.BASE_URL}portraits/<key>.webp` — 通常のWeb版(`client/public/portraits/`)。
3. 上記どちらも失敗した場合(`<img onError>`) — 従来のプロシージャル描画(pattern 6種)へ
   フォールバックする。画像アセットを持たないキャラも、画像読み込みに失敗した環境でも、
   画面は崩れない。

その他の挙動:

- **未入手(シルエット)表示中は立ち絵を出さない。** `silhouette` が true のときは
  `portrait` の有無に関わらず常にプロシージャル描画(彩度0・`?`)を使う。図鑑で
  未入手キャラの正体が見えてしまわないようにするため。
- レアリティ枠(SSR金のコニックグラデ回転枠 / URの虹コニックグラデ回転枠 + スパークル +
  プリズム掃引)は立ち絵使用時も**そのまま維持**する。`.cart-portrait-img` は
  `object-fit: cover` で敷き、`.cart-ratio-square`(カード・戦闘ユニット・ガチャ演出)は
  `object-position: 50% 10%`、`.cart-ratio-portrait`(キャラ詳細・図鑑)は `50% 14%` を
  基準に頭部が切れないようにしている。
- 立ち絵はキャラカード・キャラ詳細・戦闘画面・図鑑・ガチャ演出のすべてで
  `CharacterArtView` 経由で共通に使われる(呼び出し側の追加対応は不要)。

---

## 3. BATTLE 画面の演出

### 再生の原則

- クライアントは **一切計算しない**。`BattleLog.events` を `seq` 順に再生するだけ。
- `snapshot` を持つイベントでは、全ユニットの HP / 行動ゲージ / 必殺ゲージ / 状態異常 /
  生存 / 覚醒を **その値へ即座に上書き** する。演出がどうズレても snapshot が唯一の正解。
- 実装: `client/src/battle/playback.ts`(`applyEvent` は純関数、`useBattlePlayback` が駆動)。

### イベント種別ごとの「間」(1x基準, ms)

| イベント | 間 | イベント | 間 |
|---|---|---|---|
| `BATTLE_START` | 1000 | `ULT_READY` | 420 |
| `TURN_START` | 420 | `AWAKEN` | 1500 |
| `ACTION_START` | 230 | `COMBO` | 1000 |
| `SKILL_USE` | 480 | `DEFEAT` | 780 |
| `DAMAGE` | 380 | `ACTION_END` | 140 |
| `HEAL` | 400 | `BATTLE_END` | 1100 |
| `STATUS_APPLY` | 300 | `STATUS_TICK` | 300 |
| `STATUS_EXPIRE` | 170 | `STATUS_RESIST` | 260 |
| `GAUGE_CHANGE` | 180 | | |

倍速(1x / 2x / 4x)はこの値を割る。軽量モードではカットイン系の尺を短縮する。

### BattleEvent → 演出の対応表

| BattleEvent | 画面の表現 |
|---|---|
| `BATTLE_START` | 中央に「戦闘開始」バナー(ぼけ→収束) |
| `TURN_START` | 「TURN n」バナー(小)、ヘッダのターンバッジ更新、ログに区切り線 |
| `ACTION_START` | 行動ユニットが浮上・シアン発光・拡大(`.is-active`) |
| `SKILL_USE` | 通常スキル: 短いカットイン帯。必殺技(`isUltimateFx`): 全画面カットイン(放射線 + 立ち絵 + 技名)+ 画面の大揺れ |
| `DAMAGE` | 対象にFXバースト、被弾シェイク(白飛び)、HPバー減少 + 白い遅延ゴーストバー、ダメージ数値ポップアップ |
| `DAMAGE` (`critical`) | 数値が大型・金色・回転して飛び出し「CRITICAL」表記 + 画面フラッシュ |
| `DAMAGE` (`affinity>1`) | ポップアップに「弱点」表記(金) |
| `DAMAGE` (`affinity<1`) | ポップアップに「耐性」表記(灰) |
| `HEAL` | 緑の粒子が上昇 + 収束リング、緑のポップアップ、HPバー増加 |
| `STATUS_APPLY` | 状態異常アイコンが回転しながら出現(残ターン数付き)、状態名ポップアップ |
| `STATUS_EXPIRE` | アイコン消滅(ログにのみ記載) |
| `STATUS_TICK` | 毒/火傷は紫のしずくFX + 継続ダメージ数値、再生は緑の回復数値(値0なら非表示) |
| `STATUS_RESIST` | 「RESIST」ポップアップ + 二重リング |
| `GAUGE_CHANGE` | 「+n%」ポップアップ、行動/必殺ゲージが即時追従 |
| `ULT_READY` | 必殺ゲージが明滅、「必殺 READY」ポップアップ |
| `AWAKEN` | 全画面の覚醒カットイン(拡大+ブラー解除)、光柱FX、画面の大揺れ、以降ユニットが金枠オーラ常時点灯 |
| `COMBO` | コンボカットイン(2名の名前)、両ユニットにFX、画面フラッシュ(Phase 4 で本実装が来ても演出はそのまま動く) |
| `DEFEAT` | 撃破FX + 「撃破」ポップアップ + 画面シェイク、ユニットが灰色化して傾き沈む |
| `BATTLE_END` | 「VICTORY」/「DEFEAT」バナー → リザルト |

`event.text` はそのままバトルログ欄へ流し込む(未設定時はクライアント側で日本語を生成)。
ログはイベント種別ごとに色分けし、自動で最下部へスクロールする。

### fx キー → 演出ファミリー

`client/src/battle/fx.ts`。解決順は **① 覚醒/コンボ → ② 先頭トークン → ③ キー全体 →
④ イベント種別のフォールバック**。`ult_` / `finisher_` の接頭辞は②の前に剥がす。
これにより `ult_flame_burst` は炎演出、`dark_wave` は闇演出(波ではない)になる。

| ファミリー | 対応キーの例 | 見た目 |
|---|---|---|
| `slash` | `slash`, `flame_slash`, `*_edge` | 2本の斬線がクリップパスで走る |
| `pierce` | `light_pierce`, `*_arrow`, `*_shot` | 細い槍が外から中心へ突き刺さる |
| `impact` | `impact`, `rock_smash`, `*_bash` | 極太リング + 短い破片 + 画面シェイク |
| `flame` | `flame_burst`, `ember_aura`, `ult_flame_veil` | 炎片が揺らぎながら上昇 |
| `frost` | `ice_*`, `freeze_*` | 六角の氷晶が飛散 + 破線リング |
| `thunder` | `thunder_*`, `volt_*`, `spark_*` | 稲妻形をステップ再生 + フラッシュ |
| `aqua` | `water_shot`, `ult_tide`, `*_ripple` | 水滴が飛散 + 内側発光リング |
| `gale` | `wind_slash`, `wind_bind`, `ult_storm` | 風の線が回転しながら外へ |
| `earth` | `earth_quake`, `earth_wall`, `ult_earth_ruin` | 岩片が回転して飛ぶ + シェイク |
| `holy` | `holy_bolt`, `light_burst`, `holy_aegis` | 光条が伸びる + 画面フラッシュ |
| `dark` | `dark_wave`, `dark_drain`, `shadow_*` | 影の粒が外から内へ渦を巻く |
| `void` | `ult_void`, `void_bolt`, `ult_abyss` | 黒球が収縮(インプロージョン) |
| `glitch` | `glitch`, `glitch_hack`, `ult_glitch_purge` | 横帯がステップでズレる(デジタルノイズ) |
| `acid` | `poison_cloud`, `poison_puff` | 液滴が滴り落ちる |
| `laser` | `laser` | 横一線の走査ビームを連射 |
| `roar` | `roar`, `*_howl` | 巨大な同心リングのみ |
| `heal` | `heal_wave`, `ult_heal_spring` | 緑の粒子上昇 + 収束リング |
| `cleanse` | `purify_wave`, `dispel_*` | 点線リングが上へ収束 |
| `buff` / `debuff` | `*_up` / `curse_mark`, `*_down` | 上向き▲ / 下向き▼の粒 |
| `gauge` | `*_charge`, `tempo_*` | 破線リング + 上昇粒 |
| `ult` | 上のどれにも当たらない `ult_*`(例 `ult_dawn`, `ult_starfall`) | 特大コア + 極太リング + 長い光条 |
| `awaken` | `awaken_*` | 金の光柱が立ち上る + 特大フラッシュ |
| `combo` | `combo_*`, `*_link` | 二重リング + 光球の拡散 |
| `defeat` / `resist` / `stun` | `defeat`, `resist`, `stun` | 撃破破片 / 二重の盾リング / 星がぐるぐる |
| `equip` | `equip:*`(例 `equip:burn_on_hit`) | 小さな光沢グリント(控えめ。スキルより地味・コンボより地味) |
| `generic` | 未知のキーすべて | リング + コア + 放射する破片(属性色) |

**装備の特殊効果(`ItemSpecialEffect`)は `fx` が `"equip:"` で始まることで判別する**
(戦闘エンジン側の規約)。`skillId` は未設定、`skillName` に特殊効果名が入る(`COMBO` と同じ
流儀)。イベント種別は既存の `DAMAGE` / `STATUS_APPLY` / `STATUS_RESIST` を再利用するため、
専用のイベント種別追加は無い。`equip` ファミリーは尺380msと短く、画面揺れも無し
(`screen: 'none'`)で、「装備が光った」と分かる程度に抑えている。

**未知の `fx` は必ず `generic` にフォールバックする**ので、データ側が新しいキーを
足しても画面は壊れない(色は `event.element` から取る)。
`ult_` で始まるキーは、ファミリーが何であれ破片数 +4・画面フラッシュ・尺900ms以上に
引き上げられ、必殺技として「大きく」見える。

### 操作

- **倍速**: 1x / 2x / 4x(既定値は設定画面)。
- **一時停止 / 再開**。
- **スキップ**: 残りイベントを演出なしで一括適用し、即リザルトへ。
- **再生し直す**: 終了後に同じログを頭から再生。
- 上部に再生進捗バー(`seq` ベース)。

### リザルト

勝敗タイトル(拡大→収束) → 獲得EXP / ゴールド → **レベルアップ演出**
(`BattleRewards.levelUps` の `fromLevel ▶ toLevel` と `statGain` を順番にスライドイン)
→ **ドロップ表示**(`BattleStartResponse.drops`。敗北時は `null` でこの区画ごと非表示)
→ **MVP**(味方の `damageDealt` 最大)→ 全ユニット戦績テーブル(折りたたみ)
→ 「ダンジョンへ戻る」/「もう一度戦う」。

#### ドロップ表示 (`DropsSection`, `client/src/battle/BattleScreen.tsx`)

- `DropResult` の `gold` / `equipment` / `materials` / `tickets` / `characters` をそれぞれ
  チップ(`drop-chip`)として並べる。入場アニメーション(`drop-in`)付き。
- **装備は `ItemRarity`(6段階)の色で左ボーダーを塗り分ける**(`irar-COMMON`〜`irar-MYTHIC`)。
  高レアほど目立つ配色にし、演出の格を変える。
- **キャラクタードロップ**: `CharacterDropResult.duplicate` で分岐する。
  - 新規入手 → 立ち絵/プロシージャル画像 + 「新規入手!」(緑)
  - 重複 → 「重複 → 素材変換(素材名×個数)」(灰)。**「ハズレ」に見えない文言にする**
    (設計書§27)。
- 何もドロップしなかった場合(`gold<=0` かつ全配列が空)は「今回のドロップはありませんでした。」
  の1行のみ表示し、空のグリッドやレイアウト崩れを起こさない。
- `drops` が `null`/`undefined`(敗北時 or 未対応バックエンド)の場合は区画自体を描画しない
  (勝敗以外の要素が減っても違和感なく流れる)。

---

## 4. SUMMON (ガチャ) 画面

`client/src/screens/GachaScreen.tsx`。`GET /api/gacha` でバナー一覧・天井カウント・
所持チケットを取得し、`POST /api/gacha/pull` で抽選する。**抽選は100%サーバ権威**
(設計書§37)。クライアントは結果を受け取って演出するだけで、確率計算は一切行わない。

### 画面構成

- バナータブ(`gacha-banner-tab`)。ピックアップバナーには `PICKUP` バッジ。
- 選択中バナーの詳細: 名前・説明・ピックアップ対象(名前解決は `store.master.characters`
  から動的に行う。ID直書きはしない)・天井(`pity.count` と残り連数)・10連最低保証
  (`guarantee10`)・**排出率テーブル**(`GachaRates.rarity` を全件バーで表示。隠さない)。
- 単発/10連ボタン。`cost`/`cost10` の `currency`(`GOLD` or `TICKET`)を見て所持量と比較し、
  不足時はボタンを無効化 + 理由(「GOLDが足りません(必要n/所持m)」等)を表示する。
- 装備バナーの排出率テーブルは `Rarity`(N〜UR)の「格」を示す。実際に生成される装備の
  `ItemRarity`(COMMON〜MYTHIC)は結果カードで別途確定表示する(バナー欄にその旨を注記)。

### 演出の3段階

1. **ためる (`charging`)**: 召喚アイコンが明滅する円環アニメーション(`gacha-charge`)。
   尺は結果内の最高レアリティ格(`anyRarityTier`)に応じて 500〜1380ms に伸びる
   (高レアほど「溜め」が長い = 期待感を煽る)。
2. **レアリティ確定 (`revealing`)**: 10連は1件ずつ `GachaResultCard` を開示する。
   1件あたりの尺もレアリティ格で変える(`TIER_REVEAL_MS`: N/COMMON域 420ms 〜
   UR/MYTHIC域 1500ms)。「一括表示」でいつでも残りをスキップしサマリーへ、
   「次へ ▶」で任意のタイミングで手動送りできる。
3. **結果表示 (`summary`)**: 全件をグリッドで一覧表示。天井到達分があれば
   「天井到達あり」バッジ。「閉じる」/「同じ条件でもう一度」。

### レアリティ別の演出差

`anyRarityTier()`(`utils/labels.ts`)が `Rarity`/`ItemRarity` のどちらでも 0〜4 の
5段階に正規化する(装備の6段階は EPIC以上をSSR格・MYTHICをUR格に寄せて圧縮)。

| tier | 対応 | 見た目 |
|---|---|---|
| 0 | N / COMMON・UNCOMMON | 灰枠、演出無し |
| 1 | R | 青枠 + 弱いグロー |
| 2 | SR | 紫枠 + グロー |
| 3 | SSR / EPIC・LEGENDARY | 金枠 + 内外グロー + 回転する光条バースト(`result-burst`) |
| 4 | UR / MYTHIC | 虹コニックグラデ回転枠 + 強グロー + 大型バースト。charging 段階のオーブも虹色・高速回転になる |

`GachaPullResult.byPity` が true の枠には「天井到達」バッジ(マゼンタ)を付け、
天井による確定であることを隠さない。

### キャラ / 装備 / 重複の表示

- **キャラクター**: `CharacterArtView`(立ち絵 or プロシージャル)+ 名前。
  - 新規入手 → 「NEW」(緑)。
  - 重複(`duplicate: true`) → **「重複 → 素材に変換(素材名×個数)」** と表示する。
    「ハズレ」の見た目(暗転・×印など)には絶対にしない(設計書§27)。素材名は
    `store.master.materials` から解決し、無ければ素材IDをそのまま出す(フェイルセーフ)。
- **装備**: スロットアイコン・名前・スロット/アイテムLv/レアリティ。単発結果や10連の
  個別開示時(`big`)はステータス内訳と特殊効果名も表示する。

### 軽量モード / reduced-motion

`effectPolicy(settings).cutIn` が false(軽量モード or `prefers-reduced-motion: reduce`)
のときは、ためる/1件ずつ開示の演出を丸ごとスキップし、抽選結果を即座にサマリー表示する。
結果自体(排出率・天井・重複表示)は変わらず、演出の尺だけを削る。

### 既知の注意点(オーバーレイのレイアウト)

`.gacha-overlay` は固定オーバーレイに `overflow-y: auto` を付け、`.gacha-stage` は
`display: flex; flex-direction: column; align-items: stretch;` にしてある。
**`display:grid; place-items:center` に戻すと、10連サマリーグリッドが shrink-to-fit で
横幅を持てず1カラム縦積みに壊れる**ので、このレイアウト方式を変更する場合は必ず
10連の一括表示を実機で確認すること。

---

## 5. EQUIPMENT (装備) 画面

`client/src/screens/EquipmentScreen.tsx`。`GET /api/inventory` で装備/素材/チケットを
取得し、`POST /api/equipment/{equip,unequip,sell,favorite,sell-bulk}` で操作する。

### 情報設計

- **一覧**: スロット(全部/武器/防具/装飾品)・レアリティ(6段階チップ)・
  アイテムLv(下限セレクト)・**お気に入りのみ**(第6ラウンド)・**能力値(下限値指定)**で
  絞り込み、アイテムLv順/レアリティ順/スロット順/名前順/**能力値順**(昇順/降順トグル付き)
  でソートする。カードは Prefix+ベース+Suffix の合成名(`EquipmentInstance.name`)、
  `stats`(フラット)、`statsPercent`(%)、`special`(特殊効果名)、装着中バッジ、
  お気に入りバッジを表示する。
- **能力値での絞り込み・ソート**: 選べるステータスは `Stats`(shared/src/types.ts、
  `StatKey` の実体)にある8種(`hp`/`attack`/`defense`/`speed`/`critical`/
  `criticalDamage`/`resistance`/`healing`)のみ(`EQUIPMENT_STAT_KEYS`、
  `utils/equipment.ts`)。並び替え・絞り込みの基準値は `equipmentStatValue()`
  (`utils/equipment.ts`)が返す、その装備の `stats`(mainStat+affixのフラット合算値。
  生成時点で確定済み)と `statsPercent`(装着キャラ基準の%加算、装備単体では正確な
  フラット換算ができないため目安として単純加算)を足した「実効値の目安」。
  絞り込み条件(スロット/レアリティ/Lv/お気に入り/能力値)やソート基準・方向を
  変更すると、一覧の性能対策(後述)の表示件数は必ずリセットされる。
- **レアリティ枠**: `ItemRarity` 6段階(`irar-COMMON`〜`irar-MYTHIC`)。COMMON〜LEGENDARY
  は色付きボーダー+グローを段階的に強め、**MYTHICだけ虹コニックグラデーションの回転枠**
  (キャラのURと同格の特別感)にして明確に差別化する。
- **装着前後の比較(ハクスラの核)**: カードを選ぶと DETAIL 区画が開き、装着先キャラを
  選択すると `装着前後の変化` が即座に出る。「既存の武器と入れ替わります」の注記に続けて、
  各ステータスを `現在値 ▶ 装着後の値 (+n / -n)` の行で並べる(`combinedDelta`:
  新装備の加算 − 既存装備の加算、を1つのdeltaマップにまとめて計算)。増加は緑、
  減少は赤で色分けする。**確定値ではなくクライアント側の概算プレビュー**であることを
  踏まえ、最終値は装着実行後のサーバ応答(`EquipResponse.character`)で必ず上書きする。
- **お気に入り(第6ラウンド)**: カードヘッダの★ボタン(`FavoriteButton`)で
  `POST /api/equipment/favorite` を呼び、`EquipmentInstance.favorite` をon/offする。
  お気に入りの装備は「選択して売却」モードでチェックボックスが無効化され
  「お気に入り(売却不可)」と明示される(サーバの単発売却APIは favorite を見ないため、
  **クライアント側で確実に選択させないことで誤売却を防ぐ**)。一括売却からは
  サーバ側(`sellEquipmentBulk`)が必ず除外する。
- **売却**: 「選択して売却」でチェックボックス選択モードに切り替え、複数選択して
  一括売却する。**装着中・お気に入りの装備はチェックボックスを無効化**し、それぞれ
  「装着中(売却不可)」「お気に入り(売却不可)」と明示する(誤操作防止。サーバ側の
  `BAD_REQUEST` にも保険で当たる)。
- **レアリティ一式の一括売却(第6ラウンド)**: 装備が増えすぎてラグの原因になる問題への
  対策。「レアリティで一括売却」で `maxRarity`(以下)と任意の `belowItemLevel`(未満)を
  選び、`estimateBulkSell()`(`utils/equipment.ts`。サーバの `sellPrice()` と同じ算出式を
  複製した確定値プレビュー)で「対象件数・獲得予定GOLD・装着中/お気に入りで保護される件数」
  を**実行前に必ず表示**してから、明示的な「本当に売却する」クリックで
  `POST /api/equipment/sell-bulk` を呼ぶ(取り返しがつかない操作のため二段階確認)。
  実行後は実際のサーバ応答(`count`/`gold`/`skipped`)で結果を上書き表示する。
- **一覧の性能(第6ラウンド)**: 装備が数百件になっても一気に描画しないよう、
  一覧は `PAGE_SIZE`(60件)ずつ表示し、残りは「もっと見る」ボタンで追加読込する。
  スロット/レアリティ/Lv/お気に入り/能力値絞り込み/ソート(基準・方向)を変更すると
  表示件数はリセットされる。
  `?mock=1&stress=N` でモックの所持装備をN件まで水増しでき、負荷再現・計測に使う
  (`client/src/mock/player.ts`)。
- **EQUIPPED 区画**: 装備を1つ以上装着しているキャラを一覧し、スロットごとに
  「外す」ボタンを置く。キャラ詳細画面からもこの画面へ遷移でき(`装備を変更→`)、
  遷移先は `route.equipCharUid` でそのキャラを装着候補として初期選択する。

### エラー表示

`describeError()`(`api/client.ts`)が `NOT_ENOUGH_CURRENCY` / `SLOT_MISMATCH` /
`ALREADY_EQUIPPED` を含む全エラーコードを日本語文に変換する。EQUIPMENT / SUMMON 画面は
これをそのままエラーボックスまたはボタン直下の理由文として表示する。

---

## 6. モックモード(デモモード)

バックエンドが無くても **全画面と戦闘演出をレビューできる**モード。

### 使い方

1. `npm run dev -w client`
2. ブラウザで **`http://localhost:5173/?mock=1`** を開く
   - もしくは SETTINGS 画面の「モックモードで再読み込み」ボタン(localStorageに保存)
3. 画面上部にピンクの `DEMO MODE` 帯が出れば有効
4. DUNGEON → 任意のステージ → 「戦闘開始」で、その場で生成したログを再生する
   (ボス戦は装備ドロップが出やすい)
5. **SUMMON → 「召喚: 孤月 紅葉(幽波紋)」バナー** で、ユーザー本人の探索者
   `momiji_kc` の立ち絵を使ったガチャ演出(UR確定の天井は50連)を確認できる
6. **装備** で所持装備8点の一覧・装着前後の比較・お気に入り・売却・レアリティ一括売却を
   確認できる
7. 解除は `?mock=1` を外してリロード、または SETTINGS の「モックモードを終了」
8. **負荷検証用**: `?mock=1&stress=500` のように `stress` を付けると、装備の所持数を
   指定件数まで水増しする(既定は0=何もしない)。装備一覧が数百件になっても重くならない
   ことを確認するための専用パラメータ(`client/src/mock/player.ts`)

### 中身

| ファイル | 内容 |
|---|---|
| `client/src/api/mode.ts` | `?mock=1` / localStorage の判定 |
| `client/src/mock/master.ts` | ダミーのキャラ11体(**`ch_momiji_kc` = 孤月 紅葉、UR/VOID/CONTROL・SPECIALIST、`art.portrait: 'momiji_kc'`** を含む)・敵7体・スキル約35・AI 5種・2章8ステージ・コンボ7種(未実装キャラ参加の1種を含む)・`MOCK_PLANNED_CHARACTERS`(`ch_hitori` = 電子 独(幽波紋)、`ch_mikoto`)・素材7種 |
| `client/src/mock/player.ts` | 所持キャラ8体・パーティ・所持金・**初期所持装備(`mockState.inventory`)**。一部キャラは次Lvまで残りEXPを少なく設定し、**1戦でレベルアップ演出が必ず出る**。`applyEquipmentStats` が装着中装備のステータスを `CharacterView.stats` に反映する。`?stress=N` で所持装備をN件まで水増しする負荷検証フック付き |
| `client/src/mock/equipment.ts` | 装備生成(ベース9種×Prefix6×Suffix6×特殊効果5、レアリティ別倍率)、ドロップ抽選(`rollMockDrops`)、初期所持品(`buildStarterInventory`)、売却額算出 `mockSellPrice`(単発売却・一括売却で共通利用) |
| `client/src/mock/gacha.ts` | バナー定義3種(常設 / `momiji_kc` ピックアップ / 装備)、天井・10連保証・ピックアップ抽選を行う `pullBanner` |
| `client/src/mock/battle.ts` | 決定論的(シード固定)な簡易シミュレータ。`BattleLog` を生成する(装備ドロップ・ガチャとは独立) |
| `client/src/mock/index.ts` | `GameApi` と同じ形の `mockApi`(`inventory` / `equip` / `unequip` / `sellEquipment` / `favoriteEquipment` / `sellEquipmentBulk` / `getGacha` / `gachaPull` を含む)。`api()` が実装を切り替える |

モックログには `BATTLE_START` / `TURN_START` / `ACTION_START` / `SKILL_USE` / `DAMAGE` /
`HEAL` / `STATUS_APPLY` / `STATUS_TICK` / `STATUS_EXPIRE` / `STATUS_RESIST` /
`GAUGE_CHANGE` / `ULT_READY` / `AWAKEN` / `COMBO` / `DEFEAT` / `ACTION_END` /
`BATTLE_END` がすべて含まれる(覚醒条件は hpBelow / turnAtLeast / enemyDefeated /
allyDefeated / skillUsed をモック側でも実装済み)。**装備の特殊効果(`fx: "equip:*"`)は
モックの戦闘シミュレータでは未実装**(ドロップ/装着/ガチャの演出レビューが目的のため)。

> モックのシミュレータ・ガチャ・装備生成は **演出レビュー専用の代役**であり、本番の
> 数値・排出率・バランス(スキル名や効果を含む)とは無関係。BATTLE / SUMMON / EQUIPMENT
> 画面自体は本番でもモックでも「サーバ(またはモック)の応答をそのまま表示するだけ」で、
> 同じコードを通る。UIコンポーネント側にキャラ固有のスキル名・効果・数値を
> ハードコードしている箇所は無い(すべて `CharacterDef`/`Skill`/`EquipmentInstance` 等の
> API応答から動的に描画する)。

---

## 7. デザイン / アクセシビリティ

- ダークな近未来ネオン(シアン / マゼンタ / バイオレット)+ 和のアクセント(朱・金・青海波・桜)。
- デザイントークンは `client/src/styles/base.css` の `:root` に集約。属性色は `--el-*`、
  レアリティ色は `--rar-*`。
- 基準幅 1280px。`app-main` は `max-width: 1280px`。狭い画面ではグリッドが1カラムへ落ち、
  **横スクロールは出ない**(`body { overflow-x: hidden }` + カード幅の縮小)。
- `prefers-reduced-motion: reduce` を尊重し、全アニメーションを実質停止する。さらに
  `effectPolicy()` がカットイン・画面揺れ・粒子を自動でOFFにする(軽量モードと同じ扱い)。
- HPバーは色だけでなく **数値も併記**、状態異常は **アイコン + 残ターン数**、弱点/耐性は
  色に加えて **「弱点」「耐性」の文字** を出す(色覚特性への配慮)。
- 主要な操作要素は `button` / `select` を使い、編成枠は `role="button"` + Enter/Space に対応。
- 画面揺れと被弾シェイクは Web Animations API (`element.animate`) で再生し、
  ユニットの再マウントを避けている(HPバーのトランジションが途切れないため)。

---

## 8. 音声 (BGM / 効果音)

- `client/src/audio/` に実装。`AudioManager.ts` がフレームワーク非依存のシングルトンで
  BGM/SFXの再生を持ち、`AudioProvider.tsx` が React Context として橋渡しする
  (`useAudio().playSfx(key)` / `useAudio().playSkillSfx(skillId, fallback)` /
  `useAudio().setScene(scene)`)。
- **割り当てデータ**: `data/system/audio.json`(`MasterDataResponse.audio`)を正とし、
  未配信/未起動でも壊れないよう `client/src/audio/defaultConfig.ts` に同内容のフォールバックを
  持つ(サーバが配信し始めたらそちらが優先される)。
- **BGM**: シーン(`AudioScene`)が変わっても曲ファイルが同じなら再生を継続する(頭出ししない)。
  曲が変わるときだけ2つの `<audio>` 要素をクロスフェード(約550ms)する。シーンに対応が
  無い場合(例: SETTINGS画面)は直前の曲を継続する。`App.tsx` の `SceneSync` が
  `store.route.screen` の変化を見て `setScene()` を呼ぶ。
- **効果音**: `<audio>` 要素のプール(10個)を使い回して同時発音に対応する。倍速(2x/4x)再生時に
  同種の効果音が詰まらないよう、`SfxKey` ごとに最短発音間隔(90〜280ms)で間引く。
  `BattleScreen.tsx` の `sfxForEvent()` が `BattleEvent.type` → `SfxKey` を決める
  (`DAMAGE`→`HIT`/`CRITICAL`、`SKILL_USE`→`SKILL`/`ULTIMATE`〈`fx` が `ult_` 始まりなら〉、
  `AWAKEN`/`COMBO`/`DEFEAT` はそのまま)。`playback.ts` の `useBattlePlayback` に渡す
  `onEvent` コールバックとして接続しており、スキップ再生(`silent`)では鳴らさない。
- **スキル別効果音(第6ラウンド)**: `SKILL_USE` イベントだけは `sfxForEvent()` の結果を
  `playSfx()` に直接渡さず、`onBattleEvent` が `audio.playSkillSfx(ev.skillId, fallback)` を
  呼ぶ。`AudioConfig.skillSfx[ev.skillId]` に専用トラックの定義があればそれを優先して鳴らし
  (`AudioManager.playSkillSfx`。間引きのgapキーは `skill:<skillId>` でSKILL/ULTIMATEの
  間引きと独立させている)、無ければ従来どおり汎用の `SKILL`/`ULTIMATE` にフォールバックする。
  **既知の課題(バックエンド側)**: `server/src/data/loader.ts` の `mergeAudioConfig()` が
  `skillSfx` をレスポンスへコピーしておらず、`GET /api/master` の `audio.skillSfx` は
  現状 `null` になる(`bgm`/`sfx`/`defaults` はコピーされているが `skillSfx` だけ漏れている)。
  クライアント側のロジックは `GET /api/master` を横取りして `skillSfx` を注入した状態で
  Playwrightで動作確認済み(`sk_momiji_kc_timeskip` → `skill_tokitobasi.wav` が正しく
  再生される)。バックエンド側のこの一行修正が入るまでは、音源自体は存在していても
  専用効果音は鳴らず、従来の汎用 `SKILL` にフォールバックし続ける(無音で壊れはしない)。
- **自動再生制限への対応**: 最初のユーザー操作(`pointerdown`/`keydown`/`touchstart`)まで
  実際の再生は行わず、`setScene`/`playSfx` の呼び出しは「保留」するだけで画面には影響しない。
  最初の操作で保留中のBGMシーンを再生する。
- **音源の解決**: `client/src/audio/resolve.ts` の `resolveAudioSrc()` が唯一の解決箇所。
  `window.__AKATAN_AUDIO__[file]`(オフライン単体版に注入されるdata URL)→
  `public/audio/<file>` の順で解決する(`CharacterArt.tsx` の `resolvePortraitSrc` と同じ作り)。
  音源が読めない/再生に失敗しても例外は握りつぶし、無音のまま画面は壊れない。
- **設定**: SETTINGS画面の AUDIO パネルで BGM音量 / 効果音音量 / ミュートを変更でき、
  `state/settings.ts`(`bgmVolume` / `sfxVolume` / `audioMuted`)経由で `localStorage` に保存される。

---

## 9. RAID 画面

- `client/src/screens/RaidScreen.tsx`。`GET /api/raid` でボス一覧 + 進行状況(`RaidState`)を
  取得し、ボスごとに **巨大なHPバー**(`remainingHp / totalHp`)・挑戦回数・累計与ダメージ・
  弱点属性/無効状態異常・ギミック一覧(HP割合ごとの発動条件と発動済みフラグ)を表示する。
- 「挑戦する」を押すと `store.startRaidBattle(boss)` が `POST /api/raid/attack` を呼び、
  戦闘そのものは **既存の BATTLE 画面の再生をそのまま使う**(表示用に `RaidBossDef` から
  簡易な `StageDef` をその場で組み立てるだけで、戦闘エンジンには一切手を入れていない)。
- `store.raidContext` が「今再生中の戦闘がレイド挑戦によるものか」を橋渡しし、
  `BattleScreen.tsx` のリザルトに **RAID DAMAGE セクション**(`RaidDamageSection`)を追加表示する。
  `RaidAttemptResult` の `hpBefore` → `hpAfter` を大きなバーで見せ、「1回では倒せない」設計を
  「確実に削れている」実感に変える。新たに発動したギミックもここに出す。
- レイド文脈では「ダンジョンへ戻る」→「レイドへ戻る」、「もう一度戦う」→
  「レイドへ戻ってもう一度挑む」に文言を差し替える(ボス定義がBATTLE画面には無いため、
  再挑戦はRAID画面からのボタン操作に統一している)。撃破時はこのボタン自体を隠す。
- 撃破時のキャラドロップは既存の `DropsSection`(リザルトの仕組み)をそのまま流用する。
- `RAID_DEFEATED`(撃破済みボスへの再挑戦)は `describeError()` で日本語化して表示する。
- サーバ未起動/`/api/raid` 未実装の環境でも画面が壊れないよう、取得失敗時は
  再試行ボタン付きのエラー表示に落ちる(モックモードへの誘導文言つき)。

---

## 10. ディレクトリ

```
client/src/
  main.tsx                     エントリ (StrictMode は使わない: 演出の二重適用を避ける)
  App.tsx                      ヘッダ + 画面切り替え (EQUIPMENT / GACHA を含む)
  api/
    client.ts                  API集約 / ApiResponse 封筒の剥がし / ApiClientError / raid含む
    mode.ts                    モックモード判定
  audio/
    AudioManager.ts            BGM/SFX再生のシングルトン(クロスフェード・自動再生制限対応)
    AudioProvider.tsx          React Context 橋渡し (useAudio)
    resolve.ts                 音源パスの解決 (resolvePortraitSrcと同じ作り)
    defaultConfig.ts           data/system/audio.json のフォールバック複製
  state/
    store.tsx                  Context + useState のみの状態管理 (inventory / raidContext 含む)
    settings.ts                設定の永続化 / effectPolicy() / 音量設定
  components/
    CharacterArt.tsx           立ち絵(実画像) + プロシージャル キャラ画像 (pattern 6種) の合成描画。
                                resolvePortraitSrc() が立ち絵の解決順を一元管理する
    common.tsx                 Loading / ErrorView / CharacterCard / StatRow / Panel
  battle/
    fx.ts                      fxキー → 演出ファミリーの解決 (装備の `equip:` 接頭辞を含む)
    playback.ts                タイムライン再生エンジン (applyEvent / useBattlePlayback / onEvent)
    BattleScreen.tsx           BATTLE画面 + カットイン + リザルト + ドロップ表示 + 効果音 + RAID DAMAGE
  screens/                     HOME / CHARACTERS / CHARACTER_DETAIL / PARTY / EQUIPMENT /
                               GACHA / DUNGEON / RAID / COLLECTION / SETTINGS
  mock/                        デモモード用データ + 簡易シミュレータ + ガチャ/装備/ドロップ/レイド
  styles/                      base.css (トークン) / ui.css (カード) / battle.css (演出) /
                               gacha.css (SUMMON画面 / EQUIPMENT画面 / ドロップ表示) / raid.css
  utils/
    labels.ts                  日本語ラベル・戦力計算・ItemRarity/Rarity 共通のレアリティ解決
    combo.ts                   コンボ判定 + 未実装キャラの名前解決 (comboMemberName)
    equipment.ts                装備ステータス差分の計算 (装着前後の比較プレビュー) /
                                 一括売却プレビュー (estimateBulkSell / sellPriceEstimate)
```
