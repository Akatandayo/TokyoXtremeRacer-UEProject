/** キャラクターコンボ (成立判定 + 発動) の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProfile, ComboDef, Skill } from '@akatan/shared';
import { qualifyCombos } from './combo.js';
import { runBattle } from './index.js';
import { CONFIG, aiMap, baseStats, makeContext, skillMap, unit } from './testFixtures.js';

function combosMap(defs: ComboDef[]): Map<string, ComboDef> {
  return new Map(defs.map((d) => [d.id, d]));
}

/* ---------- 1. 成立判定 (qualifyCombos, エンジン抜き) ---------- */

test('combo: PAIR は members 全員が編成にいる時だけ成立する', () => {
  const def: ComboDef = {
    id: 'pair1', name: 'ペア', kind: 'PAIR', description: '',
    members: ['charA', 'charB'],
    trigger: { type: 'ON_BATTLE_START' },
    effects: [],
  };
  const full = [unit({ id: 'u1', defId: 'charA' }), unit({ id: 'u2', defId: 'charB' })];
  const missing = [unit({ id: 'u1', defId: 'charA' }), unit({ id: 'u2', defId: 'charC' })];

  assert.equal(qualifyCombos(full, combosMap([def])).length, 1);
  assert.equal(qualifyCombos(missing, combosMap([def])).length, 0);
});

test('combo: TRIO は3人全員揃わないと成立しない', () => {
  const def: ComboDef = {
    id: 'trio1', name: 'トリオ', kind: 'TRIO', description: '',
    members: ['a', 'b', 'c'],
    trigger: { type: 'ON_BATTLE_START' },
    effects: [],
  };
  const two = [unit({ id: 'u1', defId: 'a' }), unit({ id: 'u2', defId: 'b' })];
  const three = [...two, unit({ id: 'u3', defId: 'c' })];
  assert.equal(qualifyCombos(two, combosMap([def])).length, 0);
  assert.equal(qualifyCombos(three, combosMap([def])).length, 1);
});

test('combo: TAG は requireTag.tag を持つキャラが count 体以上いれば成立する', () => {
  const def: ComboDef = {
    id: 'tag1', name: 'タグ', kind: 'TAG', description: '',
    requireTag: { tag: '刀', count: 2 },
    trigger: { type: 'ON_BATTLE_START' },
    effects: [],
  };
  const one = [unit({ id: 'u1', defId: 'a', tags: ['刀'] }), unit({ id: 'u2', defId: 'b', tags: [] })];
  const two = [unit({ id: 'u1', defId: 'a', tags: ['刀'] }), unit({ id: 'u2', defId: 'b', tags: ['刀', '前衛'] })];
  assert.equal(qualifyCombos(one, combosMap([def])).length, 0);
  const runtime = qualifyCombos(two, combosMap([def]));
  assert.equal(runtime.length, 1);
  assert.deepEqual([...runtime[0]!.participantDefIds].sort(), ['a', 'b']);
});

test('combo: PARTY は編成全員が requireAllElement と同じ属性でないと成立しない', () => {
  const def: ComboDef = {
    id: 'party1', name: 'パーティ', kind: 'PARTY', description: '',
    requireAllElement: 'FIRE',
    trigger: { type: 'ON_BATTLE_START' },
    effects: [],
  };
  const mixed = [unit({ id: 'u1', defId: 'a', element: 'FIRE' }), unit({ id: 'u2', defId: 'b', element: 'WATER' })];
  const allFire = [unit({ id: 'u1', defId: 'a', element: 'FIRE' }), unit({ id: 'u2', defId: 'b', element: 'FIRE' })];
  assert.equal(qualifyCombos(mixed, combosMap([def])).length, 0);
  assert.equal(qualifyCombos(allFire, combosMap([def])).length, 1);
});

/* ---------- 2. エンジンでの発動 ---------- */

/** a1 が atk_normal を使ったら a2 (相方) が atk_normal で追撃する、という最小のPAIRコンボ */
function pairCombo(trigOver: Partial<ComboDef['trigger']> = {}, defOver: Partial<ComboDef> = {}): ComboDef {
  return {
    id: 'combo_pair', name: '連携爆撃', kind: 'PAIR', description: 'テスト用コンボ',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_SKILL_USE', actor: 'a1', skill: 'atk_normal', ...trigOver },
    effects: [{ skill: 'atk_normal' }],
    fx: 'combo_fx',
    ...defOver,
  };
}

test('combo(engine): combos未指定なら従来どおり動作し、COMBOイベントは出ない', () => {
  const log = runBattle(
    [unit({ id: 'a1', slot: 0, side: 'ALLY' })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
    makeContext({ seed: 1 }),
  );
  assert.equal(log.events.filter((e) => e.type === 'COMBO').length, 0);
});

test('combo(engine): ON_SKILL_USE で発動し、COMBOイベントに必須フィールドが揃う', () => {
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, speed: 1000, attack: 50 },
    }),
    unit({
      id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, speed: 1, attack: 50 },
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, speed: 1, attack: 1 },
    }),
  ];
  const combo = pairCombo({ cooldown: 0, maxPerBattle: 1 });
  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 3 }, combos: combosMap([combo]),
  }));

  const comboEvents = log.events.filter((e) => e.type === 'COMBO');
  assert.equal(comboEvents.length, 1, 'COMBO イベントが1回だけ出るはず');
  const ev = comboEvents[0]!;
  assert.equal(ev.comboId, combo.id);
  assert.equal(ev.skillName, combo.name, 'skillName にコンボ名が入るはず');
  assert.equal(ev.sourceId, 'a1', '起点キャラ');
  assert.equal(ev.targetId, 'a2', '相方(performer)');
  assert.ok(ev.text && ev.text.length > 0, '実況テキストが無い');
  assert.equal(ev.fx, combo.fx);
  assert.ok(ev.snapshot, 'COMBO に snapshot が無い');
  assert.equal(ev.snapshot!.length, log.units.length, 'snapshot が全ユニット分でない');
});

test('combo(engine): cooldown を尊重し、指定回数を待たないと再発動しない', () => {
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1000, attack: 1 },
    }),
    unit({
      id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1, attack: 1 },
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1, attack: 1 },
    }),
  ];
  const combo = pairCombo({ cooldown: 3 }); // maxPerBattle 省略 = 無制限
  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 11 }, combos: combosMap([combo]),
  }));

  // a1 は speed1000 (gaugeRate0.1 * speed1000 = 100/tick = 毎tick1行動) なので maxTicks=11 で正確に11回行動する
  const a1ActionSeqs = log.events
    .filter((e) => e.type === 'SKILL_USE' && e.sourceId === 'a1')
    .map((e) => e.seq);
  assert.equal(a1ActionSeqs.length, 11, `想定と違うa1の行動数: ${a1ActionSeqs.length}`);

  const comboEvents = log.events.filter((e) => e.type === 'COMBO');
  // cooldown=3 -> 発動は4行動ごと (a1の1,5,9回目) = 3回
  assert.equal(comboEvents.length, 3, `cooldownが効いていない: ${comboEvents.length}回発動`);

  const fireAtA1Index = comboEvents.map((c) => a1ActionSeqs.filter((seq) => seq <= c.seq).length);
  assert.deepEqual(fireAtA1Index, [1, 5, 9], 'クールダウンの間隔(4行動ごと)がずれている');
});

test('combo(engine): maxPerBattle が効き、それ以上は発動しない', () => {
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1000, attack: 1 },
    }),
    unit({
      id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1, attack: 1 },
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1, attack: 1 },
    }),
  ];
  const combo = pairCombo({ cooldown: 0, maxPerBattle: 2 });
  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 5 }, combos: combosMap([combo]),
  }));
  // cooldown0 なら a1 の5行動すべてで発動しうるが、maxPerBattle=2 で止まるはず
  const comboEvents = log.events.filter((e) => e.type === 'COMBO');
  assert.equal(comboEvents.length, 2, `maxPerBattleを超えて発動している: ${comboEvents.length}`);
});

test('combo(engine): performer が戦闘不能なら発動しない (COMBOイベント/cooldown消費も無い)', () => {
  const hitAll: Skill = {
    id: 'combo_hit_all', name: '範囲攻撃', kind: 'ACTIVE', description: '', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'ALL' },
    effects: [{ type: 'DAMAGE', power: 1 }],
  };
  const aiHitAll: AiProfile = {
    id: 'ai_hit_all', name: '範囲攻撃AI',
    rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'combo_hit_all' }],
  };
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 999999, speed: 1000, attack: 1 },
    }),
    unit({
      id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 1, speed: 1, attack: 1 },
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_hit_all', skills: ['combo_hit_all'],
      stats: { ...baseStats, hp: 999999, speed: 200, attack: 500 },
    }),
  ];
  const combo = pairCombo({ cooldown: 0 }); // maxPerBattle 無制限
  const log = runBattle(allies, enemies, makeContext({
    seed: 1,
    config: { ...CONFIG, maxTicks: 10 },
    skills: skillMap([hitAll]),
    aiProfiles: aiMap([aiHitAll]),
    combos: combosMap([combo]),
  }));

  const defeatIdx = log.events.findIndex((e) => e.type === 'DEFEAT' && e.targetId === 'a2');
  assert.ok(defeatIdx >= 0, 'a2 が撃破されていない (テスト前提が崩れている)');
  const defeatSeq = log.events[defeatIdx]!.seq;

  const comboEvents = log.events.filter((e) => e.type === 'COMBO');
  assert.equal(comboEvents.length, 5, 'a2生存中(a1の5行動)は毎回発動するはず');
  assert.ok(comboEvents.every((e) => e.seq < defeatSeq), 'a2 撃破後もコンボが発動している');
});

test('combo(engine): ON_BATTLE_START は戦闘開始時に1回だけ発動する', () => {
  const allies = [
    unit({ id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', stats: { ...baseStats, hp: 50000 } }),
    unit({ id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', stats: { ...baseStats, hp: 50000 } }),
  ];
  const enemies = [unit({ id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', stats: { ...baseStats, hp: 50000 } })];
  const combo: ComboDef = {
    id: 'combo_start', name: '開幕連携', kind: 'PAIR', description: '',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_BATTLE_START' },
    effects: [{ effect: { type: 'STATUS', status: 'ATK_UP', duration: 3, potency: 20 } }],
  };
  const log = runBattle(allies, enemies, makeContext({
    seed: 1, config: { ...CONFIG, maxTicks: 50 }, combos: combosMap([combo]),
  }));
  const comboEvents = log.events.filter((e) => e.type === 'COMBO' && e.comboId === 'combo_start');
  assert.equal(comboEvents.length, 1);
  assert.equal(comboEvents[0]!.sourceId, 'a1', '起点は参加キャラのうち slot 最小');
  assert.equal(comboEvents[0]!.targetId, 'a2', 'performer はもう一方');
  assert.ok(
    log.events.some((e) => e.type === 'STATUS_APPLY' && e.targetId === 'a2' && e.status === 'ATK_UP'),
    'performer(a2) に効果が乗っていない',
  );
});

test('combo(engine): ON_HP_BELOW でHPが閾値を下回った時に発動する', () => {
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, speed: 100 },
    }),
    unit({
      id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 200, defense: 0, speed: 100 },
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, attack: 150, defense: 0, speed: 100 },
    }),
  ];
  const combo: ComboDef = {
    id: 'combo_hpbelow', name: '危機の連携', kind: 'PAIR', description: '',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_HP_BELOW', hpBelow: 50 },
    effects: [{ effect: { type: 'STATUS', status: 'SHIELD', duration: 2, potency: 10 } }],
  };
  const log = runBattle(allies, enemies, makeContext({
    seed: 3, config: { ...CONFIG, maxTicks: 500 }, combos: combosMap([combo]),
  }));
  const comboEvents = log.events.filter((e) => e.type === 'COMBO');
  assert.ok(comboEvents.length >= 1, 'HP低下コンボが一度も発動していない');
});

test('combo(engine): ON_ALLY_DEFEATED で味方撃破時に発動する', () => {
  const allies = [
    unit({
      id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, speed: 100 },
    }),
    unit({
      id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 1, defense: 0, speed: 100 },
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_basic',
      stats: { ...baseStats, hp: 50000, attack: 50, speed: 100 },
    }),
  ];
  const combo: ComboDef = {
    id: 'combo_revenge', name: '弔い討ち', kind: 'PAIR', description: '',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_ALLY_DEFEATED' },
    effects: [{ effect: { type: 'STATUS', status: 'ATK_UP', duration: 5, potency: 50 } }],
  };
  const log = runBattle(allies, enemies, makeContext({
    seed: 5, config: { ...CONFIG, maxTicks: 500 }, combos: combosMap([combo]),
  }));
  const defeatIdx = log.events.findIndex((e) => e.type === 'DEFEAT' && e.targetId === 'a2');
  assert.ok(defeatIdx >= 0, 'a2 が撃破されていない (テスト前提が崩れている)');

  const comboEvents = log.events.filter((e) => e.type === 'COMBO' && e.comboId === 'combo_revenge');
  assert.ok(comboEvents.length >= 1, '撃破時コンボが発動していない');
  assert.equal(comboEvents[0]!.sourceId, 'a2', '起点は撃破された本人');
  assert.equal(comboEvents[0]!.targetId, 'a1', '生き残っているもう一方が performer');
});

test('combo(engine): コンボが有効でも決定論が保たれる (同シード同入力→ログ完全一致)', () => {
  const combo = pairCombo({ cooldown: 1, maxPerBattle: 5 });
  const build = () => {
    const allies = [
      unit({
        id: 'a1', slot: 0, defId: 'a1', side: 'ALLY', aiProfile: 'ai_basic',
        stats: { ...baseStats, hp: 3000, attack: 200, speed: 120 },
      }),
      unit({
        id: 'a2', slot: 1, defId: 'a2', side: 'ALLY', aiProfile: 'ai_basic',
        stats: { ...baseStats, hp: 2600, attack: 150, speed: 95 },
      }),
    ];
    const enemies = [
      unit({
        id: 'e1', slot: 0, defId: 'e1', side: 'ENEMY', aiProfile: 'ai_basic',
        stats: { ...baseStats, hp: 3200, attack: 130, speed: 105 },
      }),
    ];
    return runBattle(allies, enemies, makeContext({
      seed: 42,
      now: '2026-09-17T00:00:00.000Z',
      config: { ...CONFIG, maxTicks: 1000 },
      combos: combosMap([combo]),
    }));
  };
  const a = build();
  const b = build();
  // createdAt を含めた完全一致 (P1-1): ctx.now を注入すればハッシュ比較が成立することの確認
  assert.equal(JSON.stringify(a), JSON.stringify(b), 'コンボ込みでもログが完全一致しない');
  assert.equal(a.createdAt, '2026-09-17T00:00:00.000Z');
  assert.ok(a.events.some((e) => e.type === 'COMBO'), 'コンボが一度も発動していない (テスト前提が崩れている)');
});
