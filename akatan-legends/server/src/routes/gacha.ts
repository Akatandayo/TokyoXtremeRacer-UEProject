/**
 * GET  /api/gacha        バナー一覧 + 天井カウンタ + 所持チケット
 * POST /api/gacha/pull   ガチャを引く(サーバ権威。抽選は必ずサーバ側 / 設計書§37)
 */
import { Router } from 'express';
import type { GachaListResponse, GachaPullResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { getGachaList, pullGacha } from '../services/gacha-service.js';
import { currentPlayerId, handler, requireBody, sendOk } from './_helpers.js';

export const gachaRouter: Router = Router();

gachaRouter.get('/gacha', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body: GachaListResponse = getGachaList(playerId, data);
  sendOk(res, body);
}));

gachaRouter.post('/gacha/pull', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body = requireBody(req);
  const response: GachaPullResponse = pullGacha(playerId, data, body.bannerId, body.count);
  sendOk(res, response);
}));
