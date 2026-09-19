/**
 * POST /api/equipment/equip      装着(付け替え込み)
 * POST /api/equipment/unequip    取り外し
 * POST /api/equipment/sell       売却(装着中は不可)
 * POST /api/equipment/favorite   お気に入りの一括on/off
 * POST /api/equipment/sell-bulk  レアリティ一式の一括売却(装着中・お気に入りは除外)
 * 検証・反映は services/equipment-service.ts に集約。
 */
import { Router } from 'express';
import type { BulkSellResponse, EquipResponse, FavoriteEquipmentResponse, SellEquipmentResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { getOrCreatePlayer } from '../services/player-service.js';
import {
  equipItem, favoriteEquipment, sellEquipment, sellEquipmentBulk, unequipItem,
} from '../services/equipment-service.js';
import { currentPlayerId, handler, requireBody, sendOk } from './_helpers.js';

export const equipmentRouter: Router = Router();

equipmentRouter.post('/equipment/equip', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body = requireBody(req);
  const response: EquipResponse = equipItem(playerId, data, body.equipmentUid, body.characterUid);
  sendOk(res, response);
}));

equipmentRouter.post('/equipment/unequip', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body = requireBody(req);
  const response = unequipItem(playerId, data, body.characterUid, body.slot);
  sendOk(res, response);
}));

equipmentRouter.post('/equipment/sell', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body = requireBody(req);
  const response: SellEquipmentResponse = sellEquipment(playerId, data, body.equipmentUids);
  sendOk(res, response);
}));

equipmentRouter.post('/equipment/favorite', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body = requireBody(req);
  const response: FavoriteEquipmentResponse = favoriteEquipment(playerId, data, body.equipmentUids, body.favorite);
  sendOk(res, response);
}));

equipmentRouter.post('/equipment/sell-bulk', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  getOrCreatePlayer(playerId, data);
  const body = requireBody(req);
  const response: BulkSellResponse = sellEquipmentBulk(playerId, data, body.maxRarity, body.belowItemLevel);
  sendOk(res, response);
}));
