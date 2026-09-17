/**
 * POST /api/battle/start  戦闘実行
 *
 * サーバ権威: 受け取るのは stageId と編成 uid のみ。
 * ステータス/レベル/敵/シード/報酬はすべてサーバが DB とマスタから再構築する。
 */
import { Router } from 'express';
import type { BattleStartResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { startBattle } from '../services/battle-service.js';
import { currentPlayerId, handler, requireBody, sendOk } from './_helpers.js';

export const battleRouter: Router = Router();

battleRouter.post('/battle/start', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);

  const body = requireBody(req);
  const response: BattleStartResponse = startBattle(
    { playerId, stageId: body.stageId, members: body.members },
    data,
  );
  sendOk(res, response);
}));
