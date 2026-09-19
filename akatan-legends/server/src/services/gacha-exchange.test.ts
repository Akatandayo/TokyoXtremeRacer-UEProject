/**
 * ガチャチケット交換(POST /api/gacha/exchange)のテスト。
 * ------------------------------------------------------------
 * サーバ権威(設計書§37)の中核なので、以下を実際にDBへ書き込みながら検証する:
 *  - 所持枚数が正しく増減すること(消費/付与ともにトランザクション内)
 *  - 所持枚数不足は NOT_ENOUGH_CURRENCY で拒否され、何も変更されないこと
 *  - 未知の exchangeId / 不正な times は BAD_REQUEST / NOT_FOUND になること
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { GachaTicketExchangeDef } from '@akatan/shared';
import { initDb, closeDb, getDb } from '../db/index.js';
import * as repo from '../db/repository.js';
import { exchangeGachaTickets } from './gacha-service.js';
import { AppError } from './app-error.js';
import type { GameData } from '../data/loader.js';

const PLAYER_ID = 'test_exchange_player';

const EXCHANGE: GachaTicketExchangeDef = {
  id: 'exchange_pickup_to_kachoufuugetsu',
  fromTicketId: 'ticket_summon_pickup',
  toTicketId: 'ticket_summon_kachoufuugetsu',
  fromCount: 3,
  toCount: 1,
};

/** exchangeGachaTickets が実際に参照するフィールドだけを持つ最小の GameData */
function makeData(): GameData {
  return {
    gachaExchanges: new Map([[EXCHANGE.id, EXCHANGE]]),
    ticketMaterialIds: new Set([EXCHANGE.fromTicketId, EXCHANGE.toTicketId]),
  } as unknown as GameData;
}

before(() => {
  initDb(':memory:');
});

after(() => {
  closeDb();
});

beforeEach(() => {
  // 各テスト前にプレイヤーとチケット所持数をリセットする
  getDb().exec('DELETE FROM players; DELETE FROM materials;');
  repo.createPlayer(PLAYER_ID, 'テスト提督', { gold: 0 });
});

test('所持枚数が足りていれば消費/付与が正しい枚数で行われる', () => {
  repo.addMaterial(PLAYER_ID, EXCHANGE.fromTicketId, 5);

  const res = exchangeGachaTickets(PLAYER_ID, makeData(), EXCHANGE.id, 1);

  assert.equal(res.consumed.count, 3, 'fromCount(3) × times(1) だけ消費するはず');
  assert.equal(res.gained.count, 1, 'toCount(1) × times(1) だけ付与するはず');
  assert.equal(repo.getMaterialCount(PLAYER_ID, EXCHANGE.fromTicketId), 2, '5枚所持 - 3枚消費 = 2枚のはず');
  assert.equal(repo.getMaterialCount(PLAYER_ID, EXCHANGE.toTicketId), 1, '0枚所持 + 1枚付与 = 1枚のはず');
});

test('times を指定すると必要枚数・獲得枚数がその倍数になる', () => {
  repo.addMaterial(PLAYER_ID, EXCHANGE.fromTicketId, 9);

  const res = exchangeGachaTickets(PLAYER_ID, makeData(), EXCHANGE.id, 3);

  assert.equal(res.consumed.count, 9);
  assert.equal(res.gained.count, 3);
  assert.equal(repo.getMaterialCount(PLAYER_ID, EXCHANGE.fromTicketId), 0);
  assert.equal(repo.getMaterialCount(PLAYER_ID, EXCHANGE.toTicketId), 3);
});

test('times 省略時は1回分として扱われる', () => {
  repo.addMaterial(PLAYER_ID, EXCHANGE.fromTicketId, 3);

  const res = exchangeGachaTickets(PLAYER_ID, makeData(), EXCHANGE.id, undefined);

  assert.equal(res.times, 1);
  assert.equal(res.consumed.count, 3);
});

test('所持枚数が不足していれば NOT_ENOUGH_CURRENCY を投げ、何も変更しない', () => {
  repo.addMaterial(PLAYER_ID, EXCHANGE.fromTicketId, 2); // 3枚必要だが2枚しかない

  assert.throws(
    () => exchangeGachaTickets(PLAYER_ID, makeData(), EXCHANGE.id, 1),
    (e: unknown) => e instanceof AppError && e.code === 'NOT_ENOUGH_CURRENCY',
  );
  // 何も消費されていないこと(失敗時は残高不変)
  assert.equal(repo.getMaterialCount(PLAYER_ID, EXCHANGE.fromTicketId), 2);
  assert.equal(repo.getMaterialCount(PLAYER_ID, EXCHANGE.toTicketId), 0);
});

test('未知の exchangeId は NOT_FOUND を投げる', () => {
  assert.throws(
    () => exchangeGachaTickets(PLAYER_ID, makeData(), 'exchange_does_not_exist', 1),
    (e: unknown) => e instanceof AppError && e.code === 'NOT_FOUND',
  );
});

test('times が0以下や小数だと BAD_REQUEST になる', () => {
  repo.addMaterial(PLAYER_ID, EXCHANGE.fromTicketId, 9);
  assert.throws(
    () => exchangeGachaTickets(PLAYER_ID, makeData(), EXCHANGE.id, 0),
    (e: unknown) => e instanceof AppError && e.code === 'BAD_REQUEST',
  );
  assert.throws(
    () => exchangeGachaTickets(PLAYER_ID, makeData(), EXCHANGE.id, 1.5),
    (e: unknown) => e instanceof AppError && e.code === 'BAD_REQUEST',
  );
});

test('exchangeId が文字列でなければ BAD_REQUEST になる', () => {
  assert.throws(
    () => exchangeGachaTickets(PLAYER_ID, makeData(), undefined, 1),
    (e: unknown) => e instanceof AppError && e.code === 'BAD_REQUEST',
  );
});
