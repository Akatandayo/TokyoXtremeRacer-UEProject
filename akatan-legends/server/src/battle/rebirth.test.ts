/**
 * 転生の戦闘補正 (CombatantInput.rebirthMods, 設計書§17〜§19) の検証。
 * ------------------------------------------------------------
 * 対象は RebirthEffectKind のうち SKILL_POWER / GAUGE_START / ULT_GAUGE_START の3種。
 * 最重要の観点は「rebirthMods 未指定なら乱数消費が1回も増えず、ログが従来と完全に同一になる」こと
 * (specials.test.ts / combo.test.ts と同じ後方互換パターンに揃える)。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleLog } from '@akatan/shared';
import { runBattle } from './index.js';
import { CONFIG, baseStats, makeContext, unit } from './testFixtures.js';

/** createdAt だけが実時刻依存なので、比較時は取り除く */
function normalize(log: BattleLog): string {
  const { createdAt, ...rest } = log;
  void createdAt;
  return JSON.stringify(rest);
}

/* ---------- 1. SKILL_POWER: スキル威力への割合加算 ---------- */

test('rebirth: skillPowerPercent がダメージに乗る (計算が割り切れる値で厳密検証)', () => {
  // variance:0, critical:0, defense:0 にして round() の揺れを無くし、厳密な倍率検証をする。
  // attack=200, power=1(通常攻撃) => base=200。skillPowerPercent:50 => power実質1.5倍 => 300。
  const ctx = makeContext({ seed: 1, config: { ...CONFIG, damageVariance: 0, maxTicks: 1 } });
  const allies = (mods?: { skillPowerPercent?: number }) => [unit({
    id: 'a1', slot: 0, side: 'ALLY',
    stats: { ...baseStats, hp: 99999, speed: 1000, attack: 200, critical: 0 },
    rebirthMods: mods,
  })];
  const enemies = [unit({
    id: 'e1', slot: 0, side: 'ENEMY',
    stats: { ...baseStats, hp: 99999, speed: 1, attack: 1, defense: 0 },
  })];

  const base = runBattle(allies(undefined), enemies, ctx);
  const boosted = runBattle(allies({ skillPowerPercent: 50 }), enemies, ctx);

  const dmgOf = (log: BattleLog): number =>
    log.events.find((e) => e.type === 'DAMAGE' && e.sourceId === 'a1')!.value!;

  assert.equal(dmgOf(base), 200, '前提となる基準ダメージが想定と違う');
  assert.equal(dmgOf(boosted), 300, 'skillPowerPercent:50 は power を1.5倍するはず');
});

test('rebirth: skillPowerPercent:0 (明示的に0) はダメージを変化させない', () => {
  const ctx = makeContext({ seed: 1, config: { ...CONFIG, damageVariance: 0, maxTicks: 1 } });
  const allies = (mods?: { skillPowerPercent?: number }) => [unit({
    id: 'a1', slot: 0, side: 'ALLY',
    stats: { ...baseStats, hp: 99999, speed: 1000, attack: 200, critical: 0 },
    rebirthMods: mods,
  })];
  const enemies = [unit({
    id: 'e1', slot: 0, side: 'ENEMY',
    stats: { ...baseStats, hp: 99999, speed: 1, attack: 1, defense: 0 },
  })];

  const omitted = runBattle(allies(undefined), enemies, ctx);
  const explicitZero = runBattle(allies({ skillPowerPercent: 0 }), enemies, ctx);
  assert.deepEqual(explicitZero.events, omitted.events, 'skillPowerPercent:0 は補正なしと同じログになるはず');
});

/* ---------- 2. GAUGE_START: 戦闘開始時の行動ゲージ ---------- */

test('rebirth: gaugeStart:100 で、本来なら遅いユニットが先に行動できる', () => {
  // ally は enemy より遅い (speed 50 vs 100) ので、補正が無ければ enemy が先に行動する。
  const allyNoMod = unit({
    id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 99999, speed: 50 },
  });
  const allyWithMod = unit({
    id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 99999, speed: 50 },
    rebirthMods: { gaugeStart: 100 },
  });
  const enemy = unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 100 } });
  const ctx = makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 10 } });

  const without = runBattle([allyNoMod], [enemy], ctx);
  const withMod = runBattle([allyWithMod], [enemy], ctx);

  const firstActor = (log: BattleLog): string | undefined =>
    log.events.find((e) => e.type === 'ACTION_START')?.sourceId;

  assert.equal(firstActor(without), 'e1', '前提: 補正なしでは速いenemyが先に動く');
  assert.equal(firstActor(withMod), 'a1', 'gaugeStart:100 なら開幕から即座に行動できるはず');
});

test('rebirth: gaugeStart で同時到達(超過量0)になっても、行動順の解決規則(超過量→speed→slot→…)は変わらない', () => {
  // 両者とも gaugeStart:100 で「超過量0」の完全な同時到達を作る。
  // 解決規則の2番目 (実効speedが速い方が先) が、slotの大小に関係なく優先されることを確認する。
  const a1 = unit({
    id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 99999, speed: 50 },
    rebirthMods: { gaugeStart: 100 },
  });
  const a2 = unit({
    id: 'a2', slot: 1, side: 'ALLY', stats: { ...baseStats, hp: 99999, speed: 200 },
    rebirthMods: { gaugeStart: 100 },
  });
  const enemy = unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1 } });
  const log = runBattle([a1, a2], [enemy], makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));

  const firstAction = log.events.find((e) => e.type === 'ACTION_START');
  assert.equal(firstAction?.sourceId, 'a2', 'slotが大きくてもspeedが速いa2が先に行動するはず (規則を保持)');
});

test('rebirth: gaugeStart は戦闘開始時に1回だけ適用され、行動のたびに再適用されない', () => {
  // gaugeStart:100 の a1 は初手だけ「無償の1手」を得る。以後は通常のゲージ式(speed基準)に従うはずで、
  // 毎ターンゲージが100%スタートするような異常な連続行動にはならない。
  const a1 = unit({
    id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 99999, speed: 50 },
    rebirthMods: { gaugeStart: 100 },
  });
  const a1NoMod = unit({
    id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 99999, speed: 50 },
  });
  const enemy = unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 50 } });
  const ctx = makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 200 } });

  const withMod = runBattle([a1], [enemy], ctx);
  const withoutMod = runBattle([a1NoMod], [enemy], ctx);

  const actionsOf = (log: BattleLog): string[] =>
    log.events.filter((e) => e.type === 'ACTION_START').map((e) => e.sourceId!);

  const modActions = actionsOf(withMod);
  const plainActions = actionsOf(withoutMod);
  // gaugeStart:100 は「無償の先手を1回だけ与える」だけで、以後は通常のゲージ式に戻る。
  // つまり「無償の1手を消費した直後の状態」は、両者ともゲージ0からの通常戦闘と完全に同型になり、
  // withMod の2手目以降は withoutMod の1手目以降(=通常戦闘そのもの)と1手ずれで一致するはず
  // (再適用されていれば、この「1手ずれでの一致」は成立しない)。
  assert.equal(modActions[0], 'a1', 'gaugeStart:100 は最初の1手を保証するはず');
  const k = 10;
  assert.deepEqual(
    modActions.slice(1, 1 + k), plainActions.slice(0, k),
    '無償の1手の後は、通常戦闘の最初からの行動順と(1手ずれで)一致するはず(再適用されない)',
  );
});

/* ---------- 3. ULT_GAUGE_START: 戦闘開始時の必殺ゲージ ---------- */

test('rebirth: ultGaugeStart は100%を超えないようクランプされる', () => {
  const ally = unit({
    id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 99999 },
    rebirthMods: { ultGaugeStart: 250 },
  });
  const enemy = unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999 } });
  const log = runBattle([ally], [enemy], makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));

  const a1Initial = log.units.find((u) => u.id === 'a1')!;
  assert.equal(a1Initial.ultGauge, CONFIG.ultMax, 'ultGaugeStart は ultMax でクランプされるはず');
});

test('rebirth: ultGaugeStart:100 なら開幕から必殺技が撃てる', () => {
  const ally = unit({
    id: 'a1', slot: 0, side: 'ALLY', aiProfile: 'ai_ult',
    skills: ['poison_strike', 'big_ult'], ultimate: 'big_ult',
    stats: { ...baseStats, hp: 99999, speed: 1000 },
    rebirthMods: { ultGaugeStart: 100 },
  });
  const enemy = unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 1 } });
  const log = runBattle([ally], [enemy], makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 1 } }));

  const firstSkillUse = log.events.find((e) => e.type === 'SKILL_USE');
  assert.equal(firstSkillUse?.skillId, 'big_ult', '必殺ゲージが最初から満タンなので初手で必殺技を撃てるはず');
});

/* ---------- 4. 決定論: 後方互換 (rebirthMods 未指定なら従来と完全に同じログ) ---------- */

test('rebirth: rebirthMods 未指定(省略/undefined/空オブジェクト)なら、いずれも完全に同じログになる', () => {
  const seed = 999;
  const build = (rebirthMods?: { skillPowerPercent?: number; gaugeStart?: number; ultGaugeStart?: number }) =>
    runBattle(
      [unit({ id: 'a1', slot: 0, rebirthMods })],
      [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
      makeContext({ seed }),
    );
  const omitted = build(undefined);
  const explicitUndefined = build(undefined);
  const emptyObject = build({});

  assert.deepEqual(explicitUndefined.events, omitted.events);
  assert.deepEqual(explicitUndefined.result, omitted.result);
  assert.deepEqual(emptyObject.events, omitted.events, 'rebirthMods:{} もundefined相当のログになるはず');
});

test('rebirth: rebirthMods を全く使わない既存フィクスチャの組み合わせは、完走してBATTLE_ENDで終わる', () => {
  const log = runBattle(
    [unit({ id: 'a1', slot: 0 })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY' })],
    makeContext({ seed: 5 }),
  );
  assert.equal(log.events[log.events.length - 1]!.type, 'BATTLE_END');
});

/* ---------- 5. 決定論: rebirthMods指定時も同シード再現性を持つ ---------- */

test('rebirth: rebirthMods指定時も同シード2回実行で完全に同じログになる', () => {
  const build = () => runBattle(
    [unit({
      id: 'a1', slot: 0, side: 'ALLY', aiProfile: 'ai_ult',
      skills: ['poison_strike', 'big_ult'], ultimate: 'big_ult',
      stats: { ...baseStats, speed: 120, critical: 25 },
      rebirthMods: { skillPowerPercent: 30, gaugeStart: 40, ultGaugeStart: 60 },
    })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, speed: 90 } })],
    makeContext({ seed: 42, config: { ...CONFIG, maxTicks: 40 } }),
  );
  const log1 = build();
  const log2 = build();
  assert.deepEqual(log1.events, log2.events, '同シード2回実行のログが一致しない');
  assert.deepEqual(log1.result, log2.result);
});

/* ---------- 6. 装備の特殊効果・コンボと同時に使っても壊れない ---------- */

test('rebirth: 装備の特殊効果(specials)と同時に使っても正常に完走し、決定論も保たれる', () => {
  const build = () => runBattle(
    [unit({
      id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, speed: 120 },
      rebirthMods: { skillPowerPercent: 20, gaugeStart: 50, ultGaugeStart: 30 },
      specials: [{
        id: 'sp_test', name: '試験の刃', description: '', trigger: 'ON_ATTACK',
        chance: 50, status: 'BURN', duration: 2, potency: 4, bonusDamage: 0.3,
      }],
    })],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, speed: 90 } })],
    makeContext({ seed: 7, config: { ...CONFIG, maxTicks: 40 } }),
  );
  const log1 = build();
  const log2 = build();
  assert.equal(log1.events[log1.events.length - 1]!.type, 'BATTLE_END');
  assert.deepEqual(log1.events, log2.events, 'specials併用時も同シードでログが一致しないのは決定論違反');
});

test('rebirth: キャラクターコンボ(combos)と同時に使っても正常に完走し、決定論も保たれる', () => {
  const combo = {
    id: 'combo_test', name: '連携テスト', kind: 'PAIR' as const, description: 'テスト用コンボ',
    members: ['a1', 'a2'],
    trigger: { type: 'ON_SKILL_USE' as const, skill: 'poison_strike' },
    effects: [{ effect: { type: 'DAMAGE' as const, power: 0.5 } }],
  };
  const build = () => runBattle(
    [
      unit({
        id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, speed: 120 },
        rebirthMods: { skillPowerPercent: 25, gaugeStart: 60 },
        skills: ['poison_strike'],
      }),
      unit({
        id: 'a2', slot: 1, side: 'ALLY', stats: { ...baseStats, speed: 80 },
        rebirthMods: { ultGaugeStart: 50 },
      }),
    ],
    [unit({ id: 'e1', slot: 0, side: 'ENEMY', stats: { ...baseStats, speed: 90, hp: 99999 } })],
    makeContext({
      seed: 11, config: { ...CONFIG, maxTicks: 40 },
      combos: new Map([[combo.id, combo]]),
    }),
  );
  const log1 = build();
  const log2 = build();
  assert.equal(log1.events[log1.events.length - 1]!.type, 'BATTLE_END');
  assert.deepEqual(log1.events, log2.events, 'combos併用時も同シードでログが一致しないのは決定論違反');
});

/* ---------- 7. normalize() を使った念のための追加チェック ---------- */

test('rebirth: normalize()経由でも rebirthMods 未指定は完全一致、指定時は差が出る', () => {
  const ctx = makeContext({ seed: 3, config: { ...CONFIG, maxTicks: 20 } });
  const enemy = unit({ id: 'e1', slot: 0, side: 'ENEMY' });
  const plain = runBattle([unit({ id: 'a1', slot: 0 })], [enemy], ctx);
  const plainAgain = runBattle([unit({ id: 'a1', slot: 0 })], [enemy], ctx);
  const boosted = runBattle(
    [unit({ id: 'a1', slot: 0, rebirthMods: { skillPowerPercent: 80 } })], [enemy], ctx,
  );
  assert.equal(normalize(plain), normalize(plainAgain));
  assert.notEqual(normalize(plain), normalize(boosted), 'skillPowerPercent:80 は結果に影響するはず');
});
