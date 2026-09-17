/**
 * GET /api/characters            所持キャラ一覧 (計算済みステータス付き)
 * PUT /api/characters/:uid/ai    AIプロファイル変更 -> 更新後の CharacterView
 */
import { Router } from 'express';
import type { CharacterListResponse, CharacterView } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import * as repo from '../db/repository.js';
import { badRequest, notFound } from '../services/app-error.js';
import { buildCharacterView, getOrCreatePlayer, listCharacterViews } from '../services/player-service.js';
import { currentPlayerId, handler, requireBody, requireIdParam, requireString, sendOk } from './_helpers.js';

export const charactersRouter: Router = Router();

charactersRouter.get('/characters', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const data = getGameData();
  // 未作成なら作ってから返す(クライアントが /api/player より先に叩いても動くように)
  getOrCreatePlayer(playerId, data);
  const body: CharacterListResponse = { characters: listCharacterViews(playerId, data) };
  sendOk(res, body);
}));

charactersRouter.put('/characters/:uid/ai', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const uid = requireIdParam(req, 'uid');
  const body = requireBody(req);
  const aiProfile = requireString(body.aiProfile, 'aiProfile', { maxLength: 128 });

  const data = getGameData();
  // 所持チェック: 他人/架空の uid を拒否する
  const owned = repo.findOwnedCharacter(playerId, uid);
  if (!owned) throw notFound(`所持していないキャラクターです: ${uid}`);

  // マスタが読めている時のみ AI プロファイルの実在チェックを行う
  // (データ担当が data/ai を作成中でも API を止めないため)
  if (data.aiProfiles.size > 0 && !data.aiProfiles.has(aiProfile)) {
    throw badRequest(`存在しないAIプロファイルです: ${aiProfile}`);
  }

  repo.updateCharacterAi(playerId, uid, aiProfile);

  const updated = repo.findOwnedCharacter(playerId, uid);
  if (!updated) throw notFound(`キャラクターが見つかりません: ${uid}`);
  const def = data.characters.get(updated.defId);
  if (!def) throw notFound(`キャラクター定義が見つかりません: ${updated.defId}`);

  const view: CharacterView = buildCharacterView(updated, def, data);
  sendOk(res, view);
}));
