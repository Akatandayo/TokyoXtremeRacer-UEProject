/**
 * オフライン単体版(1ファイルHTML)のビルド設定。
 *
 * 通常構成は「ブラウザ → Vite → Express → SQLite」だが、テストプレイ用に
 * サーバ無しで動く版を作るため、以下の2点だけを差し替えて同じクライアントを再利用する。
 *   client/src/mock/index.ts  -> standalone/localApi.ts  (ブラウザ内で戦闘を実行する)
 *   client/src/api/mode.ts    -> standalone/mode.ts      (常にローカルAPIを使う)
 *
 * 戦闘計算と育成計算はサーバと同じモジュール(server/src/battle, server/src/services/progression)を
 * そのまま import するので、単体版と通常版で結果が食い違わない。
 */
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** client/src/mock と client/src/api/mode を単体版の実装へ差し替える */
const REMAP = new Map<string, string>([
  [path.join(ROOT, 'client/src/mock/index.ts'), path.join(HERE, 'localApi.ts')],
  [path.join(ROOT, 'client/src/api/mode.ts'), path.join(HERE, 'mode.ts')],
]);

/**
 * (1) 上記のリマップ
 * (2) `./engine.js` のような「.js 拡張子で .ts を指す」import の解決
 *     server/src/battle は Node(ESM)向けに .js 拡張子付きで書かれているため、
 *     バンドラ側で .ts へ読み替える必要がある。
 */
function akatanStandaloneResolver(): Plugin {
  return {
    name: 'akatan-standalone-resolver',
    enforce: 'pre',
    resolveId(source, importer) {
      if (!importer || !source.startsWith('.')) return null;
      const abs = path.resolve(path.dirname(importer), source);
      const candidates = [
        abs,
        `${abs}.ts`,
        `${abs}.tsx`,
        path.join(abs, 'index.ts'),
        path.join(abs, 'index.tsx'),
        abs.endsWith('.js') ? abs.replace(/\.js$/, '.ts') : '',
      ].filter(Boolean);

      for (const c of candidates) {
        const mapped = REMAP.get(c);
        if (mapped) return mapped;
      }
      if (abs.endsWith('.js')) {
        const ts = abs.replace(/\.js$/, '.ts');
        if (fs.existsSync(ts)) return ts;
      }
      return null;
    },
  };
}

export default defineConfig({
  root: path.join(ROOT, 'client'),
  base: './',
  plugins: [akatanStandaloneResolver(), react()],
  define: {
    __AKATAN_STANDALONE__: 'true',
  },
  build: {
    outDir: path.join(ROOT, 'dist-standalone'),
    emptyOutDir: true,
    // 1ファイルへまとめるため、分割を全て抑止する
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: { inlineDynamicImports: true, manualChunks: undefined },
    },
  },
});
