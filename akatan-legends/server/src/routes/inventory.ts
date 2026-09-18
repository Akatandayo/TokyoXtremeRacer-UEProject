/**
 * GET /api/inventory  所持装備・素材・チケット一覧
 */
import { Router } from 'express';
import type { InventoryResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import { buildInventoryResponse } from '../services/equipment-service.js';
import { currentPlayerId, handler, sendOk } from './_helpers.js';

export const inventoryRouter: Router = Router();

inventoryRouter.get('/inventory', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body: InventoryResponse = buildInventoryResponse(playerId, data);
  sendOk(res, body);
}));
