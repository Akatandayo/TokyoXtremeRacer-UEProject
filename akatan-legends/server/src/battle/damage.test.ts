/** ダメージ/回復計算の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng.js';
import { affinityMultiplier, computeDamage, computeHeal, mitigation, MAX_MITIGATION } from './damage.js';

/** 乱数幅0・会心0の決定的な条件でダメージを測る */
function flatDamage(over: Partial<Parameters<typeof computeDamage>[0]> = {}): number {
  return computeDamage({
    attackStat: 1000, power: 1, defense: 0, defenseConstant: 300, affinity: 1,
    criticalRate: 0, criticalDamage: 150, variance: 0, rng: createRng(1), ...over,
  }).value;
}

test('damage: 防御が高いほどダメージが減る (軽減上限に達するまでは単調減少)', () => {
  // 軽減上限(MAX_MITIGATION)に達する手前までは厳密に減り続けること。
  // K=300 なので def>=2700 で上限に張り付く -> そこまでを検証範囲にする。
  let prev = Infinity;
  for (const def of [0, 100, 300, 600, 1200, 2000]) {
    const d = flatDamage({ defense: def });
    assert.ok(d < prev, `def=${def} でダメージが減っていない (${d} >= ${prev})`);
    prev = d;
  }
  // 上限到達後は頭打ち (増えることは無い)
  const capped = flatDamage({ defense: 5000 });
  assert.ok(flatDamage({ defense: 50000 }) <= capped && capped < prev);
});

test('damage: defense = defenseConstant のとき軽減はちょうど50%', () => {
  assert.equal(mitigation(300, 300), 0.5);
  assert.equal(flatDamage({ defense: 300 }), Math.round(1000 * 0.5));
});

test('damage: 軽減率には上限があり、防御をいくら盛っても無敵にはならない', () => {
  assert.equal(mitigation(10 ** 9, 300), MAX_MITIGATION);
  assert.ok(flatDamage({ defense: 10 ** 9 }) >= 1);
});

test('damage: 最低1ダメージを保証する', () => {
  const d = flatDamage({ attackStat: 1, power: 0.0001, defense: 10 ** 6 });
  assert.equal(d, 1);
});

test('damage: 会心は criticalDamage% ぶん大きくなる', () => {
  const normal = flatDamage({ criticalRate: 0 });
  const crit = flatDamage({ criticalRate: 100, criticalDamage: 180 });
  assert.equal(crit, Math.round(normal * 1.8));
  assert.ok(crit > normal);
});

test('damage: 会心フラグと属性倍率が結果に含まれる (ログで理由が追える)', () => {
  const r = computeDamage({
    attackStat: 500, power: 1.2, defense: 100, defenseConstant: 300, affinity: 1.5,
    criticalRate: 100, criticalDamage: 200, variance: 0, rng: createRng(9),
  });
  assert.equal(r.critical, true);
  assert.equal(r.affinity, 1.5);
  assert.ok(r.value > 0);
});

test('damage: 属性相性倍率が乗る', () => {
  const weak = flatDamage({ affinity: 0.5 });
  const even = flatDamage({ affinity: 1 });
  const strong = flatDamage({ affinity: 1.5 });
  assert.ok(weak < even && even < strong);
});

test('damage: 乱数幅は ±variance の範囲に収まる', () => {
  const rng = createRng(31337);
  const base = 1000 * (1 - 300 / 600); // = 500
  for (let i = 0; i < 2000; i++) {
    const v = computeDamage({
      attackStat: 1000, power: 1, defense: 300, defenseConstant: 300, affinity: 1,
      criticalRate: 0, criticalDamage: 150, variance: 0.1, rng,
    }).value;
    assert.ok(v >= Math.round(base * 0.9) && v <= Math.round(base * 1.1), `範囲外: ${v}`);
  }
});

test('damage: canCritical=false なら会心せず、乱数消費も1回だけ', () => {
  const rng = createRng(3);
  const before = rng.calls;
  const r = computeDamage({
    attackStat: 100, power: 1, defense: 0, defenseConstant: 300, affinity: 1,
    criticalRate: 100, criticalDamage: 300, variance: 0, rng, canCritical: false,
  });
  assert.equal(r.critical, false);
  assert.equal(rng.calls - before, 1);
});

test('heal: healing ステータスが回復量に反映される', () => {
  const mk = (healingStat: number): number => computeHeal({
    scalingStat: 400, power: 1, healingStat, variance: 0, rng: createRng(2),
  }).value;
  assert.equal(mk(100), 400);
  assert.equal(mk(150), 600);
  assert.ok(mk(50) < mk(100));
});

test('affinity: テーブルに無い組み合わせは等倍', () => {
  const table = { FIRE: { WIND: 1.5 } };
  assert.equal(affinityMultiplier(table, 'FIRE', 'WIND'), 1.5);
  assert.equal(affinityMultiplier(table, 'FIRE', 'LIGHT'), 1);
  assert.equal(affinityMultiplier(table, 'DARK', 'LIGHT'), 1);
});
