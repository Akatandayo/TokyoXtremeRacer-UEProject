/**
 * パーティ編成サービス
 * ------------------------------------------------------------
 * 検証ルール (すべてサーバ側で実施):
 *   1. members は配列であること。長さは PARTY_SIZE (=5) まで。足りない分は null 埋め。
 *   2. 各要素は string(キャラの uid) または null。
 *   3. 同じ uid を 2 枠以上に入れられない(重複禁止)。
 *   4. uid は **そのプレイヤーの所持キャラ** でなければならない(他人/架空の uid は拒否)。
 *   5. 空編成は拒否(PARTY_EMPTY)。
 */
import type { Party } from '@akatan/shared';
import { PARTY_SIZE } from '@akatan/shared';
import * as repo from '../db/repository.js';
import { badRequest, partyEmpty, partyInvalid } from './app-error.js';

/** 検証済みの members(長さ PARTY_SIZE)を返す。不正なら AppError を throw。 */
export function validateMembers(playerId: string, raw: unknown): (string | null)[] {
  if (!Array.isArray(raw)) {
    throw badRequest('members は配列である必要があります');
  }
  if (raw.length > PARTY_SIZE) {
    throw partyInvalid(`パーティは最大 ${PARTY_SIZE} 枠です (受信: ${raw.length})`);
  }

  const members: (string | null)[] = new Array<string | null>(PARTY_SIZE).fill(null);
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i += 1) {
    const v = raw[i];
    if (v === null || v === undefined || v === '') {
      members[i] = null;
      continue;
    }
    if (typeof v !== 'string') {
      throw badRequest(`members[${i}] は文字列(uid)か null である必要があります`);
    }
    if (seen.has(v)) {
      throw partyInvalid(`同じキャラクターを複数枠に編成できません: ${v}`);
    }
    // 所持チェック: クライアント申告の uid を信用せず DB で確認する
    if (!repo.findOwnedCharacter(playerId, v)) {
      throw partyInvalid(`所持していないキャラクターです: ${v}`);
    }
    seen.add(v);
    members[i] = v;
  }

  if (seen.size === 0) {
    throw partyEmpty();
  }
  return members;
}

/** パーティを保存する(存在しなければ作成) */
export function updateParty(playerId: string, raw: unknown, partyId = repo.DEFAULT_PARTY_ID): Party {
  const members = validateMembers(playerId, raw);
  const existing = repo.findParty(playerId, partyId);
  return repo.saveParty(playerId, {
    id: partyId,
    name: existing?.name ?? 'メインパーティ',
    members,
  });
}

/** 保存済みパーティを取得(無ければ空編成を作って返す) */
export function getParty(playerId: string, partyId = repo.DEFAULT_PARTY_ID): Party {
  const party = repo.findParty(playerId, partyId);
  if (party) return party;
  return repo.saveParty(playerId, {
    id: partyId,
    name: 'メインパーティ',
    members: new Array<string | null>(PARTY_SIZE).fill(null),
  });
}
