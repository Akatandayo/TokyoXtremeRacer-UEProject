/**
 * あかたんLegends API サーバ
 * ------------------------------------------------------------
 * 起動順:
 *   1. マスターデータのロード (data/ が空でも起動する)
 *   2. DB 初期化 + マイグレーション (server/data.db)
 *   3. 戦闘エンジンのロード (未実装なら暫定フォールバック)
 *   4. Express 起動 (既定 8787、PORT で上書き可)
 */
import express from 'express';
import cors from 'cors';
import { initGameData, summarizeGameData } from './data/loader.js';
import { closeDb, initDb } from './db/index.js';
import { loadBattleEngine, isUsingFallbackEngine } from './services/battle-engine.js';
import { createApiRouter, errorMiddleware } from './routes/index.js';

const DEFAULT_PORT = 8787;

export function createApp(): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', createApiRouter());
  // エラーハンドリングは最後に置く(例外 -> ApiResponse 封筒 + 500/INTERNAL)
  app.use(errorMiddleware);
  return app;
}

async function main(): Promise<void> {
  // 1. マスターデータ
  const data = initGameData();
  const summary = summarizeGameData(data);
  console.log('[boot] マスターデータをロードしました:', summary);
  console.log(
    `[boot] キャラ ${data.characters.size} 体 / 敵 ${data.enemies.size} 体 / スキル ${data.skills.size} 件 / ` +
    `AI ${data.aiProfiles.size} 件 / チャプター ${data.chapters.size} 件 / ステージ ${data.stages.size} 件 / ` +
    `コンボ ${data.combos.size} 件`,
  );
  if (data.warnings.length > 0) {
    console.warn(`[boot] データ警告 ${data.warnings.length} 件:`);
    for (const w of data.warnings.slice(0, 30)) console.warn(`  - ${w}`);
    if (data.warnings.length > 30) console.warn(`  ... 他 ${data.warnings.length - 30} 件`);
  }

  // 2. DB
  const db = initDb();
  console.log(`[boot] DB: ${db.path} (schema v${db.migratedFrom} -> v${db.migratedTo})`);

  // 3. 戦闘エンジン
  await loadBattleEngine();
  console.log(`[boot] 戦闘エンジン: ${isUsingFallbackEngine() ? '暫定フォールバック(battle/index.ts 未実装)' : 'runBattle をロード済み'}`);

  // 4. HTTP
  const port = Number(process.env.PORT ?? DEFAULT_PORT) || DEFAULT_PORT;
  const app = createApp();
  const server = app.listen(port, () => {
    console.log(`[boot] あかたんLegends API listening on http://localhost:${port}`);
  });

  // 終了時に SQLite を明示的に閉じる(WAL をチェックポイントして -wal/-shm を残さない)
  const shutdown = (signal: string): void => {
    console.log(`[boot] ${signal} を受信。シャットダウンします。`);
    server.close(() => {
      closeDb();
      process.exit(0);
    });
    // close が返らない場合の保険
    setTimeout(() => { closeDb(); process.exit(0); }, 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[boot] 起動に失敗しました:', err);
  process.exit(1);
});
