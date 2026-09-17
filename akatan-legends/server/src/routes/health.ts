/**
 * GET /api/health  死活監視 + マスタ件数
 *
 * 封筒は他と同じ ApiResponse だが、単純なヘルスチェックからも読めるよう
 * トップレベルにも status を持たせている。
 */
import { Router } from 'express';
import { getGameData, summarizeGameData } from '../data/loader.js';
import { SCHEMA_VERSION } from '../db/index.js';
import { isUsingFallbackEngine } from '../services/battle-engine.js';
import { handler } from './_helpers.js';

export const healthRouter: Router = Router();

healthRouter.get('/health', handler((_req, res) => {
  const data = getGameData();
  res.status(200).json({
    ok: true,
    status: 'ok',
    data: {
      ...summarizeGameData(data),
      schemaVersion: SCHEMA_VERSION,
      battleEngine: isUsingFallbackEngine() ? 'fallback' : 'ready',
      loadedAt: data.loadedAt,
    },
  });
}));
