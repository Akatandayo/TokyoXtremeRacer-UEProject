/**
 * GET /api/dungeons  チャプター一覧 + クリア済みステージID
 *
 * P0-1: 開放判定用のサーバ計算済みフラグは持たせていない。
 * `DungeonListResponse` (shared) は変更禁止だが、既に `chapters[].stages[].unlockAfter`
 * (StageDef) と `clearedStages` の両方をここで返しているため、
 * クライアント側で `unlockAfter` が `clearedStages` に含まれるかを見れば
 * 開放判定を再現できる(追加の型は不要)。
 * 実際の挑戦拒否はサーバ権威で `POST /api/battle/start` (battle-service.ts
 * assertStageUnlocked) が必ず行うため、ここでの表示はUI用のヒントに過ぎない。
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
