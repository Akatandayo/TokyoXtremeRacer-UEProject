# CHARACTER FORGE — キャラクター作成ツール

ゲーム本体を触らずに、ブラウザだけで新しいキャラクターを作るためのツール。

## 使い方

```bash
node tools/build-character-forge.mjs     # または npm run build:forge
```

`dist-standalone/character-forge.html` が出来るので、**ダブルクリックで開く**だけ。
サーバもネットも要らない。

画面左で入力すると、右に

- **チェック結果** — `scripts/validate-data.mjs` と同じ規則でその場で検査
- **バランスの目安** — 同レアリティの既存キャラの実数値(最小/平均/最大)と自分の値の比較
- **出力** — そのまま `data/` に入れられるJSON

が出る。「チェック結果: OK」になったら出力をダウンロードして、表示される手順どおりに置く。

## 入れ方は2通り

### A. ゲームHTMLに直接組み込む(おすすめ)

遊んでいる `akatan-legends.html` をツールにアップロードすると、
キャラを組み込んだHTMLを書き出す。`data/` もリビルドも要らない。
立ち絵の画像も一緒にアップロードすれば、そのキャラ専用の立ち絵として埋め込まれる。

仕組み: 出来上がったHTMLの `</head>` 直前に

```html
<script id="akatan-extra">window.__AKATAN_EXTRA__={...};</script>
```

を差し込むだけ。`standalone/localApi.ts` がこれを読んで、埋め込み済みデータへ
id 単位でマージする(同じidなら後から入れた方で置き換える)。
**バンドル済みJSには触らない**ので壊れにくい。

書き出したHTMLをもう一度アップロードすれば、キャラを何体でも足せる。

### B. data/ にJSONを置く(本編に取り込む場合)

## 出力されるファイル

| 出力 | 置き場所 |
|---|---|
| キャラ本体 | `data/characters/<id>.json` として新規作成 |
| 通常攻撃 | `data/skills/normal.json` の配列に追記 |
| アクティブ | `data/skills/active.json` の配列に追記 |
| 必殺技 | `data/skills/ultimate.json` の配列に追記 |
| AIプロファイル | `data/ai/profiles.json` の配列に追記 |

置いたら:

```bash
node scripts/validate-data.mjs      # OK が出ることを確認
node tools/build-standalone.mjs     # 遊べるHTMLを作り直す
```

## 設計メモ

- **選択肢は実ソースから自動抽出する。** 属性・ロール・状態異常・効果種別・AI条件などは
  `shared/src/types.ts` から、`ART_PATTERNS` / `VISIBILITIES` は `scripts/validate-data.mjs` から
  ビルド時に取り出している。抽出に失敗したらビルドを失敗させる。
  ツールだけ古い選択肢を持ち続ける事故を防ぐため、**値を手で書き写さないこと**。
- **既存データも埋め込む。** 既存キャラ(バランス比較用)、既存スキルID・キャラID(重複検出用)、
  AIプロファイル、立ち絵ファイル名、既存のfx値を入れている。
- **`</script>` の並びを埋め込み時に潰している。** app.js のコメントに `</script>` と
  書いただけでHTMLパーサがスクリプトを閉じ、ツールが起動しなくなる事故を起こしたため、
  ビルド時に機械的に `<\/script` へ置換している。
- **検証規則は二重管理になっている。** `app.js` の `validate()` は `validate-data.mjs` の写し。
  本体側に規則を足したら、こちらにも足すこと。
  実際に、fx必須の規則が写し漏れていて「ツールはOKなのに検証が落ちる」状態を一度起こしている。
  規則を足したら、ツールの出力を実際に `data/` に入れて `validate-data.mjs` が通るところまで確認する。
