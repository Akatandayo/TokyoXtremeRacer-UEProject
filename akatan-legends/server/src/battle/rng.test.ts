/** 決定論的乱数の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from './rng.js';

test('rng: 同じシードなら完全に同じ列になる', () => {
  const a = createRng(20250917);
  const b = createRng(20250917);
  const seqA = Array.from({ length: 200 }, () => a.next());
  const seqB = Array.from({ length: 200 }, () => b.next());
  assert.deepEqual(seqA, seqB);
});

test('rng: シードが違えば列も違う', () => {
  const a = createRng(1);
  const b = createRng(2);
  const seqA = Array.from({ length: 50 }, () => a.next());
  const seqB = Array.from({ length: 50 }, () => b.next());
  assert.notDeepEqual(seqA, seqB);
});

test('rng: next() は [0,1) に収まる', () => {
  const r = createRng(7);
  for (let i = 0; i < 5000; i++) {
    const v = r.next();
    assert.ok(v >= 0 && v < 1, `範囲外: ${v}`);
  }
});

test('rng: int() は両端を含む範囲に収まり、両端とも出うる', () => {
  const r = createRng(99);
  let sawMin = false;
  let sawMax = false;
  for (let i = 0; i < 3000; i++) {
    const v = r.int(3, 7);
    assert.ok(Number.isInteger(v) && v >= 3 && v <= 7, `範囲外: ${v}`);
    if (v === 3) sawMin = true;
    if (v === 7) sawMax = true;
  }
  assert.ok(sawMin && sawMax);
});

test('rng: chance(0)=常にfalse / chance(100)=常にtrue / 乱数は必ず消費される', () => {
  const r = createRng(5);
  const before = r.calls;
  assert.equal(r.chance(0), false);
  assert.equal(r.chance(100), true);
  // 早期returnでも乱数を消費しないと以降の列がズレるので、必ず2回消費していること
  assert.equal(r.calls - before, 2);
});

test('rng: chance(p) の出現率がおおむね p% になる', () => {
  const r = createRng(424242);
  let hit = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) if (r.chance(30)) hit++;
  const rate = (hit / n) * 100;
  assert.ok(Math.abs(rate - 30) < 2, `期待30%に対し ${rate.toFixed(2)}%`);
});

test('rng: pick は決定論的で、空配列は例外', () => {
  const arr = ['a', 'b', 'c', 'd'];
  const x = Array.from({ length: 30 }, () => createRng(3).pick(arr));
  assert.equal(new Set(x).size, 1); // 同じシードなら常に同じ要素
  assert.throws(() => createRng(1).pick([]));
});
