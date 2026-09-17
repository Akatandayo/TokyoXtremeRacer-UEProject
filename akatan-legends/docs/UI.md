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
                        └──┬───┬───┬───┬───┬──────────┘
                           │   │   │   │   │
        ┌──────────────────┘   │   │   │   └──────────────┐
        ▼                      ▼   │   ▼                  ▼
  ┌───────────┐          ┌─────────┴─┐  ┌────────────┐  ┌──────────┐
  │CHARACTERS │          │   PARTY    │  │ COLLECTION │  │ SETTINGS │
  │ カード一覧 │          │  5枠編成   │  │   図鑑     │  │  設定    │
  └─────┬─────┘          └─────┬──────┘  └────────────┘  └──────────┘
        │ カードをクリック        │ 「編成を変更」/「編成へ」
        ▼                       ▼
  ┌──────────────────┐    ┌───────────┐
  │ CHARACTER DETAIL │◄───│  DUNGEON  │
  │  §39 の詳細画面   │    │ 章/ステージ│
  └──────────────────┘    └─────┬─────┘
                                │ 「戦闘開始」 POST /api/battle/start
                                ▼
                          ┌───────────┐
                          │  BATTLE   │  ← ヘッダの「戦闘中」タブでも復帰できる
                          │  ログ再生  │
                          └─────┬─────┘
                                │ 終了 → リザルト
                                ├── 「ダンジョンへ戻る」 → DUNGEON
                                └── 「もう一度戦う」 → 同ステージで再度 start
```

| 画面 | 役割 | 主なAPI |
|---|---|---|
| HOME | プレイヤー名 / 所持金 / 編成戦力 / クリア数、次の目標、最近の戦闘6件(localStorage) | `GET /api/player` |
| CHARACTERS | 所持キャラのカードグリッド。属性・ロール・レアリティで絞り込み、4種のソート | `GET /api/player` |
| CHARACTER DETAIL | 仮キャラ画像 / レアリティ / Lv / 転生回数 / 全ステータス / 通常攻撃・スキル・必殺技 / 覚醒条件 / コンボ / TRPG設定 / AI戦術の変更 | `PUT /api/characters/:uid/ai` |
| PARTY | 5枠の編成。D&D + クリック選択。属性・ロール構成と合計戦力をリアルタイム表示 | `PUT /api/party` |
| DUNGEON | 章タブ、ステージカード(クリア済み✓ / 推奨戦力比較 / 敵サムネ / 報酬 / BOSS) | `GET /api/dungeons`, `POST /api/battle/start` |
| BATTLE | `BattleLog` のタイムライン再生。倍速 / 一時停止 / スキップ / 再生し直し | (再生のみ。計算しない) |
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
| `generic` | 未知のキーすべて | リング + コア + 放射する破片(属性色) |

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
→ **MVP**(味方の `damageDealt` 最大)→ 全ユニット戦績テーブル(折りたたみ)
→ 「ダンジョンへ戻る」/「もう一度戦う」。

---

## 4. モックモード(デモモード)

バックエンドが無くても **全画面と戦闘演出をレビューできる**モード。

### 使い方

1. `npm run dev -w client`
2. ブラウザで **`http://localhost:5173/?mock=1`** を開く
   - もしくは SETTINGS 画面の「モックモードで再読み込み」ボタン(localStorageに保存)
3. 画面上部にピンクの `DEMO MODE` 帯が出れば有効
4. DUNGEON → 任意のステージ → 「戦闘開始」で、その場で生成したログを再生する
5. 解除は `?mock=1` を外してリロード、または SETTINGS の「モックモードを終了」

### 中身

| ファイル | 内容 |
|---|---|
| `client/src/api/mode.ts` | `?mock=1` / localStorage の判定 |
| `client/src/mock/master.ts` | ダミーのキャラ10体・敵7体・スキル約30・AI 5種・2章8ステージ |
| `client/src/mock/player.ts` | 所持キャラ8体・パーティ・所持金。一部キャラは次Lvまで残りEXPを少なく設定し、**1戦でレベルアップ演出が必ず出る** |
| `client/src/mock/battle.ts` | 決定論的(シード固定)な簡易シミュレータ。`BattleLog` を生成する |
| `client/src/mock/index.ts` | `GameApi` と同じ形の `mockApi`。`api()` が実装を切り替える |

モックログには `BATTLE_START` / `TURN_START` / `ACTION_START` / `SKILL_USE` / `DAMAGE` /
`HEAL` / `STATUS_APPLY` / `STATUS_TICK` / `STATUS_EXPIRE` / `STATUS_RESIST` /
`GAUGE_CHANGE` / `ULT_READY` / `AWAKEN` / `COMBO` / `DEFEAT` / `ACTION_END` /
`BATTLE_END` がすべて含まれる(覚醒条件は hpBelow / turnAtLeast / enemyDefeated /
allyDefeated / skillUsed をモック側でも実装済み)。

> モックのシミュレータは **演出レビュー専用の代役**であり、本番の戦闘計算とは無関係。
> BATTLE 画面自体は本番でもモックでも「再生するだけ」で、同じコードを通る。

---

## 5. デザイン / アクセシビリティ

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

## 6. ディレクトリ

```
client/src/
  main.tsx                     エントリ (StrictMode は使わない: 演出の二重適用を避ける)
  App.tsx                      ヘッダ + 画面切り替え
  api/
    client.ts                  API集約 / ApiResponse 封筒の剥がし / ApiClientError
    mode.ts                    モックモード判定
  state/
    store.tsx                  Context + useState のみの状態管理
    settings.ts                設定の永続化 / effectPolicy()
  components/
    CharacterArt.tsx           プロシージャル キャラ画像 (pattern 6種)
    common.tsx                 Loading / ErrorView / CharacterCard / StatRow / Panel
  battle/
    fx.ts                      fxキー → 演出ファミリーの解決
    playback.ts                タイムライン再生エンジン (applyEvent / useBattlePlayback)
    BattleScreen.tsx           BATTLE画面 + カットイン + リザルト
  screens/                     HOME / CHARACTERS / CHARACTER_DETAIL / PARTY /
                               DUNGEON / COLLECTION / SETTINGS
  mock/                        デモモード用データ + 簡易シミュレータ
  styles/                      base.css (トークン) / ui.css (カード) / battle.css (演出)
  utils/labels.ts              日本語ラベル・戦力計算
```
