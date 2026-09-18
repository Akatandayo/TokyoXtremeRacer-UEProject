/**
 * GET /api/player
 * 初回アクセス時にプレイヤーを自動作成し、スターターキャラを付与する。
 */
import { Router } from 'express';
import type { PlayerStateResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { buildInventoryResponse } from '../services/equipment-service.js';
import { currentPlayerId, handler, sendOk } from './_helpers.js';

export const playerRouter: Router = Router();

playerRouter.get('/player', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  const state = getOrCreatePlayer(playerId, data);
  const body: PlayerStateResponse = {
    player: state.player,
    characters: state.characters,
    party: state.party,
    // Phase3: 所持装備・素材・チケット(§37: サーバが計算・保持した値のみ)
    inventory: buildInventoryResponse(playerId, data),
  };
  sendOk(res, body);
}));
