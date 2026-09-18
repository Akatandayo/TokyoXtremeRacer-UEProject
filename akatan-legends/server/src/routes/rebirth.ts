/**
 * 転生 (設計書§17〜§20)
 * GET  /api/characters/:uid/rebirth          現在の転生状況
 * POST /api/characters/:uid/rebirth          転生を実行する
 * POST /api/characters/:uid/rebirth/allocate 転生ポイントを振る
 * POST /api/characters/:uid/rebirth/reset    振り直す
 *
 * クライアントから受け取るのは「どのキャラか(uid)」「どのノードに何ランクか」だけ。
 * 実行可否・ポイント計算・ステータス反映はすべてサーバ側で確定させる(services/rebirth-service.ts)。
 */
import { Router } from 'express';
import type {
  RebirthResponse, RebirthStatusResponse, ResetRebirthResponse,
} from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { badRequest } from '../services/app-error.js';
import {
  allocateRebirthPoints, executeRebirth, getRebirthStatus, resetRebirthPoints,
} from '../services/rebirth-service.js';
import { currentPlayerId, handler, requireBody, requireIdParam, sendOk } from './_helpers.js';

export const rebirthRouter: Router = Router();

rebirthRouter.get('/characters/:uid/rebirth', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const uid = requireIdParam(req, 'uid');
  const data = getGameData();
  const body: RebirthStatusResponse = getRebirthStatus(playerId, uid, data);
  sendOk(res, body);
}));

rebirthRouter.post('/characters/:uid/rebirth', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const uid = requireIdParam(req, 'uid');
  const data = getGameData();
  const body: RebirthResponse = executeRebirth(playerId, uid, data);
  sendOk(res, body);
}));

rebirthRouter.post('/characters/:uid/rebirth/allocate', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const uid = requireIdParam(req, 'uid');
  const reqBody = requireBody(req);

  const nodeIdRaw = reqBody.nodeId;
  if (typeof nodeIdRaw !== 'string' || nodeIdRaw.length === 0) {
    throw badRequest('nodeId は必須の文字列です');
  }
  const ranksRaw = reqBody.ranks;
  let ranks = 1;
  if (ranksRaw !== undefined) {
    if (typeof ranksRaw !== 'number' || !Number.isFinite(ranksRaw) || !Number.isInteger(ranksRaw) || ranksRaw < 1) {
      throw badRequest('ranks は1以上の整数である必要があります');
    }
    ranks = ranksRaw;
  }

  const data = getGameData();
  const body: RebirthStatusResponse = allocateRebirthPoints(playerId, uid, nodeIdRaw, ranks, data);
  sendOk(res, body);
}));

rebirthRouter.post('/characters/:uid/rebirth/reset', handler((req, res) => {
  const playerId = currentPlayerId(req);
  const uid = requireIdParam(req, 'uid');
  const data = getGameData();
  const body: ResetRebirthResponse = resetRebirthPoints(playerId, uid, data);
  sendOk(res, body);
}));
