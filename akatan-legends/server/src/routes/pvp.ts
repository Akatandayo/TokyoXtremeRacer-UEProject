/**
 * POST /api/pvp/join         あいことばで部屋に入る(即マッチしたら結果も返る)
 * GET  /api/pvp/rooms/:id    部屋の状態をポーリングする(相手待ち中に使う)
 *
 * プレイヤー識別は `X-Akatan-Player` ヘッダ(currentPlayerId, _helpers.ts)。
 * 信頼境界の説明は services/pvp-service.ts 冒頭コメントと docs/API.md 参照。
 */
import { Router } from 'express';
import type { PvpJoinResponse, PvpStatusResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { joinPvp, getPvpRoomView } from '../services/pvp-service.js';
import { currentPlayerId, handler, requireBody, requireIdParam, sendOk } from './_helpers.js';

export const pvpRouter: Router = Router();

pvpRouter.post('/pvp/join', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const body = requireBody(req);
  const data = getGameData();
  const response: PvpJoinResponse = joinPvp(
    { playerId, passphrase: body.passphrase, party: body.party },
    data,
  );
  sendOk(res, response);
}));

pvpRouter.get('/pvp/rooms/:roomId', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const roomId = requireIdParam(req, 'roomId');
  const response: PvpStatusResponse = getPvpRoomView(playerId, roomId);
  sendOk(res, response);
}));
