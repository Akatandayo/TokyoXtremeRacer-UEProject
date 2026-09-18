#!/usr/bin/env node
/**
 * オフライン単体版を「1ファイルのHTML」にまとめるビルドスクリプト。
 *
 * Vite は JS と CSS を別ファイルで出すので、ビルド後にそれらを index.html へ
 * インライン展開して 1 ファイルにする。
 * キャラ絵は基本的に CharacterArt から SVG/CSS で生成しているが、立ち絵を持つ
 * キャラ(client/public/portraits/*.webp)だけは画像が必要なので、それらも
 * data URL にして window.__AKATAN_PORTRAITS__ へ注入する。
 * 結果として外部ファイルを一切参照しない 1 ファイルになる。
 *
 * 使い方: node tools/build-standalone.mjs
 * 出力:   dist-standalone/akatan-legends.html
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'dist-standalone');

console.log('[1/3] vite build (standalone)');
execFileSync('npx', ['vite', 'build', '--config', 'standalone/vite.config.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
});

console.log('[2/3] JS/CSS を HTML へインライン展開');
const htmlPath = path.join(OUT_DIR, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');

const assetDir = path.join(OUT_DIR, 'assets');
const assets = fs.existsSync(assetDir) ? fs.readdirSync(assetDir) : [];

// <script type="module" crossorigin src="./assets/xxx.js"></script> -> インライン
html = html.replace(
  /<script[^>]*src="\.?\/?assets\/([^"]+)"[^>]*><\/script>/g,
  (_m, file) => {
    const code = fs.readFileSync(path.join(assetDir, file), 'utf8');
    return `<script type="module">\n${code}\n</script>`;
  },
);

// <link rel="stylesheet" href="./assets/xxx.css"> -> インライン
html = html.replace(
  /<link[^>]*rel="stylesheet"[^>]*href="\.?\/?assets\/([^"]+)"[^>]*>/g,
  (_m, file) => {
    const css = fs.readFileSync(path.join(assetDir, file), 'utf8');
    return `<style>\n${css}\n</style>`;
  },
);

// モジュールプリロードは1ファイル化すると無意味なので除去
html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '');

if (/assets\//.test(html)) {
  console.error('警告: インライン化できなかった参照が残っています:');
  for (const m of html.match(/[^"']*assets\/[^"']+/g) ?? []) console.error('  ', m);
  process.exitCode = 1;
}

// 立ち絵の埋め込み。
// 単体版は file:// で開かれるため `portraits/<key>.webp` という相対参照は解決できない。
// そこで client/public/portraits/ の画像を data URL にして window.__AKATAN_PORTRAITS__ へ
// 注入する。クライアントはこのオブジェクトがあれば優先して使う(無ければ相対パス→
// プロシージャル描画へフォールバックする)。
const portraitDir = path.join(ROOT, 'client', 'public', 'portraits');
const portraits = {};
if (fs.existsSync(portraitDir)) {
  for (const file of fs.readdirSync(portraitDir)) {
    const ext = path.extname(file).toLowerCase();
    const mime = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' }[ext];
    if (!mime) continue;
    const key = path.basename(file, ext);
    const data = fs.readFileSync(path.join(portraitDir, file)).toString('base64');
    portraits[key] = `data:${mime};base64,${data}`;
  }
}
const portraitKeys = Object.keys(portraits);
if (portraitKeys.length > 0) {
  const kb = (JSON.stringify(portraits).length / 1024).toFixed(0);
  console.log(`  立ち絵 ${portraitKeys.length} 件を埋め込み (${kb} KB): ${portraitKeys.join(', ')}`);
  const inject = `<script>window.__AKATAN_PORTRAITS__=${JSON.stringify(portraits)};</script>`;
  if (html.includes('</head>')) html = html.replace('</head>', `${inject}\n</head>`);
  else html = inject + html;
} else {
  console.log('  立ち絵なし(プロシージャル描画のみ)');
}

// 単体版は「モックデータ」ではなく data/ の本物のマスターデータで動くため、
// クライアント側のデモモード用バナー文言を実態に合わせて差し替える。
// (App.tsx はフロント担当の所有ファイルなので、ビルド後の文字列置換で対応している。
//  将来 App.tsx が __AKATAN_STANDALONE__ を見るようになれば、この置換は不要になる)
const BANNER_FROM = 'DEMO MODE — クライアント内蔵のモックデータで動作中(サーバ未使用)';
const BANNER_TO = 'オフライン単体版 — サーバ不要。進行状況はこのブラウザに保存されます';
if (html.includes(BANNER_FROM)) {
  html = html.split(BANNER_FROM).join(BANNER_TO);
} else {
  console.warn('  注意: デモモードのバナー文言が見つかりませんでした(App.tsx の文言が変わった可能性)');
}

const finalPath = path.join(OUT_DIR, 'akatan-legends.html');
fs.writeFileSync(finalPath, html);

console.log('[3/3] 完了');
const kb = (fs.statSync(finalPath).size / 1024).toFixed(0);
console.log(`  ${path.relative(ROOT, finalPath)}  (${kb} KB)`);
console.log(`  未インラインの残存アセット: ${assets.length} 件 (参照が無ければ不要)`);
