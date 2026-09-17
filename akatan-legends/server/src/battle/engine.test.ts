/** 戦闘エンジン全体の検証 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { BattleEvent, BattleLog } from '@akatan/shared';
import { runBattle } from './index.js';
import { AWAKENING_TURN1, CONFIG, baseStats, makeContext, unit } from './testFixtures.js';

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
