/**
 * /api 配下のルータ束ね
 */
import { Router } from 'express';
import { battleRouter } from './battle.js';
import { charactersRouter } from './characters.js';
import { dungeonsRouter } from './dungeons.js';
import { healthRouter } from './health.js';
import { masterRouter } from './master.js';
import { partyRouter } from './party.js';
import { playerRouter } from './player.js';
import { notFoundMiddleware } from './_helpers.js';

export function createApiRouter(): Router {
  const api: Router = Router();
  api.use(healthRouter);
  api.use(playerRouter);
  api.use(charactersRouter);
  api.use(masterRouter);
  api.use(dungeonsRouter);
  api.use(partyRouter);
  api.use(battleRouter);
  // /api 配下の未定義パスは 404 (ApiResponse 封筒で返す)
  api.use(notFoundMiddleware);
  return api;
}

export { errorMiddleware } from './_helpers.js';
