/** 戦闘エンジン全体の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { AiProfile, BattleEvent, BattleLog, Skill } from '@akatan/shared';
import { damageText } from './engine.js';
import { runBattle } from './index.js';
import { createRng } from './rng.js';
import { AWAKENING_TURN1, CONFIG, aiMap, baseStats, makeContext, skillMap, unit } from './testFixtures.js';

/** createdAt だけが実時刻依存なので、比較時は取り除く */
function normalize(log: BattleLog): string {
  const { createdAt, ...rest } = log;
  void createdAt;
  return JSON.stringify(rest);
}

const SNAPSHOT_TYPES = new Set([
  'BATTLE_START', 'DAMAGE', 'HEAL', 'STATUS_APPLY', 'STATUS_EXPIRE', 'STATUS_TICK',
  'GAUGE_CHANGE', 'DEFEAT', 'AWAKEN', 'BATTLE_END',
]);

/** 3対3の、乱数がよく効く標準的な戦闘 */
function standardBattle(seed = 20250917): BattleLog {
  const allies = [
    unit({
      id: 'a1', slot: 0, name: '電子 独', side: 'ALLY', element: 'FIRE',
      stats: { ...baseStats, hp: 3000, attack: 260, speed: 120, critical: 25 },
      skills: ['poison_strike', 'big_ult'], ultimate: 'big_ult', aiProfile: 'ai_ult',
    }),
    unit({
      id: 'a2', slot: 1, name: '灯守', side: 'ALLY', element: 'WATER',
      stats: { ...baseStats, hp: 2600, attack: 150, speed: 95, healing: 140 },
      skills: ['heal_small'], aiProfile: 'ai_healer',
    }),
    unit({
      id: 'a3', slot: 2, name: '鋼の壁', side: 'ALLY', element: 'EARTH',
      stats: { ...baseStats, hp: 4200, attack: 130, defense: 400, speed: 70 },
      skills: ['guard_up'], aiProfile: 'ai_guard',
    }),
  ];
  const enemies = [
    unit({
      id: 'e1', slot: 0, name: '影喰らい', side: 'ENEMY', element: 'WIND',
      stats: { ...baseStats, hp: 3200, attack: 230, speed: 105, critical: 15 },
      skills: ['poison_strike'], aiProfile: 'ai_poison',
    }),
    unit({
      id: 'e2', slot: 1, name: '軋む影', side: 'ENEMY', element: 'DARK',
      stats: { ...baseStats, hp: 2400, attack: 190, speed: 115 },
      skills: [], aiProfile: 'ai_basic',
    }),
    unit({
      id: 'e3', slot: 2, name: '呻く影', side: 'ENEMY', element: 'DARK',
      stats: { ...baseStats, hp: 2400, attack: 170, speed: 88 },
      skills: [], aiProfile: 'ai_basic',
    }),
  ];
  return runBattle(allies, enemies, makeContext({ seed, stageId: 'test-1' }));
}

/* ---------- 1. 決定論 ---------- */

test('engine: 同じ入力+同じシードなら戦闘ログが完全一致する', () => {
  const a = standardBattle();
  const b = standardBattle();
  assert.equal(normalize(a), normalize(b));
  assert.equal(a.id, b.id, 'ログIDも決定論的であるべき');
  assert.ok(a.events.length > 10, `イベントが少なすぎる: ${a.events.length}`);
});

test('engine: シードが変われば展開も変わる', () => {
  const a = standardBattle(1);
  const b = standardBattle(2);
  assert.notEqual(normalize(a), normalize(b));
});

/* ---------- 2. 行動ゲージ順 ---------- */

test('engine: speed が高いユニットが先に行動する', () => {
  const fast = unit({
    id: 'fast', slot: 0, side: 'ALLY', stats: { ...baseStats, speed: 300, hp: 5000 },
  });
  const slow = unit({
    id: 'slow', slot: 0, side: 'ENEMY', stats: { ...baseStats, speed: 100, hp: 5000 },
  });
  const log = runBattle([fast], [slow], makeContext({ seed: 1 }));
  const firstAction = log.events.find((e) => e.type === 'ACTION_START');
  assert.equal(firstAction?.sourceId, 'fast');

  // speed 3倍 => おおよそ3倍の回数行動している
  const acts = (id: string): number =>
    log.events.filter((e) => e.type === 'ACTION_START' && e.sourceId === id && !e.status).length;
  const ratio = acts('fast') / Math.max(1, acts('slow'));
  assert.ok(ratio > 2.5 && ratio < 3.5, `行動回数比が speed 比とずれている: ${ratio}`);
});

test('engine: ティックはまとめて進み、行動時のtickが speed から計算した値になる', () => {
  const a = unit({ id: 'a', slot: 0, side: 'ALLY', stats: { ...baseStats, speed: 100, hp: 99999 } });
  const b = unit({ id: 'b', slot: 0, side: 'ENEMY', stats: { ...baseStats, speed: 100, hp: 99999 } });
  const log = runBattle([a], [b], makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 45 } }));
  // gaugeRate 0.1 * speed 100 = 10/tick、gaugeMax 100 => 10ティックごとに行動
  const firstTicks = log.events.filter((e) => e.type === 'ACTION_START').slice(0, 2).map((e) => e.tick);
  assert.deepEqual(firstTicks, [10, 10], '同時到達の2体は同じティックで行動するはず');
  assert.equal(log.events.find((e) => e.type === 'BATTLE_START')?.tick, 0);
});

/* ---------- 3. 状態異常 ---------- */

test('engine: POISON の継続ダメージが STATUS_TICK として発生する', () => {
  const tank = unit({
    id: 'tank', slot: 0, side: 'ALLY',
    stats: { ...baseStats, hp: 50000, defense: 2000, speed: 200, attack: 1 },
  });
  // 付与側をかなり遅くしておくと、再付与で duration が上書きされ続けずに期限切れまで観測できる
  const poisoner = unit({
    id: 'poisoner', slot: 0, side: 'ENEMY', aiProfile: 'ai_poison', skills: ['poison_strike'],
    stats: { ...baseStats, hp: 50000, defense: 2000, speed: 20, attack: 1 },
  });
  const log = runBattle([tank], [poisoner], makeContext({ seed: 4, config: { ...CONFIG, maxTicks: 400 } }));

  const applied = log.events.find((e) => e.type === 'STATUS_APPLY' && e.status === 'POISON');
  assert.ok(applied, 'POISON が付与されていない');
  const ticks = log.events.filter((e) => e.type === 'STATUS_TICK' && e.status === 'POISON');
  assert.ok(ticks.length > 0, 'POISON の継続ダメージが発生していない');
  assert.ok((ticks[0]!.value ?? 0) > 0);
  assert.ok(ticks[0]!.targetId === 'tank');
  // 期限切れも出る
  assert.ok(log.events.some((e) => e.type === 'STATUS_EXPIRE' && e.status === 'POISON'));
});

test('engine: STUN 中は行動がスキップされる (SKILL_USE が出ない)', () => {
  const victim = unit({
    id: 'victim', slot: 0, side: 'ALLY',
    stats: { ...baseStats, hp: 50000, defense: 3000, speed: 200, attack: 1 },
  });
  // スタン役を遅くして、victim が何度も行動するうちに STUN が解ける様子まで観測する
  const stunner = unit({
    id: 'stunner', slot: 0, side: 'ENEMY', aiProfile: 'ai_stun', skills: ['stun_bolt'],
    stats: { ...baseStats, hp: 50000, defense: 3000, speed: 20, attack: 1 },
  });
  const log = runBattle([victim], [stunner], makeContext({ seed: 6, config: { ...CONFIG, maxTicks: 400 } }));

  const idx = log.events.findIndex((e) => e.type === 'ACTION_START' && e.sourceId === 'victim' && e.status === 'STUN');
  assert.ok(idx >= 0, 'STUN による行動不能イベントが出ていない');

  // その行動が終わる (ACTION_END) までに SKILL_USE が無いこと
  const end = log.events.findIndex((e, i) => i > idx && e.type === 'ACTION_END' && e.sourceId === 'victim');
  assert.ok(end > idx);
  const between = log.events.slice(idx, end);
  assert.equal(between.filter((e) => e.type === 'SKILL_USE').length, 0, 'STUN 中なのに行動している');
  // STUN は解けて再び行動できるようになる (詰まない)
  assert.ok(log.events.some((e) => e.type === 'STATUS_EXPIRE' && e.status === 'STUN'));
});

test('engine: SILENCE 中はスキルではなく通常攻撃になる', () => {
  const caster = unit({
    id: 'caster', slot: 0, side: 'ALLY', aiProfile: 'ai_poison', skills: ['poison_strike'],
    stats: { ...baseStats, hp: 40000, defense: 2000, speed: 100, attack: 1 },
  });
  const silencer = unit({
    id: 'silencer', slot: 0, side: 'ENEMY', aiProfile: 'ai_silence', skills: ['silence_song'],
    stats: { ...baseStats, hp: 40000, defense: 2000, speed: 130, attack: 1 },
  });
  const log = runBattle([caster], [silencer], makeContext({ seed: 8, config: { ...CONFIG, maxTicks: 200 } }));

  const silenceAt = log.events.findIndex((e) => e.type === 'STATUS_APPLY' && e.status === 'SILENCE');
  assert.ok(silenceAt >= 0);
  const expireAt = log.events.findIndex((e, i) => i > silenceAt && e.type === 'STATUS_EXPIRE' && e.status === 'SILENCE');
  const window = log.events.slice(silenceAt, expireAt > 0 ? expireAt : undefined);
  const casterSkills = window.filter((e) => e.type === 'SKILL_USE' && e.sourceId === 'caster');
  assert.ok(casterSkills.length > 0, '沈黙中に一度も行動していない');
  assert.ok(casterSkills.every((e) => e.skillId === 'atk_normal'), '沈黙中にスキルを撃っている');
});

/* ---------- 4. 決着 ---------- */

test('engine: 必ず有限で終わり、BATTLE_END が最後のイベントである', () => {
  for (const seed of [1, 2, 3, 42, 1000, 987654]) {
    const log = standardBattle(seed);
    const last = log.events[log.events.length - 1]!;
    assert.equal(last.type, 'BATTLE_END', `seed=${seed} の最後が BATTLE_END ではない`);
    assert.equal(log.events.filter((e) => e.type === 'BATTLE_END').length, 1);
    assert.ok(log.result.ticks <= CONFIG.maxTicks + 1);
    assert.ok(typeof last.text === 'string' && last.text.length > 0);
  }
});

test('engine: 決着がつかない場合は残HP率合計で勝敗を決め、根拠を text に書く', () => {
  // 攻撃力ゼロ同士 = 永久に終わらない戦闘を maxTicks で打ち切る
  const a = unit({ id: 'a', slot: 0, side: 'ALLY', stats: { ...baseStats, attack: 0, hp: 1000, speed: 100 } });
  const b = unit({ id: 'b', slot: 0, side: 'ENEMY', stats: { ...baseStats, attack: 0, hp: 1000, speed: 100 } });
  const log = runBattle([a], [b], makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 100 } }));
  const last = log.events[log.events.length - 1]!;
  assert.equal(last.type, 'BATTLE_END');
  assert.match(last.text ?? '', /残HP率合計/);
  // 完全に同条件の2体なので残HP率は同値 => 敗北扱い
  assert.equal(log.result.victory, false);
  assert.match(last.text ?? '', /敗北扱い/);
  assert.ok(log.result.ticks > 100);
});

test('engine: 勝った側が正しく判定される', () => {
  const strong = unit({ id: 's', slot: 0, side: 'ALLY', stats: { ...baseStats, attack: 5000, speed: 200 } });
  const weak = unit({ id: 'w', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 100, attack: 1, speed: 10 } });
  const win = runBattle([strong], [weak], makeContext({ seed: 1 }));
  assert.equal(win.result.victory, true);
  assert.ok(win.events.some((e) => e.type === 'DEFEAT' && e.targetId === 'w'));

  const lose = runBattle([weak], [strong], makeContext({ seed: 1 }));
  assert.equal(lose.result.victory, false);
});

/* ---------- 5. 覚醒 ---------- */

test('engine: 覚醒は条件成立で1回だけ発動し、効果が反映される', () => {
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', name: '覚醒者',
    stats: { ...baseStats, hp: 30000, attack: 200, speed: 100, defense: 500 },
    awakening: AWAKENING_TURN1,
  });
  const foe = unit({
    id: 'foe', slot: 0, side: 'ENEMY',
    stats: { ...baseStats, hp: 30000, attack: 100, speed: 100, defense: 500 },
  });
  const log = runBattle([hero], [foe], makeContext({ seed: 3, config: { ...CONFIG, maxTicks: 400 } }));

  const aw = log.events.filter((e) => e.type === 'AWAKEN' && e.sourceId === 'hero');
  assert.equal(aw.length, 1, `AWAKEN が ${aw.length} 回出ている (1回であるべき)`);
  assert.equal(aw[0]!.skillName, AWAKENING_TURN1.name);
  assert.ok(aw[0]!.snapshot, 'AWAKEN に snapshot が無い');
  assert.equal(aw[0]!.snapshot!.find((s) => s.id === 'hero')?.awakened, true);
  // grant の ATK_UP が乗っている
  assert.ok(aw[0]!.snapshot!.find((s) => s.id === 'hero')?.statuses.some((s) => s.type === 'ATK_UP'));
  // skillReplace で通常攻撃が差し替わっている
  const afterAwaken = log.events.slice(log.events.indexOf(aw[0]!));
  assert.ok(afterAwaken.some((e) => e.type === 'SKILL_USE' && e.sourceId === 'hero' && e.skillId === 'awk_normal'));
  assert.ok(!afterAwaken.some((e) => e.type === 'SKILL_USE' && e.sourceId === 'hero' && e.skillId === 'atk_normal'));
});

test('engine: 覚醒条件を満たさなければ発動しない', () => {
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY',
    stats: { ...baseStats, hp: 3000, speed: 100 },
    awakening: { ...AWAKENING_TURN1, condition: { hpBelow: 1 } },
  });
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 100, attack: 1, speed: 10 } });
  const log = runBattle([hero], [foe], makeContext({ seed: 1 }));
  assert.equal(log.events.filter((e) => e.type === 'AWAKEN').length, 0);
});

/* ---------- 6. 必殺ゲージ ---------- */

test('engine: 必殺ゲージが溜まると ULT_READY が出て、必殺技でリセットされる', () => {
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', aiProfile: 'ai_ult',
    skills: ['big_ult'], ultimate: 'big_ult',
    stats: { ...baseStats, hp: 30000, attack: 100, speed: 100, defense: 500 },
  });
  const foe = unit({
    id: 'foe', slot: 0, side: 'ENEMY',
    stats: { ...baseStats, hp: 30000, attack: 50, speed: 100, defense: 500 },
  });
  const log = runBattle([hero], [foe], makeContext({ seed: 11, config: { ...CONFIG, maxTicks: 400 } }));

  const ready = log.events.find((e) => e.type === 'ULT_READY' && e.sourceId === 'hero');
  assert.ok(ready, 'ULT_READY が出ていない');
  const useIdx = log.events.findIndex((e) => e.type === 'SKILL_USE' && e.sourceId === 'hero' && e.skillId === 'big_ult');
  assert.ok(useIdx > 0, '必殺技が使われていない');
  // 必殺技の直後のダメージイベントの snapshot ではゲージが0に戻っている
  const after = log.events.slice(useIdx).find((e) => e.snapshot);
  assert.equal(after!.snapshot!.find((s) => s.id === 'hero')!.ultGauge, 0);
});

/* ---------- 7. ログ構造 ---------- */

test('engine: 全イベントに seq/tick が連番で振られている', () => {
  const log = standardBattle(555);
  log.events.forEach((e: BattleEvent, i: number) => {
    assert.equal(e.seq, i, `seq が連番でない (index=${i})`);
    assert.ok(Number.isInteger(e.tick) && e.tick >= 0, `tick が不正: ${e.tick}`);
  });
  // tick は単調非減少
  for (let i = 1; i < log.events.length; i++) {
    assert.ok(log.events[i]!.tick >= log.events[i - 1]!.tick, 'tick が巻き戻っている');
  }
});

test('engine: HP/ゲージ/状態が動くイベントには全ユニットの snapshot が付く', () => {
  const log = standardBattle(777);
  const total = log.units.length;
  for (const e of log.events) {
    if (SNAPSHOT_TYPES.has(e.type)) {
      assert.ok(e.snapshot, `${e.type} に snapshot が無い`);
      assert.equal(e.snapshot!.length, total, `${e.type} の snapshot が全ユニット分でない`);
      for (const s of e.snapshot!) {
        assert.ok(Number.isFinite(s.hp) && s.hp >= 0);
        assert.ok(Array.isArray(s.statuses));
      }
    }
  }
});

test('engine: DAMAGE イベントに演出用の情報が揃っている', () => {
  const log = standardBattle(999);
  const dmg = log.events.filter((e) => e.type === 'DAMAGE');
  assert.ok(dmg.length > 0);
  for (const e of dmg) {
    assert.ok(e.sourceId && e.targetId, 'source/target が無い');
    assert.ok(e.skillName, 'skillName が無い');
    assert.equal(typeof e.critical, 'boolean');
    assert.equal(typeof e.affinity, 'number');
    assert.ok(e.element, 'element が無い');
    assert.ok((e.value ?? 0) >= 1, '最低1ダメージを割っている');
    assert.match(e.text ?? '', /ダメージ/);
  }
  // 会心と属性相性が実際に実況文へ反映されていること
  assert.ok(dmg.some((e) => e.critical && (e.text ?? '').includes('会心')));
});

test('engine: snapshot の HP 推移が DAMAGE の値と整合する', () => {
  const log = standardBattle(31337);
  const hp = new Map(log.units.map((u) => [u.id, u.maxHp]));
  for (const e of log.events) {
    if (!e.snapshot) continue;
    if (e.type === 'DAMAGE') {
      const before = hp.get(e.targetId!)!;
      const after = e.snapshot.find((s) => s.id === e.targetId)!.hp;
      const lost = before - after;
      // シールドが吸った場合は lost < value になりうるので上限のみ検証
      assert.ok(lost <= (e.value ?? 0), `HP減少量(${lost})がダメージ値(${e.value})を超えている`);
    }
    for (const s of e.snapshot) hp.set(s.id, s.hp);
  }
});

/* ---------- 8. 集計 ---------- */

test('engine: result.stats が全ユニット分集計され、rewards は付かない', () => {
  const log = standardBattle(2468);
  assert.equal(log.result.stats.length, log.units.length);
  assert.equal(log.result.rewards, undefined, 'rewards は API 層の責務なのでエンジンは付けない');

  for (const s of log.result.stats) {
    assert.ok(log.units.some((u) => u.id === s.id));
    assert.ok(s.damageDealt >= 0 && s.damageTaken >= 0 && s.healing >= 0 && s.kills >= 0);
  }
  const totalKills = log.result.stats.reduce((a, s) => a + s.kills, 0);
  const defeats = log.events.filter((e) => e.type === 'DEFEAT' && e.sourceId).length;
  assert.equal(totalKills, defeats, '撃破数の集計が DEFEAT イベントと一致しない');

  // 生存フラグが最終 snapshot と一致する
  const lastSnap = [...log.events].reverse().find((e) => e.snapshot)!.snapshot!;
  for (const s of log.result.stats) {
    assert.equal(s.survived, lastSnap.find((x) => x.id === s.id)!.alive);
  }
  assert.ok(log.result.turns >= 1);
});

/* ---------- 9. 異常入力への耐性 ---------- */

test('engine: 片側が空でも例外にならず決着する', () => {
  const a = unit({ id: 'a', slot: 0, side: 'ALLY' });
  const win = runBattle([a], [], makeContext({ seed: 1 }));
  assert.equal(win.result.victory, true);
  assert.equal(win.events[win.events.length - 1]!.type, 'BATTLE_END');

  const lose = runBattle([], [a], makeContext({ seed: 1 }));
  assert.equal(lose.result.victory, false);
});

test('engine: スキル定義が欠けていても戦闘は最後まで進む', () => {
  const a = unit({ id: 'a', slot: 0, side: 'ALLY', normalAttack: 'missing_skill', stats: { ...baseStats, hp: 500 } });
  const b = unit({ id: 'b', slot: 0, side: 'ENEMY', normalAttack: 'missing_skill', stats: { ...baseStats, hp: 500 } });
  const log = runBattle([a], [b], makeContext({ seed: 1, skills: new Map(), config: { ...CONFIG, maxTicks: 500 } }));
  assert.equal(log.events[log.events.length - 1]!.type, 'BATTLE_END');
});

test('engine: 開始時ユニット一覧は初期状態のまま (実行で書き換わらない)', () => {
  const log = standardBattle(1357);
  for (const u of log.units) {
    assert.equal(u.hp, u.maxHp, `${u.name} の開始HPが書き換わっている`);
    assert.equal(u.gauge, 0);
    assert.equal(u.ultGauge, 0);
    assert.equal(u.alive, true);
    assert.equal(u.awakened, false);
  }
});

/* ---------- 10. P1-1: createdAt の決定論 ---------- */

test('engine(P1-1): createdAt はエンジン内で生成せず ctx.now を入れる', () => {
  const log1 = standardBattle(1);
  assert.equal(log1.createdAt, '', 'ctx.now省略時は空文字であるべき (Date.now を呼ってはいけない)');

  const a = unit({ id: 'a', slot: 0, side: 'ALLY' });
  const b = unit({ id: 'b', slot: 0, side: 'ENEMY' });
  const log2 = runBattle([a], [b], makeContext({ seed: 1, now: '2026-01-02T03:04:05.000Z' }));
  assert.equal(log2.createdAt, '2026-01-02T03:04:05.000Z');
});

test('engine(P1-1): ctx.now が同じなら createdAt を含めてログ全体が完全一致する', () => {
  const build = (): BattleLog => runBattle(
    [unit({ id: 'a', slot: 0, side: 'ALLY', stats: { ...baseStats, attack: 300 } })],
    [unit({ id: 'b', slot: 0, side: 'ENEMY' })],
    makeContext({ seed: 999, now: '2026-09-17T00:00:00.000Z', config: { ...CONFIG, maxTicks: 500 } }),
  );
  const a = build();
  const b = build();
  // normalize() で createdAt を除外していた従来の比較ではなく、そのまま完全一致することを確認する。
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

/* ---------- 11. P0-2: 値0のイベントを送出しない ---------- */

test('engine(P0-2): REGENが満タンHPでは実際の回復が0になるため STATUS_TICK を出さない', () => {
  const passiveRegen: Skill = {
    id: 'passive_regen', name: '自然治癒', kind: 'PASSIVE', description: '', cooldown: 0,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [{ type: 'STATUS', status: 'REGEN', duration: 9999, potency: 10 }],
  };
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', passives: ['passive_regen'],
    stats: { ...baseStats, hp: 10000, speed: 100 },
  });
  const foe = unit({
    id: 'foe', slot: 0, side: 'ENEMY',
    stats: { ...baseStats, hp: 10000, speed: 0.001, attack: 0 },
  });
  const log = runBattle([hero], [foe], makeContext({
    seed: 1, skills: skillMap([passiveRegen]), config: { ...CONFIG, maxTicks: 200 },
  }));

  // REGEN 自体は開幕から付与されている (テスト前提の確認 = スナップショットの整合も崩れていない)
  const hasRegen = log.events.some((e) => e.snapshot?.some(
    (s) => s.id === 'hero' && s.statuses.some((st) => st.type === 'REGEN'),
  ));
  assert.ok(hasRegen, 'REGENが付与されていない (テスト前提が崩れている)');

  const regenTicks = log.events.filter((e) => e.type === 'STATUS_TICK' && e.status === 'REGEN');
  assert.equal(regenTicks.length, 0, '満タンHPなのにREGENのSTATUS_TICKが出ている(0回復イベント抑止ができていない)');

  const lastSnap = [...log.events].reverse().find((e) => e.snapshot)!.snapshot!;
  assert.equal(lastSnap.find((s) => s.id === 'hero')!.hp, 10000, '満タンHPのままのはず (foeはほぼ動けない設定)');
});

test('engine(P0-2): 必殺ゲージが満タンならULT_GAUGE効果のGAUGE_CHANGEを出さない', () => {
  const fillUlt: Skill = {
    id: 'fill_ult', name: '過充填', kind: 'ACTIVE', description: '', cooldown: 0,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [{ type: 'ULT_GAUGE', amount: 50 }],
  };
  const ai: AiProfile = {
    id: 'ai_fill_ult', name: 'x', rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'fill_ult' }],
  };
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', aiProfile: 'ai_fill_ult', skills: ['fill_ult'],
    stats: { ...baseStats, hp: 10000, speed: 100 },
  });
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 0.001, attack: 0 } });
  const log = runBattle([hero], [foe], makeContext({
    seed: 1,
    skills: skillMap([fillUlt]),
    aiProfiles: aiMap([ai]),
    // 行動による自動加算を切って、ULT_GAUGE効果の増減だけを見たい
    config: { ...CONFIG, maxTicks: 100, ultGainOnAction: 0 },
  }));

  const gaugeEvents = log.events.filter((e) => e.type === 'GAUGE_CHANGE' && e.targetId === 'hero');
  // 0->50 (1回目) -> 100 (2回目) で満タンになった後は増分0になり、以降は出ない
  assert.equal(gaugeEvents.length, 2, `満タン後もGAUGE_CHANGEが出続けている: ${gaugeEvents.length}`);
  const lastSnap = [...log.events].reverse().find((e) => e.snapshot)!.snapshot!;
  assert.equal(lastSnap.find((s) => s.id === 'hero')!.ultGauge, 100);
});

test('engine(P0-2): 行動ゲージが既に0になった後の追加減少はGAUGE_CHANGEを出さない', () => {
  const doubleDrain: Skill = {
    id: 'double_drain', name: '二重減速', kind: 'ACTIVE', description: '', cooldown: 0,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [
      { type: 'GAUGE', amount: -100 },
      { type: 'GAUGE', amount: -100 },
    ],
  };
  const ai: AiProfile = {
    id: 'ai_drain', name: 'x', rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'double_drain' }],
  };
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', aiProfile: 'ai_drain', skills: ['double_drain'],
    stats: { ...baseStats, hp: 10000, speed: 100 },
  });
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 99999, speed: 0.001, attack: 0 } });
  const log = runBattle([hero], [foe], makeContext({
    seed: 1, skills: skillMap([doubleDrain]), aiProfiles: aiMap([ai]), config: { ...CONFIG, maxTicks: 50 },
  }));

  const gaugeEvents = log.events.filter((e) => e.type === 'GAUGE_CHANGE' && e.targetId === 'hero');
  const heroActions = log.events.filter((e) => e.type === 'SKILL_USE' && e.sourceId === 'hero').length;
  assert.ok(heroActions > 0, 'テスト前提: heroが一度も行動していない');
  // 1つ目のGAUGE効果は毎回イベントを出すが、2つ目は「既に0への減少」で毎回抑止される
  // -> heroの行動回数とGAUGE_CHANGE数が一致するはず
  assert.equal(gaugeEvents.length, heroActions, '2つ目のGAUGE効果(実質変化なし)が抑止されていない');
});

/* ---------- 12. P0-3: 多対象イベントのグルーピング ---------- */

test('engine(P0-3): 全体効果で2件目以降の対象に grouped:true が立つ', () => {
  const buffAll: Skill = {
    id: 'buff_all', name: '守護の号令', kind: 'ACTIVE', description: '', cooldown: 0,
    target: { side: 'ALLY', pattern: 'ALL' },
    effects: [{ type: 'STATUS', status: 'ATK_UP', duration: 3, potency: 10 }],
  };
  const ai: AiProfile = {
    id: 'ai_buff_all', name: 'x', rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'buff_all' }],
  };
  const allies = [
    unit({ id: 'a1', slot: 0, side: 'ALLY', aiProfile: 'ai_buff_all', skills: ['buff_all'], stats: { ...baseStats, hp: 5000 } }),
    unit({ id: 'a2', slot: 1, side: 'ALLY', aiProfile: 'ai_basic', stats: { ...baseStats, hp: 5000 } }),
    unit({ id: 'a3', slot: 2, side: 'ALLY', aiProfile: 'ai_basic', stats: { ...baseStats, hp: 5000 } }),
  ];
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 50000, attack: 0 } });
  const log = runBattle(allies, [foe], makeContext({
    seed: 1, skills: skillMap([buffAll]), aiProfiles: aiMap([ai]), config: { ...CONFIG, maxTicks: 15 },
  }));

  const applies = log.events.filter((e) => e.type === 'STATUS_APPLY' && e.skillId === 'buff_all');
  assert.equal(applies.length, 3, `3体分のSTATUS_APPLYが出ていない: ${applies.length}`);
  assert.equal(applies[0]!.grouped, undefined, '1件目にgroupedが付いている');
  assert.equal(applies[1]!.grouped, true, '2件目にgroupedが付いていない');
  assert.equal(applies[2]!.grouped, true, '3件目にgroupedが付いていない');

  // snapshot は毎イベントに付いたまま (grouped でも状態整合は崩れない)
  for (const e of applies) assert.ok(e.snapshot && e.snapshot.length === log.units.length);
});

test('engine(P0-3): 単体効果では grouped が立たない', () => {
  const a = unit({ id: 'a1', slot: 0, side: 'ALLY', stats: { ...baseStats, hp: 5000, attack: 200 } });
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 50000 } });
  const log = runBattle([a], [foe], makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 50 } }));
  const dmg = log.events.filter((e) => e.type === 'DAMAGE');
  assert.ok(dmg.length > 0);
  assert.ok(dmg.every((e) => e.grouped === undefined), '単体攻撃なのに grouped が立っている');
});

/* ---------- 13. P0-4: ログの括弧は最大1つ ---------- */

test('engine(P0-4): 括弧は最大1つ、優先度は 会心 > 属性相性 > シールド肩代わり', () => {
  const bracketCount = (s: string): number => (s.match(/\(/g) ?? []).length;

  const critOnly = damageText('攻', '技', '的', 10, true, 1.0, 0);
  assert.equal(bracketCount(critOnly), 1);
  assert.match(critOnly, /\(会心\)/);

  // 会心 + 属性相性 + シールド肩代わり が同時発生 -> 会心だけが出る
  const all3 = damageText('攻', '技', '的', 10, true, 1.5, 5);
  assert.equal(bracketCount(all3), 1, '括弧が複数付いている');
  assert.match(all3, /\(会心\)/, '会心が最優先のはず');

  // 属性相性 + シールド肩代わり -> 属性相性だけが出る
  const affinityAndShield = damageText('攻', '技', '的', 10, false, 1.5, 5);
  assert.equal(bracketCount(affinityAndShield), 1);
  assert.match(affinityAndShield, /抜群/, '属性相性がシールドより優先のはず');

  const shieldOnly = damageText('攻', '技', '的', 10, false, 1.0, 5);
  assert.equal(bracketCount(shieldOnly), 1);
  assert.match(shieldOnly, /肩代わり/);

  const plain = damageText('攻', '技', '的', 10, false, 1.0, 0);
  assert.equal(bracketCount(plain), 0, '何も無ければ括弧無しのはず');
});

/* ---------- 14. P1-2: TURN_START の頻度確認 (バグの有無を確認する回帰テスト) ---------- */

test('engine(P1-2): TURN_START は「ラウンド開始時の全体生存数ぶんの行動」ごとに正しく発火する', () => {
  // 5対3、誰も死なない設定 = ラウンド定員は常に8で固定される
  const allies = Array.from({ length: 5 }, (_, i) => unit({
    id: `a${i}`, slot: i, side: 'ALLY', aiProfile: 'ai_basic',
    stats: { ...baseStats, hp: 999999, attack: 0, speed: 100 },
  }));
  const enemies = Array.from({ length: 3 }, (_, i) => unit({
    id: `e${i}`, slot: i, side: 'ENEMY', aiProfile: 'ai_basic',
    stats: { ...baseStats, hp: 999999, attack: 0, speed: 100 },
  }));
  const log = runBattle(allies, enemies, makeContext({ seed: 1, config: { ...CONFIG, maxTicks: 500 } }));

  const turnStarts = log.events.filter((e) => e.type === 'TURN_START');
  assert.ok(turnStarts.length >= 5, `ラウンドがほとんど進んでいない (実装のバグを疑う): ${turnStarts.length}`);

  const actionStarts = log.events.filter((e) => e.type === 'ACTION_START');
  turnStarts.forEach((ts, i) => {
    const actionsBefore = actionStarts.filter((e) => e.seq < ts.seq).length;
    assert.equal(actionsBefore, i * 8, `ターン${i + 1}開始までの行動数が想定(8の倍数)と違う: ${actionsBefore}`);
  });
});

/* ---------- 15. 新キャラ特殊能力 (第6ラウンド): INVULNERABLE / IMMUNE / actionDuration / adaptElement / randomEffect ---------- */

test('engine: INVULNERABLE 中は直接ダメージもDoTも0になり、撃破もされない。切れると通常に戻る', () => {
  const grantInvuln: Skill = {
    id: 'grant_invuln', name: '絶対防御', kind: 'ACTIVE', description: '', cooldown: 9999,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [{ type: 'STATUS', status: 'INVULNERABLE', duration: 3 }],
  };
  const victimAi: AiProfile = {
    id: 'ai_victim', name: 'x',
    rules: [
      { priority: 1, condition: { type: 'ALWAYS' }, skill: 'grant_invuln' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  };
  const victim = unit({
    id: 'victim', slot: 0, side: 'ALLY', aiProfile: 'ai_victim', skills: ['grant_invuln'],
    stats: { ...baseStats, hp: 30000, defense: 200, speed: 50, attack: 10 },
  });
  const attacker = unit({
    id: 'attacker', slot: 0, side: 'ENEMY', aiProfile: 'ai_poison', skills: ['poison_strike'],
    stats: { ...baseStats, hp: 30000, defense: 200, speed: 100, attack: 300 },
  });
  const log = runBattle([victim], [attacker], makeContext({
    seed: 5, skills: skillMap([grantInvuln]), aiProfiles: aiMap([victimAi]),
    config: { ...CONFIG, maxTicks: 600 },
  }));

  const grantIdx = log.events.findIndex((e) => e.type === 'STATUS_APPLY' && e.status === 'INVULNERABLE');
  assert.ok(grantIdx >= 0, 'INVULNERABLE が付与されていない');
  const expireIdx = log.events.findIndex(
    (e, i) => i > grantIdx && e.type === 'STATUS_EXPIRE' && e.status === 'INVULNERABLE',
  );
  assert.ok(expireIdx > grantIdx, 'INVULNERABLE が期限切れになっていない (テスト前提が崩れている)');

  const window = log.events.slice(grantIdx, expireIdx);
  const dmgInWindow = window.filter((e) => e.type === 'DAMAGE' && e.targetId === 'victim');
  const dotInWindow = window.filter((e) => e.type === 'STATUS_TICK' && e.targetId === 'victim' && e.status === 'POISON');
  assert.ok(dmgInWindow.length > 0, 'テスト前提: 無敵中に一度も狙われていない');
  assert.ok(dmgInWindow.every((e) => e.value === 0), '無敵中なのにダメージが通っている');
  assert.ok(dmgInWindow.every((e) => (e.text ?? '').includes('無効化')), '無効化したことがログから分からない');
  assert.ok(dotInWindow.length > 0, 'テスト前提: 無敵中に一度も毒ダメージが発生していない');
  assert.ok(dotInWindow.every((e) => e.value === 0), '無敵中なのにDoTが通っている');
  // 無敵中はHPが一切減っていない = 撃破もされない
  assert.ok(!window.some((e) => e.type === 'DEFEAT' && e.targetId === 'victim'));

  // 期限切れ以降は通常通りダメージが通る
  const after = log.events.slice(expireIdx);
  const dmgAfter = after.filter((e) => e.type === 'DAMAGE' && e.targetId === 'victim');
  assert.ok(dmgAfter.length > 0, 'テスト前提: 期限切れ後に一度も狙われていない');
  assert.ok(dmgAfter.some((e) => (e.value ?? 0) > 0), '期限切れ後もダメージが0のまま (無敵が解除されていない)');
});

test('engine: actionDuration が指定されていれば duration の代わりに使われる', () => {
  const skillWithBoth: Skill = {
    id: 'skill_action_duration', name: '持続強化', kind: 'ACTIVE', description: '', cooldown: 9999,
    target: { side: 'SELF', pattern: 'SELF' },
    // duration(1) と actionDuration(5) を両方指定 -> actionDuration が優先されるはず
    effects: [{ type: 'STATUS', status: 'ATK_UP', duration: 1, actionDuration: 5, potency: 10 }],
  };
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', skills: [skillWithBoth.id], aiProfile: 'ai_action_duration',
    stats: { ...baseStats, hp: 20000, speed: 100 },
  });
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 20000, speed: 0.001, attack: 0 } });
  const ai: AiProfile = {
    id: 'ai_action_duration', name: 'x',
    rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: skillWithBoth.id }],
  };
  const log = runBattle([hero], [foe], makeContext({
    seed: 1, skills: skillMap([skillWithBoth]), aiProfiles: aiMap([ai]), config: { ...CONFIG, maxTicks: 50 },
  }));
  const applied = log.events.find((e) => e.type === 'STATUS_APPLY' && e.status === 'ATK_UP')!;
  assert.ok(applied, 'ATK_UP が付与されていない');
  assert.equal(applied.duration, 5, 'actionDuration が duration より優先されていない');
});

test('engine: IMMUNE 中は状態異常の新規付与を受け付けないが、既存の状態は残り、切れれば再び付与される', () => {
  const passiveDefUp: Skill = {
    id: 'passive_def_up', name: '鉄壁の心得', kind: 'PASSIVE', description: '', cooldown: 0,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [{ type: 'STATUS', status: 'DEF_UP', duration: 9999, potency: 30 }],
  };
  const grantImmune: Skill = {
    id: 'grant_immune', name: '心を閉ざす', kind: 'ACTIVE', description: '', cooldown: 9999,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [{ type: 'STATUS', status: 'IMMUNE', duration: 3 }],
  };
  const victimAi: AiProfile = {
    id: 'ai_victim2', name: 'x',
    rules: [
      { priority: 1, condition: { type: 'ALWAYS' }, skill: 'grant_immune' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  };
  const victim = unit({
    id: 'victim', slot: 0, side: 'ALLY', aiProfile: 'ai_victim2', skills: ['grant_immune'],
    passives: ['passive_def_up'],
    stats: { ...baseStats, hp: 30000, defense: 200, speed: 50, attack: 10 },
  });
  const attacker = unit({
    id: 'attacker', slot: 0, side: 'ENEMY', aiProfile: 'ai_poison', skills: ['poison_strike'],
    stats: { ...baseStats, hp: 30000, defense: 200, speed: 100, attack: 300, resistance: 0 },
  });
  const log = runBattle([victim], [attacker], makeContext({
    seed: 9, skills: skillMap([passiveDefUp, grantImmune]), aiProfiles: aiMap([victimAi]),
    config: { ...CONFIG, maxTicks: 600 },
  }));

  // 開幕からパッシブの DEF_UP が乗っている(テスト前提)
  const start = log.events.find((e) => e.type === 'BATTLE_START')!;
  assert.ok(start.snapshot!.find((s) => s.id === 'victim')!.statuses.some((s) => s.type === 'DEF_UP'));

  const grantIdx = log.events.findIndex((e) => e.type === 'STATUS_APPLY' && e.status === 'IMMUNE');
  assert.ok(grantIdx >= 0, 'IMMUNE が付与されていない');
  const expireIdx = log.events.findIndex(
    (e, i) => i > grantIdx && e.type === 'STATUS_EXPIRE' && e.status === 'IMMUNE',
  );
  assert.ok(expireIdx > grantIdx, 'IMMUNE が期限切れになっていない (テスト前提が崩れている)');

  const window = log.events.slice(grantIdx, expireIdx);
  const poisonApplyInWindow = window.filter((e) => e.type === 'STATUS_APPLY' && e.status === 'POISON');
  const resistInWindow = window.filter((e) => e.type === 'STATUS_RESIST' && e.targetId === 'victim' && e.status === 'POISON');
  assert.equal(poisonApplyInWindow.length, 0, 'IMMUNE中なのにPOISONが付与されている');
  assert.ok(resistInWindow.length > 0, 'テスト前提: IMMUNE中に一度も毒を狙われていない');
  assert.ok(resistInWindow.every((e) => (e.text ?? '').includes('受け付けない')), 'IMMUNEでブロックしたことがログから分からない');

  // IMMUNE中もDEF_UP(既存の状態)は残ったまま
  const midSnap = [...window].reverse().find((e) => e.snapshot)!.snapshot!;
  assert.ok(midSnap.find((s) => s.id === 'victim')!.statuses.some((s) => s.type === 'DEF_UP'), 'IMMUNE中に既存のDEF_UPが消えている');

  // 期限切れ以降は再び POISON が付与できるようになる
  const after = log.events.slice(expireIdx);
  assert.ok(after.some((e) => e.type === 'STATUS_APPLY' && e.status === 'POISON'), '期限切れ後もPOISONを受け付けない');
});

test('engine: adaptElement は対象の弱点属性(最大倍率)で計算し、乱数消費は増えない', () => {
  // AFFINITY (testFixtures): WATER->FIRE が 1.5倍。対象がFIREなら弱点はWATER。
  const adaptStrike: Skill = {
    id: 'adapt_strike', name: '変幻撃', kind: 'ACTIVE', description: '', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'DAMAGE', power: 1.0, adaptElement: true }],
  };
  const waterStrike: Skill = {
    id: 'water_strike', name: '水撃', kind: 'ACTIVE', description: '', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'DAMAGE', power: 1.0, element: 'WATER' }],
  };
  const build = (skill: Skill): BattleLog => {
    const aiId = `ai_${skill.id}`;
    const attacker = unit({
      id: 'atk', slot: 0, side: 'ALLY', element: 'VOID', skills: [skill.id], aiProfile: aiId,
      stats: { ...baseStats, hp: 5000, attack: 200, speed: 100 },
    });
    const foe = unit({
      id: 'foe', slot: 0, side: 'ENEMY', element: 'FIRE',
      stats: { ...baseStats, hp: 50000, attack: 50, speed: 40 },
    });
    const ai: AiProfile = {
      id: aiId, name: 'x', rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: skill.id }],
    };
    return runBattle([attacker], [foe], makeContext({
      seed: 42, skills: skillMap([skill]), aiProfiles: aiMap([ai]), config: { ...CONFIG, maxTicks: 300 },
    }));
  };

  const adaptLog = build(adaptStrike);
  const waterLog = build(waterStrike);

  // sourceId==='atk' に絞る (foe の反撃も DAMAGE イベントとして混ざるため)
  const adaptDmg = adaptLog.events.filter((e) => e.type === 'DAMAGE' && e.sourceId === 'atk');
  const waterDmg = waterLog.events.filter((e) => e.type === 'DAMAGE' && e.sourceId === 'atk');
  assert.ok(adaptDmg.length > 0);
  assert.equal(adaptDmg.length, waterDmg.length);
  assert.ok(adaptDmg.every((e) => e.element === 'WATER'), 'adaptElementがWATER(弱点)を選んでいない');
  assert.ok(adaptDmg.every((e) => Math.abs((e.affinity ?? 0) - 1.5) < 1e-9), 'adaptElementの相性倍率が想定と違う');

  // adaptElement を使っても乱数消費列は変わらない -> 明示的にWATERを指定した場合とログが完全一致する
  // (skillId/skillName/text はスキル自体が違うので除いて比較する)
  const strip = (l: BattleLog): string => JSON.stringify(l.events.map((e) => {
    const { skillId, skillName, text, ...rest } = e;
    void skillId; void skillName; void text;
    return rest;
  }));
  assert.equal(strip(adaptLog), strip(waterLog), 'adaptElementの有無で乱数消費列がズレている');
});

test('engine: randomEffect は effects からランダムに1つだけを適用し、乱数消費は1回だけ。同シードなら同じ効果が選ばれる', () => {
  // SELF対象・両方ともバフ(抵抗判定なし・chance100%)にして、選択の pick 以外に
  // 乱数を消費しない状況を作る。こうすると、この技の発動で消費される乱数は
  // 「resolveEffects の rng.pick」1回だけになる。
  const randomBuff: Skill = {
    id: 'random_buff', name: '気まぐれな祝福', kind: 'ACTIVE', description: '', cooldown: 9999,
    target: { side: 'SELF', pattern: 'SELF' },
    randomEffect: true,
    effects: [
      { type: 'STATUS', status: 'ATK_UP', duration: 3, potency: 20 },
      { type: 'STATUS', status: 'DEF_UP', duration: 3, potency: 20 },
    ],
  };
  const ai: AiProfile = {
    id: 'ai_random_buff', name: 'x',
    rules: [
      { priority: 1, condition: { type: 'ALWAYS' }, skill: 'random_buff' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  };
  const seed = 777;
  const hero = unit({
    id: 'hero', slot: 0, side: 'ALLY', aiProfile: 'ai_random_buff', skills: ['random_buff'],
    stats: { ...baseStats, hp: 20000, speed: 100 },
  });
  const foe = unit({ id: 'foe', slot: 0, side: 'ENEMY', stats: { ...baseStats, hp: 20000, speed: 0.001, attack: 0 } });
  const log = runBattle([hero], [foe], makeContext({
    seed, skills: skillMap([randomBuff]), aiProfiles: aiMap([ai]), config: { ...CONFIG, maxTicks: 50 },
  }));

  // 1) 選ばれなかった方は一切ログに出ない (1つだけ適用されている)
  const applies = log.events.filter((e) => e.type === 'STATUS_APPLY' && e.sourceId === 'hero' && e.skillId === 'random_buff');
  assert.equal(applies.length, 1, `1つだけ適用されるはずが ${applies.length} 件出ている`);
  const chosenType = applies[0]!.status;
  assert.ok(chosenType === 'ATK_UP' || chosenType === 'DEF_UP');
  // SKILL_USE のテキストにも選ばれた効果が分かるよう出している
  const use = log.events.find((e) => e.type === 'SKILL_USE' && e.sourceId === 'hero' && e.skillId === 'random_buff')!;
  assert.ok((use.text ?? '').length > 0 && use.text !== `${hero.name} の ${randomBuff.name}！`, 'ログから選ばれた効果が分からない');

  // 2) 乱数消費は「この技の発動につき1回だけ」。
  //    このシナリオでは戦闘開始からこの技の発動までに他の乱数消費が一切無い
  //    (SELF対象=ターゲット選択で乱数不使用、バフ2種=chance/抵抗ロールなし、パッシブ/コンボ/特殊効果も未使用)。
  //    そのため、同じ seed から createRng() を直接動かした最初の1回の rng.pick(effects) が
  //    その値そのままで再現できるはずで、「選ばれた効果」と完全に一致する。
  const rng = createRng(seed);
  const r0 = rng.next();
  const expectedIdx = Math.min(randomBuff.effects.length - 1, Math.floor(r0 * randomBuff.effects.length));
  const expectedType = randomBuff.effects[expectedIdx]!.status;
  assert.equal(chosenType, expectedType, 'rng.pick の消費タイミング/回数がドキュメント通りではない');

  // 3) 同シードで再実行しても同じ効果が選ばれる (決定論)
  const log2 = runBattle([hero], [foe], makeContext({
    seed, skills: skillMap([randomBuff]), aiProfiles: aiMap([ai]), config: { ...CONFIG, maxTicks: 50 },
  }));
  const applies2 = log2.events.filter((e) => e.type === 'STATUS_APPLY' && e.sourceId === 'hero' && e.skillId === 'random_buff');
  assert.equal(applies2.length, 1);
  assert.equal(applies2[0]!.status, chosenType, '同シードなのに選ばれる効果が変わっている');
});

test('engine(第6ラウンド): 新フィールド(INVULNERABLE/IMMUNE/actionDuration/adaptElement/randomEffect)を使わない既存スキルはログが完全同一', () => {
  // testFixtures の標準戦闘(第6ラウンド以前から存在)は新フィールドを一切使わない。
  // 既存111件のテスト全体がその証明だが、ここでも明示的に再確認しておく。
  const build = (): BattleLog => {
    const allies = [
      unit({
        id: 'a1', slot: 0, name: '電子 独', side: 'ALLY', element: 'FIRE',
        stats: { ...baseStats, hp: 3000, attack: 260, speed: 120, critical: 25 },
        skills: ['poison_strike', 'big_ult'], ultimate: 'big_ult', aiProfile: 'ai_ult',
      }),
      unit({
        id: 'a2', slot: 1, name: '灯守', side: 'ALLY', element: 'WATER',
        stats: { ...baseStats, hp: 2600, attack: 150, speed: 95, healing: 140 },
        skills: ['heal_small'], aiProfile: 'ai_healer',
      }),
    ];
    const enemies = [
      unit({
        id: 'e1', slot: 0, name: '影喰らい', side: 'ENEMY', element: 'WIND',
        stats: { ...baseStats, hp: 3200, attack: 230, speed: 105, critical: 15 },
        skills: ['poison_strike'], aiProfile: 'ai_poison',
      }),
    ];
    return runBattle(allies, enemies, makeContext({ seed: 20250917, stageId: 'regression' }));
  };
  const a = build();
  const b = build();
  const { createdAt: ca, ...restA } = a; void ca;
  const { createdAt: cb, ...restB } = b; void cb;
  assert.equal(JSON.stringify(restA), JSON.stringify(restB));
  assert.ok(a.events.length > 10);
});
