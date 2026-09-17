/**
 * GET /api/master  マスターデータ一括取得(図鑑/UI表示用・読み取り専用)
 */
import { Router } from 'express';
import type { MasterDataResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { handler, sendOk } from './_helpers.js';

export const masterRouter: Router = Router();

masterRouter.get('/master', handler((_req, res) => {
  const data = getGameData();
  const body: MasterDataResponse = {
    characters: [...data.characters.values()],
    enemies: [...data.enemies.values()],
    skills: [...data.skills.values()],
    aiProfiles: [...data.aiProfiles.values()],
    chapters: [...data.chapters.values()],
  };
  sendOk(res, body);
}));
