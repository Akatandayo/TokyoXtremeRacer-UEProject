/**
 * PUT /api/party  パーティ編成の更新
 * 検証は services/party-service.ts (5枠 / 重複禁止 / 所持チェック / 空編成禁止)
 */
import { Router } from 'express';
import type { UpdatePartyResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { updateParty } from '../services/party-service.js';
import { currentPlayerId, handler, requireBody, sendOk } from './_helpers.js';

export const partyRouter: Router = Router();

partyRouter.put('/party', handler((req, res) => {
  const playerId = currentPlayerId(req);
  getOrCreatePlayer(playerId, getGameData());
  const body = requireBody(req);
  const party = updateParty(playerId, body.members);
  const response: UpdatePartyResponse = { party };
  sendOk(res, response);
}));
