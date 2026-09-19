/**
 * GET /api/master  マスターデータ一括取得(図鑑/UI表示用・読み取り専用)
 *
 * P1-1(第2ラウンド)で `combos` をレスポンス実データにだけ追加していたが、
 * その後 `shared/src/api.ts` の `MasterDataResponse` に `combos?` / `materials?` /
 * `plannedCharacters?` が正式追加されたため(第3ラウンド時点で確認)、
 * 第3ラウンドで正式な型フィールドとして返すよう整理した。
 * `materials` / `plannedCharacters` は図鑑・ドロップ演出でクライアントが参照できるよう追加(§3)。
 * 第4ラウンドで `rebirthNodes` / `rebirthConfig`(転生画面のツリー表示用)を追加。
 * 第5ラウンドで `raidBosses`(レイド一覧・図鑑表示用) / `audio`(BGM・効果音割り当て)を追加。
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
    combos: [...data.combos.values()],
    materials: [...data.materials.values()],
    plannedCharacters: [...data.plannedCharacters.values()],
    rebirthNodes: [...data.rebirthNodes.values()],
    rebirthConfig: data.rebirthConfig,
    raidBosses: [...data.raidBosses.values()],
    audio: data.audio,
  };
  sendOk(res, body);
}));
