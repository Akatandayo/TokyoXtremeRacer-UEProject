/** 状態異常/バフの検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleUnit } from '@akatan/shared';
import { createRng } from './rng.js';
import {
  absorbWithShield, advanceStatuses, applyStatus, cleanseDebuffs, computeStatusTick,
  effectiveStat, isIncapacitated, isInvulnerable, isSilenced, isStatusImmune, statMultiplier,
  tauntingUnits,
} from './status.js';
import { baseStats } from './testFixtures.js';

function mk(over: Partial<BattleUnit> = {}): BattleUnit {
  return {
    id: 'u1', side: 'ALLY', slot: 0, name: 'テスト', defId: 'd1', element: 'VOID',
    roles: ['ATTACKER'], level: 1, stats: { ...baseStats, ...(over.stats ?? {}) },
    hp: 1000, maxHp: 1000, gauge: 0, ultGauge: 0, statuses: [], alive: true, awakened: false,
    ...over,
  };
}

test('status: 付与できる / 同種の重ねがけは potency は高い方・duration は長い方', () => {
  const u = mk();
  const rng = createRng(1);
  applyStatus(u, { type: 'ATK_UP', duration: 2, potency: 30 }, rng);
  // 弱いが長い -> duration だけ伸びる
  applyStatus(u, { type: 'ATK_UP', duration: 5, potency: 10 }, rng);
  assert.equal(u.statuses.length, 1);
  assert.equal(u.statuses[0]!.potency, 30);
  assert.equal(u.statuses[0]!.duration, 5);
  // 強いが短い -> potency だけ上がる
  applyStatus(u, { type: 'ATK_UP', duration: 1, potency: 80 }, rng);
  assert.equal(u.statuses.length, 1);
  assert.equal(u.statuses[0]!.potency, 80);
  assert.equal(u.statuses[0]!.duration, 5);
});

test('status: POISON の継続ダメージが発生する (最大HPの potency%)', () => {
  const u = mk({ maxHp: 2000, hp: 2000 });
  applyStatus(u, { type: 'POISON', duration: 3, potency: 5 }, createRng(1));
  const tick = computeStatusTick(u);
  assert.equal(tick.damage.length, 1);
  assert.equal(tick.damage[0]!.type, 'POISON');
  assert.equal(tick.damage[0]!.value, 100); // 2000 * 5%
});

test('status: REGEN は毎行動回復する', () => {
  const u = mk({ maxHp: 1000 });
  applyStatus(u, { type: 'REGEN', duration: 3, potency: 8 }, createRng(1));
  const tick = computeStatusTick(u);
  assert.equal(tick.heal[0]!.value, 80);
  assert.equal(tick.damage.length, 0);
});

test('status: duration が0になると解除される', () => {
  const u = mk();
  applyStatus(u, { type: 'BURN', duration: 2, potency: 3 }, createRng(1));
  assert.equal(advanceStatuses(u).length, 0);
  assert.equal(u.statuses.length, 1);
  const expired = advanceStatuses(u);
  assert.equal(expired.length, 1);
  assert.equal(expired[0]!.type, 'BURN');
  assert.equal(u.statuses.length, 0);
});

test('status: FREEZE / STUN は行動不能、SILENCE は行動不能ではない', () => {
  const frozen = mk();
  applyStatus(frozen, { type: 'FREEZE', duration: 1 }, createRng(1));
  assert.equal(isIncapacitated(frozen), true);

  const stunned = mk();
  applyStatus(stunned, { type: 'STUN', duration: 1 }, createRng(1));
  assert.equal(isIncapacitated(stunned), true);

  const silenced = mk();
  applyStatus(silenced, { type: 'SILENCE', duration: 1 }, createRng(1));
  assert.equal(isIncapacitated(silenced), false);
  assert.equal(isSilenced(silenced), true);
});

test('status: 耐性による抵抗が発生しうる (デバフのみ・バフは必ず入る)', () => {
  const rng = createRng(777);
  let applied = 0;
  let resisted = 0;
  for (let i = 0; i < 400; i++) {
    const u = mk({ stats: { ...baseStats, resistance: 50 } });
    const r = applyStatus(u, { type: 'POISON', duration: 2, potency: 5 }, rng);
    if (r.kind === 'APPLIED') applied++;
    if (r.kind === 'RESISTED') resisted++;
  }
  assert.ok(resisted > 0, '一度も抵抗が発生していない');
  assert.ok(applied > 0, '一度も付与に成功していない');

  // バフは耐性100%でも必ず入る
  const tough = mk({ stats: { ...baseStats, resistance: 100 } });
  assert.equal(applyStatus(tough, { type: 'ATK_UP', duration: 2, potency: 20 }, rng).kind, 'APPLIED');
});

test('status: 耐性100%でもデバフは完全無効にならない (上限95%)', () => {
  const rng = createRng(2024);
  let applied = 0;
  for (let i = 0; i < 2000; i++) {
    const u = mk({ stats: { ...baseStats, resistance: 100 } });
    if (applyStatus(u, { type: 'SLOW', duration: 2, potency: 20 }, rng).kind === 'APPLIED') applied++;
  }
  assert.ok(applied > 0, '耐性100%でデバフが完全無効になっている');
});

test('status: ステータス補正 (ATK_UP/ATK_DOWN, DEF_UP/DEF_DOWN, SLOW/SPD_UP)', () => {
  const u = mk();
  const rng = createRng(1);
  applyStatus(u, { type: 'ATK_UP', duration: 3, potency: 50 }, rng);
  assert.equal(statMultiplier(u, 'attack'), 1.5);
  assert.equal(effectiveStat(u, 'attack'), baseStats.attack * 1.5);

  applyStatus(u, { type: 'ATK_DOWN', duration: 3, potency: 20 }, rng);
  assert.ok(Math.abs(statMultiplier(u, 'attack') - 1.3) < 1e-9);

  applyStatus(u, { type: 'SLOW', duration: 3, potency: 40 }, rng);
  assert.ok(Math.abs(effectiveStat(u, 'speed') - baseStats.speed * 0.6) < 1e-9);

  applyStatus(u, { type: 'DEF_UP', duration: 3, potency: 100 }, rng);
  assert.equal(effectiveStat(u, 'defense'), baseStats.defense * 2);
});

test('status: SHIELD が被ダメージを肩代わりし、割れると消える', () => {
  const u = mk({ maxHp: 1000, hp: 1000 });
  // potency は「最大HPの%」で渡し、内部では残り吸収量(絶対値)になる
  applyStatus(u, { type: 'SHIELD', duration: 3, potency: 20 }, createRng(1));
  assert.equal(u.statuses[0]!.potency, 200);

  const a = absorbWithShield(u, 120);
  assert.equal(a.absorbed, 120);
  assert.equal(a.through, 0);
  assert.equal(u.statuses[0]!.potency, 80);

  const b = absorbWithShield(u, 300);
  assert.equal(b.absorbed, 80);
  assert.equal(b.through, 220);
  assert.equal(b.broken, true);
  assert.equal(advanceStatuses(u).length, 1); // 割れた盾は期限切れ扱い
  assert.equal(u.statuses.length, 0);
});

test('status: TAUNT を持つユニットだけを抽出できる', () => {
  const a = mk({ id: 'a' });
  const b = mk({ id: 'b' });
  const dead = mk({ id: 'c', alive: false });
  applyStatus(b, { type: 'TAUNT', duration: 2 }, createRng(1));
  applyStatus(dead, { type: 'TAUNT', duration: 2 }, createRng(1));
  const t = tauntingUnits([a, b, dead]);
  assert.deepEqual(t.map((u) => u.id), ['b']);
});

test('status: INVULNERABLE / IMMUNE は isInvulnerable / isStatusImmune で判定できる', () => {
  const u = mk();
  assert.equal(isInvulnerable(u), false);
  assert.equal(isStatusImmune(u), false);
  applyStatus(u, { type: 'INVULNERABLE', duration: 2 }, createRng(1));
  assert.equal(isInvulnerable(u), true);
  applyStatus(u, { type: 'IMMUNE', duration: 2 }, createRng(1));
  assert.equal(isStatusImmune(u), true);
});

test('status: IMMUNE を持つユニットへの新規付与はバフ・デバフ問わず全てブロックされる', () => {
  const u = mk();
  const rng = createRng(1);
  applyStatus(u, { type: 'IMMUNE', duration: 3 }, rng);
  assert.equal(u.statuses.length, 1);

  const debuff = applyStatus(u, { type: 'POISON', duration: 3, potency: 5 }, rng);
  assert.equal(debuff.kind, 'IMMUNE');
  const buff = applyStatus(u, { type: 'ATK_UP', duration: 3, potency: 20 }, rng);
  assert.equal(buff.kind, 'IMMUNE');
  // 何も新規に付与されていない (IMMUNE 自身だけが残る)
  assert.equal(u.statuses.length, 1);
  assert.equal(u.statuses[0]!.type, 'IMMUNE');
});

test('status: IMMUNE は乱数を一切消費せずブロックする (確率/耐性ロールより前に弾く)', () => {
  const u = mk();
  const rng = createRng(1);
  applyStatus(u, { type: 'IMMUNE', duration: 3 }, rng);
  const before = rng.calls;
  const outcome = applyStatus(u, { type: 'POISON', duration: 3, potency: 5, chance: 50 }, rng);
  assert.equal(outcome.kind, 'IMMUNE');
  assert.equal(rng.calls, before, 'IMMUNE のブロックで乱数が消費されている');
});

test('status: IMMUNE 中でも既にかかっている状態は解除されない', () => {
  const u = mk();
  const rng = createRng(1);
  // 先に POISON を付与してから IMMUNE を付与する
  applyStatus(u, { type: 'POISON', duration: 3, potency: 5 }, rng);
  applyStatus(u, { type: 'IMMUNE', duration: 5 }, rng);
  const poison = u.statuses.find((s) => s.type === 'POISON');
  assert.ok(poison, '既存の POISON が消えている');
  assert.equal(poison!.duration, 3);
  assert.equal(poison!.potency, 5);

  // IMMUNE が切れれば再び付与を受け付けるようになる
  advanceStatuses(u); advanceStatuses(u); advanceStatuses(u); advanceStatuses(u); advanceStatuses(u);
  assert.equal(isStatusImmune(u), false);
  const outcome = applyStatus(u, { type: 'BURN', duration: 2, potency: 3 }, rng);
  assert.equal(outcome.kind, 'APPLIED');
});

test('status: CLEANSE はデバフだけを消す', () => {
  const u = mk();
  const rng = createRng(1);
  applyStatus(u, { type: 'POISON', duration: 3, potency: 5 }, rng);
  applyStatus(u, { type: 'ATK_UP', duration: 3, potency: 10 }, rng);
  applyStatus(u, { type: 'SLOW', duration: 3, potency: 10 }, rng);
  const removed = cleanseDebuffs(u);
  assert.deepEqual(removed.map((s) => s.type).sort(), ['POISON', 'SLOW']);
  assert.deepEqual(u.statuses.map((s) => s.type), ['ATK_UP']);
});
