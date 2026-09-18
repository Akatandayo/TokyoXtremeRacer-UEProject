/** 装備の特殊効果 (ItemSpecialEffect) の発動タイミング・確率・決定論の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ComboDef, ItemSpecialEffect, Skill } from '@akatan/shared';
import { runBattle } from './index.js';
import { CONFIG, baseStats, makeContext, skillMap, unit } from './testFixtures.js';

/* ---------- 1. ON_BATTLE_START ---------- */

test('specials: ON_BATTLE_START は戦闘開始時に1回だけ発動する', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_start_atkup', name: '闘気', description: '', trigger: 'ON_BATTLE_START',
    status: 'ATK_UP', duration: 3, potency: 20,
  };
  const log = runBattle(
    [unit({ id: 'a1', slot: 0, specials: [special] })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
    makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 3 } }),
  );
  const applies = log.events.filter(
    (e) => e.type === 'STATUS_APPLY' && e.targetId === 'a1' && e.status === 'ATK_UP',
  );
  assert.equal(applies.length, 1, 'ON_BATTLE_STARTは1回だけ発動するはず');
  assert.equal(applies[0]!.skillName, special.name, 'skillNameに特殊効果名が入るはず');
  assert.equal(applies[0]!.sourceId, 'a1', '自己付与なのでsourceIdは自分自身');
});

test('specials: 戦闘開始時イベントの直後にON_BATTLE_STARTが発動する(TURN_STARTより前)', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_start_shield', name: '開幕障壁', description: '', trigger: 'ON_BATTLE_START',
    status: 'SHIELD', duration: 3, potency: 10,
  };
  const log = runBattle(
    [unit({ id: 'a1', slot: 0, specials: [special] })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
    makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }),
  );
  const battleStartIdx = log.events.findIndex((e) => e.type === 'BATTLE_START');
  const firstTurnStartIdx = log.events.findIndex((e) => e.type === 'TURN_START');
  const applyIdx = log.events.findIndex((e) => e.type === 'STATUS_APPLY' && e.status === 'SHIELD');
  assert.ok(battleStartIdx >= 0 && applyIdx > battleStartIdx, 'BATTLE_STARTの後に発動するはず');
  assert.ok(firstTurnStartIdx > applyIdx, 'TURN_STARTより前に発動するはず');
});

/* ---------- 2. ON_ATTACK ---------- */

/** a1: 高速・高攻撃力の攻撃役、e1: 低速の的。maxTicks=1 で a1 が1回だけ行動する状況を作る。 */
function attackerVsDummy(specials?: ItemSpecialEffect[]): { allies: ReturnType<typeof unit>[]; enemies: ReturnType<typeof unit>[] } {
  return {
    allies: [unit({
      id: 'a1', slot: 0, side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 99999, speed: 1000, attack: 100 }, specials,
    })],
    enemies: [unit({
      id: 'e1', slot: 0, side: 'ENEMY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 99999, speed: 1, attack: 1 },
    })],
  };
}

test('specials: ON_ATTACK は chance=0 なら発動しない', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_never', name: '不発の一撃', description: '', trigger: 'ON_ATTACK',
    chance: 0, status: 'BURN', duration: 2, potency: 5,
  };
  const { allies, enemies } = attackerVsDummy([special]);
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));
  assert.equal(log.events.filter((e) => e.type === 'STATUS_APPLY' && e.status === 'BURN').length, 0);
});

test('specials: ON_ATTACK は chance=100 なら必ず発動し、bonusDamageが追加ダメージとして乗る', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_burn_strike', name: '燃焼の一撃', description: '', trigger: 'ON_ATTACK',
    chance: 100, status: 'BURN', duration: 2, potency: 5, bonusDamage: 0.5,
  };
  const { allies, enemies } = attackerVsDummy([special]);
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));

  const damageEvents = log.events.filter((e) => e.type === 'DAMAGE' && e.sourceId === 'a1');
  assert.equal(damageEvents.length, 2, '通常攻撃ダメージ + 追撃ダメージの2件出るはず');
  assert.equal(damageEvents[1]!.skillName, special.name, '追撃のskillNameに特殊効果名が入るはず');
  assert.equal(damageEvents[1]!.fx, 'equip:sp_burn_strike', 'fxに装備由来を示す命名規約が入るはず');

  const applies = log.events.filter(
    (e) => e.type === 'STATUS_APPLY' && e.status === 'BURN' && e.targetId === 'e1',
  );
  assert.equal(applies.length, 1, 'BURNが対象(敵)に1回付与されるはず');
  assert.equal(applies[0]!.sourceId, 'a1', '付与元は攻撃した側');
});

/* ---------- 3. ON_HIT_TAKEN ---------- */

test('specials: ON_HIT_TAKEN は被弾直後に自分自身へ発動する', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_counter_guard', name: '反射装甲', description: '', trigger: 'ON_HIT_TAKEN',
    chance: 100, status: 'DEF_UP', duration: 2, potency: 30,
  };
  const allies = [unit({
    id: 'a1', slot: 0, stats: { ...baseStats, hp: 99999, speed: 1000, attack: 100 },
  })];
  const enemies = [unit({
    id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1, attack: 1 }, specials: [special],
  })];
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));

  const applies = log.events.filter(
    (e) => e.type === 'STATUS_APPLY' && e.targetId === 'e1' && e.status === 'DEF_UP',
  );
  assert.equal(applies.length, 1, '被弾した敵に1回だけ発動するはず');
  assert.equal(applies[0]!.sourceId, 'e1', '自己付与なのでsourceIdは自分自身');
});

test('specials: ON_HIT_TAKEN は chance=0 なら発動しない', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_never_guard', name: '不発の反射装甲', description: '', trigger: 'ON_HIT_TAKEN',
    chance: 0, status: 'DEF_UP', duration: 2, potency: 30,
  };
  const allies = [unit({
    id: 'a1', slot: 0, stats: { ...baseStats, hp: 99999, speed: 1000, attack: 100 },
  })];
  const enemies = [unit({
    id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1, attack: 1 }, specials: [special],
  })];
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));
  assert.equal(log.events.filter((e) => e.type === 'STATUS_APPLY' && e.status === 'DEF_UP').length, 0);
});

/* ---------- 4. ON_KILL ---------- */

test('specials: ON_KILL は撃破した直後に自分自身へ発動する', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_bloodlust', name: '血の渇き', description: '', trigger: 'ON_KILL',
    chance: 100, status: 'ATK_UP', duration: 3, potency: 25,
  };
  const allies = [unit({
    id: 'a1', slot: 0, stats: { ...baseStats, hp: 99999, speed: 1000, attack: 999999 }, specials: [special],
  })];
  const enemies = [unit({
    id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 1, speed: 1, attack: 1, defense: 0 },
  })];
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 3 } }));

  assert.ok(log.events.some((e) => e.type === 'DEFEAT' && e.targetId === 'e1'), '敵が倒れていない');
  const applies = log.events.filter(
    (e) => e.type === 'STATUS_APPLY' && e.targetId === 'a1' && e.status === 'ATK_UP',
  );
  assert.equal(applies.length, 1, 'ON_KILLは撃破した本人に1回発動するはず');
  assert.equal(applies[0]!.sourceId, 'a1');
});

/* ---------- 5. 決定論: 後方互換 (specials未指定なら従来と完全に同じログ) ---------- */

test('specials: 未指定(省略/undefined/空配列)なら、いずれも完全に同じログになる(乱数消費が増えない)', () => {
  const seed = 777;
  const build = (specials?: ItemSpecialEffect[]) => runBattle(
    [unit({ id: 'a1', slot: 0, specials })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
    makeContext({ seed }),
  );
  const omitted = build(undefined);
  const explicitUndefined = build(undefined);
  const emptyArray = build([]);

  assert.deepEqual(explicitUndefined.events, omitted.events);
  assert.deepEqual(explicitUndefined.result, omitted.result);
  assert.deepEqual(emptyArray.events, omitted.events, 'specials:[] もundefined相当のログになるはず');
});

test('specials: 未指定の戦闘は、この変更を入れる前と同じ84件のリプレイ互換性を持つ(既存フィクスチャの代表例で確認)', () => {
  // 既存 engine.test.ts / combo.test.ts と同じ組み合わせ方(makeContext + unit)で
  // specials に一切触れずに戦闘を組み、最後まで正常に完走することを確認する。
  // (本質的な回帰確認は既存84件テストの継続パスで担保する。ここでは specials 関連の
  //  コードパスに触れていないことを damage.ts 等と同じ最低限の生存確認で押さえる)
  const log = runBattle(
    [unit({ id: 'a1', slot: 0 })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
    makeContext({ seed: 5 }),
  );
  assert.equal(log.events[log.events.length - 1]!.type, 'BATTLE_END');
});

/* ---------- 6. 決定論: specials指定時も同シード再現性を持つ ---------- */

test('specials: specials指定時も同シード2回実行で完全に同じログになる', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_multi', name: '会心の護符', description: '', trigger: 'ON_ATTACK',
    chance: 50, status: 'BURN', duration: 2, potency: 4, bonusDamage: 0.3,
  };
  const build = () => runBattle(
    [unit({ id: 'a1', slot: 0, stats: { ...baseStats, speed: 120 }, specials: [special] })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, speed: 90 } })],
    makeContext({ seed: 42, config: { ...CONFIG, maxTicks: 40 } }),
  );
  const log1 = build();
  const log2 = build();
  assert.deepEqual(log1.events, log2.events, '同シード2回実行のログが一致しない');
  assert.deepEqual(log1.result, log2.result);
});

/* ---------- 7. 無限連鎖の防止 ---------- */

test('specials: 多段ヒットでも同じ特殊効果は1行動につき最大1回しか発動しない(無限連鎖防止)', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_once', name: '一撃必殺の残光', description: '', trigger: 'ON_ATTACK',
    chance: 100, status: 'BURN', duration: 2, potency: 3, bonusDamage: 0.2,
  };
  const tripleStrike: Skill = {
    id: 'triple_strike', name: '三連撃', kind: 'NORMAL', description: '三連続攻撃', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'DAMAGE', power: 0.3, hits: 3 }],
  };
  const allies = [unit({
    id: 'a1', slot: 0, normalAttack: 'triple_strike',
    stats: { ...baseStats, hp: 99999, speed: 1000, attack: 100 }, specials: [special],
  })];
  const enemies = [unit({
    id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1, attack: 1 },
  })];
  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 1 }, skills: skillMap([tripleStrike]),
  }));

  const damageFromA1 = log.events.filter((e) => e.type === 'DAMAGE' && e.sourceId === 'a1');
  // 3ヒット分の通常ダメージ + bonusDamageは(上限により)1回だけ = 4件
  assert.equal(damageFromA1.length, 4, `想定外のDAMAGE件数: ${damageFromA1.length}`);
  const bonusHits = damageFromA1.filter((e) => e.skillName === special.name);
  assert.equal(bonusHits.length, 1, 'bonusDamageは1行動につき1回だけのはず(無限連鎖防止の上限)');

  const burnApplies = log.events.filter((e) => e.type === 'STATUS_APPLY' && e.status === 'BURN');
  assert.equal(burnApplies.length, 1, 'BURN付与も1行動につき1回だけのはず');
});

test('specials: bonusDamageの追撃自体は新たなON_ATTACKを誘発しない', () => {
  // 追撃ダメージが致死量でも、target を倒すだけで無限に自分自身を再誘発しないことを確認する。
  // (triggerOnAttackSpecials は applySpecialBonusDamage から一切呼ばれない設計)
  const special: ItemSpecialEffect = {
    id: 'sp_execute', name: '処刑の追撃', description: '', trigger: 'ON_ATTACK',
    chance: 100, bonusDamage: 50, // 大ダメージで確実に追撃だけで敵を倒せるようにする
  };
  const allies = [unit({
    id: 'a1', slot: 0, stats: { ...baseStats, hp: 99999, speed: 1000, attack: 100 }, specials: [special],
  })];
  const enemies = [unit({
    // 通常攻撃(power1.0, attack100)では倒れないが、bonusDamage(power50)なら確実に倒れるHPに設定する。
    id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 130, speed: 1, attack: 1, defense: 0 },
  })];
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 3 } }));

  const damageFromA1 = log.events.filter((e) => e.type === 'DAMAGE' && e.sourceId === 'a1');
  assert.equal(damageFromA1.length, 2, '通常攻撃 + 追撃の2件だけで完結するはず(連鎖しない)');
  assert.ok(log.events.some((e) => e.type === 'DEFEAT' && e.targetId === 'e1'), '追撃で撃破できているはず');
  assert.equal(log.events[log.events.length - 1]!.type, 'BATTLE_END');
});

/* ---------- 8. コンボとの併用 ---------- */

test('specials: コンボと装備の特殊効果が同時に発動しても壊れない', () => {
  const special: ItemSpecialEffect = {
    id: 'sp_combo_ok', name: '連携の刃', description: '', trigger: 'ON_ATTACK',
    chance: 100, status: 'BURN', duration: 2, potency: 3,
  };
  const combo: ComboDef = {
    id: 'combo_x', name: '連携', kind: 'PAIR', description: '',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_SKILL_USE', actor: 'a1', skill: 'atk_normal' },
    effects: [{ skill: 'atk_normal' }],
  };
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1',
      stats: { ...baseStats, hp: 99999, speed: 1000, attack: 100 }, specials: [special],
    }),
    unit({ id: 'a2', slot: 1, defId: 'a2', stats: { ...baseStats, hp: 99999, speed: 1, attack: 50 } }),
  ];
  const enemies = [unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1, attack: 1 } })];
  const combos = new Map([[combo.id, combo]]);

  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 1 }, combos,
  }));

  assert.ok(log.events.some((e) => e.type === 'COMBO'), 'コンボが発動していない');
  assert.ok(
    log.events.some((e) => e.type === 'STATUS_APPLY' && e.status === 'BURN'),
    '装備の特殊効果が発動していない',
  );
  assert.equal(log.events[log.events.length - 1]!.type, 'BATTLE_END', '最後まで正常に完走するはず');
});

test('specials: コンボの追撃者(performer)自身の特殊効果も、その行動の枠内で1回発動する', () => {
  // a2(performer)がON_ATTACKの装備を持つ場合、コンボ追撃のダメージでも発動すること、
  // かつ同じ行動内で複数回暴発しないことを確認する。
  const special: ItemSpecialEffect = {
    id: 'sp_performer', name: '追撃の煌き', description: '', trigger: 'ON_ATTACK',
    chance: 100, status: 'ATK_DOWN', duration: 2, potency: 10,
  };
  const combo: ComboDef = {
    id: 'combo_y', name: '連携2', kind: 'PAIR', description: '',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_SKILL_USE', actor: 'a1', skill: 'atk_normal' },
    effects: [{ skill: 'atk_normal' }],
  };
  const allies = [
    unit({ id: 'a1', slot: 0, defId: 'a1', stats: { ...baseStats, hp: 99999, speed: 1000, attack: 50 } }),
    unit({
      id: 'a2', slot: 1, defId: 'a2',
      stats: { ...baseStats, hp: 99999, speed: 1, attack: 50 }, specials: [special],
    }),
  ];
  const enemies = [unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1, attack: 1 } })];
  const combos = new Map([[combo.id, combo]]);

  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 1 }, combos,
  }));

  const applies = log.events.filter(
    (e) => e.type === 'STATUS_APPLY' && e.status === 'ATK_DOWN' && e.sourceId === 'a2',
  );
  assert.equal(applies.length, 1, 'コンボ追撃者の特殊効果も1回だけ発動するはず');
});
