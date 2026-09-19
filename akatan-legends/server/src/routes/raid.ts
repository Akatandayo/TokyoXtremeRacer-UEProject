/**
 * GET  /api/raid          レイドボス一覧 + 進行状況
 * POST /api/raid/attack   レイド挑戦(設計書§28〜§29)
 *
 * サーバ権威: 受け取るのは bossId と編成 uid のみ。戦闘そのものは battle-service と
 * 同じ組み立てで runBattle にそのまま流す(raid-service.ts 冒頭コメント参照)。
 */
import { Router } from 'express';
import type { RaidAttackResponse, RaidListResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { attackRaidBoss, getRaidListResponse } from '../services/raid-service.js';
import { currentPlayerId, handler, requireBody, sendOk } from './_helpers.js';

export const raidRouter: Router = Router();

raidRouter.get('/raid', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);

  const response: RaidListResponse = getRaidListResponse(playerId, data);
  sendOk(res, response);
}));

raidRouter.post('/raid/attack', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);

  const body = requireBody(req);
  const response: RaidAttackResponse = attackRaidBoss(
    { playerId, bossId: body.bossId, members: body.members },
    data,
  );
  sendOk(res, response);
}));
