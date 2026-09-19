/**
 * PvP(あいことば対戦)のテスト。
 * ------------------------------------------------------------
 * 検証したい性質:
 *  1. クライアント申告の編成スナップショットが正しく検証される(実在確認・レベル範囲・
 *     ステータス上限)。
 *  2. シードは「あいことば+両者の編成」から決定論的に導出される(Date.now/Math.random不使用)。
 *  3. 同じ入力(シード+編成)なら runPvpBattle は必ず同じログを返す(戦闘エンジンの契約通り)。
 *  4. 部屋のライフサイクル: host が先に入って待機 -> 別トークンが guest として入ると
 *     その場で1回だけ解決 -> 両者が同じログを取得できる。同一トークンの再入室は
 *     待機のまま編成だけ更新される(自分自身とは対戦しない)。
 *  5. 期限切れの部屋は自動的に掃除される。
 */
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { AiProfile, CharacterDef, PvpPartySnapshot, Stats } from '@akatan/shared';
import { initDb, closeDb, getDb } from '../db/index.js';
import * as repo from '../db/repository.js';
import { AppError } from './app-error.js';
import {
  validatePartySnapshot, derivePvpSeed, runPvpBattle, joinPvp, getPvpRoomView,
} from './pvp-service.js';
import {
  AFFINITY, CONFIG, skillMap, baseStats,
} from '../battle/testFixtures.js';
import type { GameData } from '../data/loader.js';

/* ---------- フィクスチャ ---------- */

const CHAR_A: CharacterDef = {
  id: 'chr_test_a', name: 'テスト・アリス', rarity: 'SR', element: 'FIRE', roles: ['ATTACKER'],
  baseStats: { ...baseStats }, growth: { hp: 40, attack: 8, defense: 4, speed: 1 },
  normalAttack: 'atk_normal', skills: ['poison_strike'], ultimate: 'big_ult',
  defaultAi: 'ai_local_basic', description: 'テスト用',
};

const CHAR_B: CharacterDef = {
  id: 'chr_test_b', name: 'テスト・ベティ', rarity: 'SR', element: 'WATER', roles: ['HEALER'],
  baseStats: { ...baseStats, attack: 150 }, growth: { hp: 45, attack: 5, defense: 5, speed: 1 },
  normalAttack: 'atk_normal', skills: ['heal_small'], ultimate: 'big_ult',
  defaultAi: 'ai_local_healer', description: 'テスト用',
};

// このファイル専用の AiProfile 集合。testFixtures.AI_PROFILES はモジュール単位の共有配列
// (他ファイルの並行テストからも参照されうる)ので、playerSelectable を検証するために
// ミューテートせず、ここで独立したフィクスチャを用意する。
const AI_LOCAL_BASIC: AiProfile = {
  id: 'ai_local_basic', name: '基本(テスト用)', playerSelectable: true,
  rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'NORMAL' }],
};
const AI_LOCAL_HEALER: AiProfile = {
  id: 'ai_local_healer', name: '治癒(テスト用)', playerSelectable: true,
  rules: [
    { priority: 1, condition: { type: 'ALLY_HP_BELOW', value: 50 }, skill: 'heal_small' },
    { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
  ],
};
/** ボス専用(playerSelectable: false)。P1-3 相当のガードを検証するため。 */
const AI_BOSS_ONLY: AiProfile = {
  id: 'ai_boss_only', name: 'ボス専用', playerSelectable: false,
  rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'NORMAL' }],
};

function makeData(): GameData {
  return {
    characters: new Map([[CHAR_A.id, CHAR_A], [CHAR_B.id, CHAR_B]]),
    skills: skillMap(),
    aiProfiles: new Map([AI_LOCAL_BASIC, AI_LOCAL_HEALER, AI_BOSS_ONLY].map((p) => [p.id, p])),
    affinity: AFFINITY,
    combos: new Map(),
    progression: { levelCap: 60, expCurve: { base: 30, exponent: 1.5 }, battle: { ...CONFIG } },
  } as unknown as GameData;
}

/** validatePartySnapshot を通した「正しく作った」ステータス(=検証を必ず通る値) */
function nakedStats(def: CharacterDef, level: number): Stats {
  const lv = level - 1;
  return {
    hp: def.baseStats.hp + (def.growth.hp ?? 0) * lv,
    attack: def.baseStats.attack + (def.growth.attack ?? 0) * lv,
    defense: def.baseStats.defense + (def.growth.defense ?? 0) * lv,
    speed: def.baseStats.speed + (def.growth.speed ?? 0) * lv,
    critical: def.baseStats.critical,
    criticalDamage: def.baseStats.criticalDamage,
    resistance: def.baseStats.resistance,
    healing: def.baseStats.healing,
  };
}

function validMember(def: CharacterDef, level = 10) {
  return { defId: def.id, level, aiProfile: def.defaultAi, stats: nakedStats(def, level) };
}

/* ---------- 1. validatePartySnapshot ---------- */

test('validatePartySnapshot: 正しい編成は通る', () => {
  const data = makeData();
  const snap = validatePartySnapshot({ members: [validMember(CHAR_A), validMember(CHAR_B)] }, data);
  assert.equal(snap.members.length, 2);
  assert.equal(snap.members[0].defId, CHAR_A.id);
});

test('validatePartySnapshot: 存在しない defId は PARTY_INVALID', () => {
  const data = makeData();
  assert.throws(
    () => validatePartySnapshot({ members: [{ ...validMember(CHAR_A), defId: 'chr_ghost' }] }, data),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_INVALID',
  );
});

test('validatePartySnapshot: 存在しない aiProfile は PARTY_INVALID', () => {
  const data = makeData();
  assert.throws(
    () => validatePartySnapshot(
      { members: [{ ...validMember(CHAR_A), aiProfile: 'ai_ghost' }] }, data,
    ),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_INVALID',
  );
});

test('validatePartySnapshot: 敵/ボス専用AI(playerSelectable=false)は拒否される', () => {
  const data = makeData();
  assert.throws(
    () => validatePartySnapshot(
      { members: [{ ...validMember(CHAR_A), aiProfile: AI_BOSS_ONLY.id }] }, data,
    ),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_INVALID',
  );
  // プレイヤー用に明示的に許可されたAIは通る
  const snap = validatePartySnapshot(
    { members: [{ ...validMember(CHAR_A), aiProfile: AI_LOCAL_BASIC.id }] }, data,
  );
  assert.equal(snap.members[0].aiProfile, AI_LOCAL_BASIC.id);
});

test('validatePartySnapshot: レベルが levelCap を超えると PARTY_INVALID', () => {
  const data = makeData();
  assert.throws(
    () => validatePartySnapshot({ members: [validMember(CHAR_A, 999)] }, data),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_INVALID',
  );
});

test('validatePartySnapshot: 空編成は PARTY_EMPTY', () => {
  const data = makeData();
  assert.throws(
    () => validatePartySnapshot({ members: [] }, data),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_EMPTY',
  );
});

test('validatePartySnapshot: 人数上限(5体)を超えると PARTY_INVALID', () => {
  const data = makeData();
  const members = Array.from({ length: 6 }, () => validMember(CHAR_A));
  assert.throws(
    () => validatePartySnapshot({ members }, data),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_INVALID',
  );
});

test('validatePartySnapshot: ステータスが上限を大きく超えると PARTY_INVALID', () => {
  const data = makeData();
  const m = validMember(CHAR_A, 10);
  // 素の値の何十倍にもなる明らかな水増し申告
  const cheated = { ...m, stats: { ...m.stats, attack: m.stats.attack * 1000 + 100000 } };
  assert.throws(
    () => validatePartySnapshot({ members: [cheated] }, data),
    (e: unknown) => e instanceof AppError && e.code === 'PARTY_INVALID',
  );
});

test('validatePartySnapshot: 装備・転生を織り込んだ妥当な範囲の上振れは通る', () => {
  const data = makeData();
  const m = validMember(CHAR_A, 10);
  // naked比で+80%程度・小さいフラット加算程度は「装備+転生込み」の現実的な範囲として許容されるべき
  const boosted = {
    ...m,
    stats: {
      ...m.stats,
      attack: Math.round(m.stats.attack * 1.8) + 40,
      hp: Math.round(m.stats.hp * 1.5) + 100,
    },
  };
  const snap = validatePartySnapshot({ members: [boosted] }, data);
  assert.equal(snap.members[0].stats.attack, boosted.stats.attack);
});

/* ---------- 2. シード導出の決定論 ---------- */

test('derivePvpSeed: 同じ入力なら常に同じシード', () => {
  const partyA: PvpPartySnapshot = { members: [validMember(CHAR_A)] };
  const partyB: PvpPartySnapshot = { members: [validMember(CHAR_B)] };
  const s1 = derivePvpSeed('ひみつのあいことば', partyA, partyB);
  const s2 = derivePvpSeed('ひみつのあいことば', partyA, partyB);
  assert.equal(s1, s2);
  assert.ok(Number.isInteger(s1) && s1 >= 0 && s1 < 2_147_483_647);
});

test('derivePvpSeed: あいことばが違えばシードも変わる', () => {
  const partyA: PvpPartySnapshot = { members: [validMember(CHAR_A)] };
  const partyB: PvpPartySnapshot = { members: [validMember(CHAR_B)] };
  const s1 = derivePvpSeed('あいことばA', partyA, partyB);
  const s2 = derivePvpSeed('あいことばB', partyA, partyB);
  assert.notEqual(s1, s2);
});

test('derivePvpSeed: 編成が違えばシードも変わる(ホスト/ゲストの入れ替えも区別する)', () => {
  const partyA: PvpPartySnapshot = { members: [validMember(CHAR_A)] };
  const partyB: PvpPartySnapshot = { members: [validMember(CHAR_B)] };
  const s1 = derivePvpSeed('あいことば', partyA, partyB);
  const s2 = derivePvpSeed('あいことば', partyB, partyA);
  assert.notEqual(s1, s2);
});

/* ---------- 3. runPvpBattle の決定論(同じ入力 => 同じログ) ---------- */

test('runPvpBattle: 同じ seed/編成なら events・result が完全に一致する', () => {
  const data = makeData();
  const host: PvpPartySnapshot = { members: [validMember(CHAR_A), validMember(CHAR_B)] };
  const guest: PvpPartySnapshot = { members: [validMember(CHAR_A, 12)] };
  const seed = derivePvpSeed('決定論チェック', host, guest);

  const log1 = runPvpBattle(host, guest, data, seed);
  const log2 = runPvpBattle(host, guest, data, seed);

  assert.equal(log1.seed, log2.seed);
  assert.deepEqual(log1.events, log2.events, 'イベント列が完全一致しない(決定論が壊れている)');
  assert.deepEqual(log1.result, log2.result, 'result が完全一致しない');
  assert.deepEqual(log1.units, log2.units, 'units(初期状態)が完全一致しない');
  // id/createdAt はAPI層(呼び出しのたびの時刻・UUID)で変わってよい値なので比較対象に含めない。
});

/* ---------- 4. 部屋のライフサイクル(DB込み) ---------- */

const HOST_ID = 'pvp_test_host';
const GUEST_ID = 'pvp_test_guest';
const OTHER_ID = 'pvp_test_bystander';

before(() => {
  initDb(':memory:');
});
after(() => {
  closeDb();
});
beforeEach(() => {
  getDb().exec('DELETE FROM pvp_rooms;');
});

test('join: 最初の入室は WAITING で部屋を作る(ログはまだ無い)', () => {
  const data = makeData();
  const res = joinPvp({ playerId: HOST_ID, passphrase: 'ふたりの合言葉', party: { members: [validMember(CHAR_A)] } }, data);
  assert.equal(res.status, 'WAITING');
  assert.equal(res.opponentJoined, false);
  assert.equal(res.log, undefined);
  assert.ok(res.roomId.startsWith('pvp_'));
});

test('join: 同一トークンの再入室は待機のまま・編成だけ更新される(自分自身とは対戦しない)', () => {
  const data = makeData();
  const first = joinPvp({ playerId: HOST_ID, passphrase: '自己対戦テスト', party: { members: [validMember(CHAR_A, 10)] } }, data);
  const second = joinPvp({ playerId: HOST_ID, passphrase: '自己対戦テスト', party: { members: [validMember(CHAR_B, 20)] } }, data);

  assert.equal(second.status, 'WAITING');
  assert.equal(second.roomId, first.roomId, '同一トークンの再入室は同じ部屋のままのはず');

  const row = repo.findPvpRoomById(first.roomId);
  assert.equal(row?.hostParty.members[0].defId, CHAR_B.id, '編成が更新されているはず');
  assert.equal(row?.status, 'WAITING');
});

test('join: 別トークンが入ると即座に READY になり、両者が同じログを見る', () => {
  const data = makeData();
  const hostRes = joinPvp(
    { playerId: HOST_ID, passphrase: '対戦しよう', party: { members: [validMember(CHAR_A, 15)] } }, data,
  );
  assert.equal(hostRes.status, 'WAITING');

  const guestRes = joinPvp(
    { playerId: GUEST_ID, passphrase: '対戦しよう', party: { members: [validMember(CHAR_B, 18)] } }, data,
  );
  assert.equal(guestRes.status, 'READY');
  assert.equal(guestRes.side, 'ENEMY', 'guest(後から入った側)は ENEMY 側になる');
  assert.ok(guestRes.log);

  const hostView = getPvpRoomView(HOST_ID, guestRes.roomId);
  assert.equal(hostView.status, 'READY');
  assert.equal(hostView.side, 'ALLY', 'host(先に入った側)は ALLY 側になる');
  assert.ok(hostView.log);

  // 両者が受け取るログは完全に同じでなければならない(同じ戦闘の記録を見ている)
  assert.equal(hostView.log?.id, guestRes.log?.id);
  assert.deepEqual(hostView.log?.events, guestRes.log?.events);
  assert.deepEqual(hostView.log?.result, guestRes.log?.result);
});

test('join: 3人目が同じあいことばで来ても、決着済みの部屋には割り込まず新しい部屋を作る', () => {
  const data = makeData();
  const hostRes = joinPvp({ playerId: HOST_ID, passphrase: '何度でも使えるあいことば', party: { members: [validMember(CHAR_A)] } }, data);
  joinPvp({ playerId: GUEST_ID, passphrase: '何度でも使えるあいことば', party: { members: [validMember(CHAR_B)] } }, data);

  const thirdRes = joinPvp({ playerId: OTHER_ID, passphrase: '何度でも使えるあいことば', party: { members: [validMember(CHAR_A)] } }, data);
  assert.equal(thirdRes.status, 'WAITING');
  assert.notEqual(thirdRes.roomId, hostRes.roomId, '決着済みの部屋を使い回さず、新しい部屋になるはず');
});

test('status: 部屋の当事者以外が覗くと NOT_FOUND', () => {
  const data = makeData();
  const hostRes = joinPvp({ playerId: HOST_ID, passphrase: '覗き見テスト', party: { members: [validMember(CHAR_A)] } }, data);
  assert.throws(
    () => getPvpRoomView(OTHER_ID, hostRes.roomId),
    (e: unknown) => e instanceof AppError && e.code === 'NOT_FOUND',
  );
});

test('status: 存在しない roomId は NOT_FOUND', () => {
  assert.throws(
    () => getPvpRoomView(HOST_ID, 'pvp_does_not_exist'),
    (e: unknown) => e instanceof AppError && e.code === 'NOT_FOUND',
  );
});

test('期限切れの WAITING 部屋には入れず、新しい部屋が作られる', () => {
  const data = makeData();
  const past = new Date(Date.now() - 60_000).toISOString();
  repo.insertPvpRoom({
    id: 'pvp_expired_room', passphrase: '期限切れテスト', hostPlayerId: HOST_ID,
    hostParty: { members: [validMember(CHAR_A)] }, createdAt: past, expiresAt: past,
  });

  const res = joinPvp({ playerId: GUEST_ID, passphrase: '期限切れテスト', party: { members: [validMember(CHAR_B)] } }, data);
  assert.equal(res.status, 'WAITING', '期限切れの部屋とはマッチせず、新規の部屋を待機するはず');
  assert.notEqual(res.roomId, 'pvp_expired_room');
  assert.equal(repo.findPvpRoomById('pvp_expired_room'), null, '期限切れの部屋は掃除されているはず');
});
