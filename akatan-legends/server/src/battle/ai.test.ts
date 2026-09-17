/** AI (スキル選択・ターゲット選択) の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProfile } from '@akatan/shared';
import { createRng } from './rng.js';
import { decideAction, isSkillUsable, selectTargets, type AiUnit } from './ai.js';
import { applyStatus } from './status.js';
import { aiMap, baseStats, skillMap } from './testFixtures.js';

const SKILLS = skillMap();
const PROFILES = aiMap();

function mk(over: Partial<AiUnit> & { id: string }): AiUnit {
  return {
    side: 'ALLY', slot: 0, name: over.id, defId: over.id, element: 'VOID',
    roles: ['ATTACKER'], level: 1, stats: { ...baseStats, ...(over.stats ?? {}) },
    hp: 1000, maxHp: 1000, gauge: 0, ultGauge: 0, statuses: [], alive: true, awakened: false,
    normalAttackId: 'atk_normal', skillIds: [], aiProfileId: 'ai_basic',
    cooldowns: new Map(),
    ...over,
  };
}

function decide(actor: AiUnit, allies: AiUnit[], foes: AiUnit[], turn = 1, seed = 1) {
  return decideAction({
    actor, allies, foes, skills: SKILLS,
    profile: PROFILES.get(actor.aiProfileId), turn, ultMax: 100, rng: createRng(seed),
  });
}

/* ---------- 条件 ---------- */

test('ai: ALLY_HP_BELOW のルールがHP条件で正しく発火する', () => {
  const healer = mk({ id: 'healer', aiProfileId: 'ai_healer', skillIds: ['heal_small'] });
  const hurt = mk({ id: 'hurt', slot: 1, hp: 400 });   // 40%
  const fine = mk({ id: 'fine', slot: 1, hp: 1000 });  // 100%
  const foe = mk({ id: 'foe', side: 'ENEMY' });

  // 味方が瀕死 -> 回復を選ぶ
  const a = decide(healer, [healer, hurt], [foe]);
  assert.equal(a.skill.id, 'heal_small');
  assert.equal(a.rule?.priority, 1);
  assert.deepEqual(a.targets.map((t) => t.id), ['hurt']); // LOWEST_HP

  // 全員健在 -> 通常攻撃にフォールスルー
  const b = decide(healer, [healer, fine], [foe]);
  assert.equal(b.skill.id, 'atk_normal');
  assert.equal(b.rule?.priority, 2);
});

test('ai: SELF_HP_BELOW / ENEMY_HP_BELOW / ENEMY_COUNT_ATLEAST / TURN_ATLEAST / ULT_READY', () => {
  const profile: AiProfile = {
    id: 'p', name: 'p',
    rules: [
      { priority: 1, condition: { type: 'ULT_READY' }, skill: 'big_ult' },
      { priority: 2, condition: { type: 'SELF_HP_BELOW', value: 30 }, skill: 'guard_up' },
      { priority: 3, condition: { type: 'ENEMY_HP_BELOW', value: 20 }, skill: 'poison_strike' },
      { priority: 4, condition: { type: 'ENEMY_COUNT_ATLEAST', value: 2 }, skill: 'stun_bolt' },
      { priority: 5, condition: { type: 'TURN_ATLEAST', value: 3 }, skill: 'silence_song' },
      { priority: 6, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  };
  const skills = ['big_ult', 'guard_up', 'poison_strike', 'stun_bolt', 'silence_song'];
  const base = () => mk({
    id: 'a', aiProfileId: 'p', skillIds: skills, ultimateId: 'big_ult',
  });
  const run = (actor: AiUnit, foes: AiUnit[], turn: number) => decideAction({
    actor, allies: [actor], foes, skills: SKILLS, profile, turn, ultMax: 100, rng: createRng(1),
  }).skill.id;

  const foe1 = mk({ id: 'e1', side: 'ENEMY' });
  const foe2 = mk({ id: 'e2', side: 'ENEMY', slot: 1 });

  const ult = base(); ult.ultGauge = 100;
  assert.equal(run(ult, [foe1], 1), 'big_ult');

  const low = base(); low.hp = 200;
  assert.equal(run(low, [foe1], 1), 'guard_up');

  const weakFoe = mk({ id: 'e1', side: 'ENEMY', hp: 100 });
  assert.equal(run(base(), [weakFoe], 1), 'poison_strike');

  assert.equal(run(base(), [foe1, foe2], 1), 'stun_bolt');
  assert.equal(run(base(), [foe1], 3), 'silence_song');
  assert.equal(run(base(), [foe1], 1), 'atk_normal'); // どれも満たさない -> ALWAYS
});

test('ai: ENEMY_HAS_BUFF / ALLY_HAS_DEBUFF が判定できる', () => {
  const profile: AiProfile = {
    id: 'p2', name: 'p2',
    rules: [
      { priority: 1, condition: { type: 'ENEMY_HAS_BUFF' }, skill: 'poison_strike' },
      { priority: 2, condition: { type: 'ALLY_HAS_DEBUFF' }, skill: 'heal_small' },
      { priority: 3, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  };
  const actor = mk({ id: 'a', aiProfileId: 'p2', skillIds: ['poison_strike', 'heal_small'] });
  const ally = mk({ id: 'b', slot: 1 });
  const foe = mk({ id: 'e', side: 'ENEMY' });
  const run = (foes: AiUnit[], allies: AiUnit[]) => decideAction({
    actor, allies, foes, skills: SKILLS, profile, turn: 1, ultMax: 100, rng: createRng(1),
  }).skill.id;

  assert.equal(run([foe], [actor, ally]), 'atk_normal');

  applyStatus(foe, { type: 'DEF_UP', duration: 3, potency: 30 }, createRng(1));
  assert.equal(run([foe], [actor, ally]), 'poison_strike');

  const foe2 = mk({ id: 'e2', side: 'ENEMY' });
  applyStatus(ally, { type: 'POISON', duration: 3, potency: 5 }, createRng(1));
  assert.equal(run([foe2], [actor, ally]), 'heal_small');
});

/* ---------- 使用可否 ---------- */

test('ai: クールダウン中のスキルは選ばれない', () => {
  const actor = mk({ id: 'a', aiProfileId: 'ai_poison', skillIds: ['poison_strike'] });
  const foe = mk({ id: 'e', side: 'ENEMY' });

  assert.equal(decide(actor, [actor], [foe]).skill.id, 'poison_strike');

  actor.cooldowns.set('poison_strike', 2);
  const d = decide(actor, [actor], [foe]);
  assert.equal(d.skill.id, 'atk_normal', 'CD中のスキルが選ばれてしまっている');
  assert.equal(isSkillUsable(actor, SKILLS.get('poison_strike')!, 100), false);
});

test('ai: 必殺ゲージが足りなければ必殺技は選ばれない', () => {
  const actor = mk({ id: 'a', aiProfileId: 'ai_ult', skillIds: ['big_ult'], ultimateId: 'big_ult' });
  const foe = mk({ id: 'e', side: 'ENEMY' });
  actor.ultGauge = 99;
  assert.equal(decide(actor, [actor], [foe]).skill.id, 'atk_normal');
  actor.ultGauge = 100;
  assert.equal(decide(actor, [actor], [foe]).skill.id, 'big_ult');
});

test('ai: SILENCE 中はスキル/必殺技が封じられ通常攻撃になる', () => {
  const actor = mk({
    id: 'a', aiProfileId: 'ai_ult', skillIds: ['big_ult'], ultimateId: 'big_ult',
  });
  actor.ultGauge = 100;
  const foe = mk({ id: 'e', side: 'ENEMY' });
  assert.equal(decide(actor, [actor], [foe]).skill.id, 'big_ult');

  applyStatus(actor, { type: 'SILENCE', duration: 3 }, createRng(1));
  const d = decide(actor, [actor], [foe]);
  assert.equal(d.skill.id, 'atk_normal');
  assert.equal(d.skill.kind, 'NORMAL');
});

test('ai: どのルールも成立しなくても必ず行動を返す (詰まない)', () => {
  const profile: AiProfile = {
    id: 'never', name: 'never',
    rules: [{ priority: 1, condition: { type: 'SELF_HP_BELOW', value: 0 }, skill: 'heal_small' }],
  };
  const actor = mk({ id: 'a', aiProfileId: 'never', skillIds: ['heal_small'] });
  const foe = mk({ id: 'e', side: 'ENEMY' });
  const d = decideAction({
    actor, allies: [actor], foes: [foe], skills: SKILLS, profile, turn: 1, ultMax: 100, rng: createRng(1),
  });
  assert.equal(d.fallback, true);
  assert.equal(d.skill.id, 'atk_normal');
  assert.equal(d.targets.length, 1);
});

test('ai: プロファイルが存在しなくても通常攻撃で行動する', () => {
  const actor = mk({ id: 'a', aiProfileId: 'missing' });
  const foe = mk({ id: 'e', side: 'ENEMY' });
  const d = decideAction({
    actor, allies: [actor], foes: [foe], skills: SKILLS, profile: undefined, turn: 1, ultMax: 100, rng: createRng(1),
  });
  assert.equal(d.skill.id, 'atk_normal');
});

/* ---------- ターゲット選択 ---------- */

test('ai/target: 全パターンが動作する', () => {
  const actor = mk({ id: 'a' });
  const allies = [actor, mk({ id: 'a2', slot: 1, hp: 300 })];
  const foes = [
    mk({ id: 'e1', side: 'ENEMY', slot: 0, hp: 900, stats: { ...baseStats, attack: 100 } }),
    mk({ id: 'e2', side: 'ENEMY', slot: 1, hp: 200, stats: { ...baseStats, attack: 500 } }),
    mk({ id: 'e3', side: 'ENEMY', slot: 2, hp: 500, stats: { ...baseStats, attack: 300 } }),
  ];
  const rng = createRng(5);
  const sel = (p: Parameters<typeof selectTargets>[1]) => selectTargets(actor, p, allies, foes, rng, 'FOCUS_LOWEST');

  assert.deepEqual(sel({ side: 'SELF', pattern: 'SELF' }).map((u) => u.id), ['a']);
  assert.deepEqual(sel({ side: 'ENEMY', pattern: 'ALL' }).map((u) => u.id), ['e1', 'e2', 'e3']);
  assert.deepEqual(sel({ side: 'ENEMY', pattern: 'LOWEST_HP' }).map((u) => u.id), ['e2']);
  assert.deepEqual(sel({ side: 'ENEMY', pattern: 'HIGHEST_ATK' }).map((u) => u.id), ['e2']);
  assert.deepEqual(sel({ side: 'ENEMY', pattern: 'FRONT', count: 2 }).map((u) => u.id), ['e1', 'e2']);
  assert.deepEqual(sel({ side: 'ALLY', pattern: 'LOWEST_HP' }).map((u) => u.id), ['a2']);
  assert.deepEqual(sel({ side: 'ENEMY', pattern: 'SINGLE' }).map((u) => u.id), ['e2']); // FOCUS_LOWEST

  const random = sel({ side: 'ENEMY', pattern: 'RANDOM', count: 2 });
  assert.equal(random.length, 2);
  assert.equal(new Set(random.map((u) => u.id)).size, 2, 'RANDOM で同じ対象が重複している');
});

test('ai/target: TAUNT が単体攻撃を引きつける', () => {
  const actor = mk({ id: 'a' });
  const e1 = mk({ id: 'e1', side: 'ENEMY', slot: 0, hp: 100 });
  const e2 = mk({ id: 'e2', side: 'ENEMY', slot: 1, hp: 1000 });
  applyStatus(e2, { type: 'TAUNT', duration: 3 }, createRng(1));
  const t = selectTargets(actor, { side: 'ENEMY', pattern: 'SINGLE' }, [actor], [e1, e2], createRng(1), 'FOCUS_LOWEST');
  assert.deepEqual(t.map((u) => u.id), ['e2'], 'HPが低い e1 ではなく挑発中の e2 を狙うべき');
});

test('ai/target: 死亡ユニットは対象にならない', () => {
  const actor = mk({ id: 'a' });
  const dead = mk({ id: 'dead', side: 'ENEMY', slot: 0, alive: false, hp: 0 });
  const live = mk({ id: 'live', side: 'ENEMY', slot: 1 });
  const rng = createRng(1);
  for (const p of ['SINGLE', 'ALL', 'RANDOM', 'LOWEST_HP', 'HIGHEST_ATK', 'FRONT'] as const) {
    const t = selectTargets(actor, { side: 'ENEMY', pattern: p, count: 3 }, [actor], [dead, live], rng);
    assert.ok(t.length > 0 && t.every((u) => u.alive), `${p} が死亡ユニットを選んでいる`);
  }
});

test('ai/target: 対象が誰もいなければ空を返す (例外を投げない)', () => {
  const actor = mk({ id: 'a' });
  const t = selectTargets(actor, { side: 'ENEMY', pattern: 'SINGLE' }, [actor], [], createRng(1));
  assert.deepEqual(t, []);
});
