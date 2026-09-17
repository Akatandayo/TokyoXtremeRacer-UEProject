/**
 * GET /api/dungeons  チャプター一覧 + クリア済みステージID
 */
import { Router } from 'express';
import type { DungeonListResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import * as repo from '../db/repository.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { currentPlayerId, handler, sendOk } from './_helpers.js';

export const dungeonsRouter: Router = Router();

dungeonsRouter.get('/dungeons', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body: DungeonListResponse = {
    chapters: [...data.chapters.values()],
    clearedStages: repo.listClearedStages(playerId),
  };
  sendOk(res, body);
}));
