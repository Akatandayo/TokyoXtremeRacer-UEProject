/**
 * デモモード用の BattleLog 生成器。
 *
 * 注意: これは「サーバの代役」であり、BATTLE画面側の実装ではない。
 * 本番の BATTLE 画面は一切計算せず、サーバから届いた BattleLog を再生するだけ。
 * ここは演出レビューのために、それらしいログを決定論的に作るためだけに存在する。
 */
import type {
  BattleEvent, BattleLog, BattleUnit, BattleUnitSnapshot, BattleUnitStat,
  BattleRewards, CharacterView, StageDef, Element, ActiveStatus, Skill,
  LevelUpInfo, Stats, Awakening, ComboDef,
} from '@akatan/shared';
import { MOCK_ENEMIES, MOCK_SKILL_MAP, MOCK_COMBOS, MOCK_CHARACTER_MAP } from './master';
import { computeStats, expToNext } from './player';

/* ---------- 乱数 (決定論) ---------- */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- 属性相性 ---------- */
const STRONG: Partial<Record<Element, Element[]>> = {
  FIRE: ['WIND', 'EARTH'],
  WIND: ['EARTH', 'WATER'],
  EARTH: ['WATER', 'FIRE'],
  WATER: ['FIRE'],
  LIGHT: ['DARK', 'VOID'],
  DARK: ['LIGHT'],
  VOID: ['LIGHT', 'DARK'],
};

function affinityOf(a: Element, d: Element): number {
  if (STRONG[a]?.includes(d)) return 1.5;
  if (STRONG[d]?.includes(a)) return 0.7;
  return 1.0;
}

/* ---------- 内部シミュレーション状態 ---------- */
interface SimUnit extends BattleUnit {
  skillPool: Skill[];
  normal: Skill;
  ult?: Skill;
  cooldowns: Record<string, number>;
  awakening?: Awakening;
  skillUses: Record<string, number>;
  damageDealt: number;
  damageTaken: number;
  healing: number;
  kills: number;
}

function skill(id: string | undefined): Skill | undefined {
  return id ? MOCK_SKILL_MAP.get(id) : undefined;
}

function toSimAlly(view: CharacterView, slot: number): SimUnit {
  const s = view.stats;
  return {
    id: `A${slot}`,
    side: 'ALLY',
    slot,
    name: view.def.name,
    defId: view.def.id,
    element: view.def.element,
    roles: view.def.roles,
    level: view.owned.level,
    stats: s,
    hp: s.hp,
    maxHp: s.hp,
    gauge: 0,
    ultGauge: slot === 0 ? 35 : Math.min(60, slot * 12),
    statuses: [],
    alive: true,
    awakened: false,
    art: view.def.art,
    rarity: view.def.rarity,
    skillPool: view.skills,
    normal: view.normalAttack,
    ult: view.ultimate,
    cooldowns: {},
    awakening: view.def.awakening,
    skillUses: {},
    damageDealt: 0, damageTaken: 0, healing: 0, kills: 0,
  };
}

function enemyStats(base: Stats, growth: Partial<Stats>, level: number): Stats {
  const lv = level - 1;
  const f = (b: number, g?: number) => Math.round(b + (g ?? 0) * lv);
  return {
    hp: f(base.hp, growth.hp),
    attack: f(base.attack, growth.attack),
    defense: f(base.defense, growth.defense),
    speed: f(base.speed, growth.speed),
    critical: base.critical,
    criticalDamage: base.criticalDamage,
    resistance: base.resistance,
    healing: base.healing,
  };
}

function toSimEnemy(enemyId: string, level: number, slot: number): SimUnit | null {
  const def = MOCK_ENEMIES.find((e) => e.id === enemyId);
  if (!def) return null;
  const s = enemyStats(def.baseStats, def.growth, level);
  return {
    id: `E${slot}`,
    side: 'ENEMY',
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles,
    level,
    stats: s,
    hp: s.hp,
    maxHp: s.hp,
    gauge: 0,
    ultGauge: 0,
    statuses: [],
    alive: true,
    awakened: false,
    art: def.art,
    rarity: def.boss ? 'SSR' : 'R',
    skillPool: def.skills.map(skill).filter((x): x is Skill => !!x),
    normal: skill(def.normalAttack) ?? MOCK_SKILL_MAP.get('sk_enemy_claw')!,
    ult: skill(def.ultimate),
    cooldowns: {},
    skillUses: {},
    damageDealt: 0, damageTaken: 0, healing: 0, kills: 0,
  };
}

/* ---------- 本体 ---------- */

export interface MockBattleOptions {
  seed?: number;
  /** 強制的に勝敗を決める(デモ用) */
  forceOutcome?: 'victory' | 'defeat';
}

export function generateMockBattle(
  allies: CharacterView[],
  stage: StageDef,
  opts: MockBattleOptions = {},
): BattleLog {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const rnd = mulberry32(seed);

  const A: SimUnit[] = allies.slice(0, 5).map(toSimAlly);
  const E: SimUnit[] = stage.enemies
    .map((p, i) => toSimEnemy(p.enemyId, p.level, i))
    .filter((u): u is SimUnit => u !== null);

  const units = [...A, ...E];
  const events: BattleEvent[] = [];
  let seq = 0;
  let tick = 0;
  let turn = 1;

  // P0-4(b): 現在の編成(defId基準)で成立しているコンボを判定し、戦闘中に発火させる。
  // 本番の戦闘エンジンの発動ロジックそのものではなく、演出レビュー用の簡易な代役。
  const allyDefIds = A.map((a) => a.defId);
  const activeMockCombos: ComboDef[] = MOCK_COMBOS.filter((def) => {
    if (def.kind === 'PAIR' || def.kind === 'TRIO') {
      return (def.members ?? []).every((m) => allyDefIds.includes(m));
    }
    if (def.kind === 'TAG' && def.requireTag) {
      const owners = A.filter((a) => MOCK_CHARACTER_MAP.get(a.defId)?.tags?.includes(def.requireTag!.tag));
      return owners.length >= def.requireTag.count;
    }
    if (def.kind === 'PARTY' && def.requireAllElement) {
      return A.length === 5 && A.every((a) => a.element === def.requireAllElement);
    }
    return false;
  });
  let comboFires = 0;
  const MAX_COMBO_FIRES = 3;

  const snap = (): BattleUnitSnapshot[] =>
    units.map((u) => ({
      id: u.id,
      hp: Math.max(0, Math.round(u.hp)),
      gauge: Math.round(u.gauge),
      ultGauge: Math.round(u.ultGauge),
      alive: u.alive,
      awakened: u.awakened,
      statuses: u.statuses.map((s) => ({ ...s })),
    }));

  const push = (e: Omit<BattleEvent, 'seq' | 'tick'>, withSnapshot = true): void => {
    events.push({ seq: seq++, tick, ...e, ...(withSnapshot ? { snapshot: snap() } : {}) });
  };

  const alive = (side: 'ALLY' | 'ENEMY') => units.filter((u) => u.side === side && u.alive);

  let alliesDefeated = 0;
  let enemiesDefeated = 0;

  const tryAwaken = (u: SimUnit): void => {
    if (u.side !== 'ALLY' || u.awakened || !u.alive || !u.awakening) return;
    const c = u.awakening.condition;
    let ok = false;
    if (c.hpBelow !== undefined && (u.hp / u.maxHp) * 100 <= c.hpBelow) ok = true;
    if (c.turnAtLeast !== undefined && turn >= c.turnAtLeast) ok = true;
    if (c.enemyDefeated !== undefined && enemiesDefeated >= c.enemyDefeated) ok = true;
    if (c.allyDefeated !== undefined && alliesDefeated >= c.allyDefeated) ok = true;
    if (c.skillUsed && (u.skillUses[c.skillUsed.skill] ?? 0) >= c.skillUsed.count) ok = true;
    if (!ok) return;
    u.awakened = true;
    push({
      type: 'AWAKEN',
      sourceId: u.id,
      targetId: u.id,
      skillName: u.awakening.name,
      fx: u.awakening.fx ?? 'awaken_generic',
      text: `${u.name} 覚醒 ——「${u.awakening.name}」`,
    });
  };

  const addStatus = (u: SimUnit, s: ActiveStatus) => {
    const i = u.statuses.findIndex((x) => x.type === s.type);
    if (i >= 0) u.statuses[i] = s;
    else u.statuses.push(s);
  };

  push({
    type: 'BATTLE_START',
    text: `${stage.name} — 戦闘開始`,
    fx: 'battle_start',
  });

  const applyDamage = (src: SimUnit, tgt: SimUnit, sk: Skill, power: number, grouped = false): void => {
    const aff = affinityOf(src.element, tgt.element);
    const crit = rnd() * 100 < src.stats.critical;
    const atkStat = sk.effects[0]?.scaling === 'defense' ? src.stats.defense : src.stats.attack;
    const atkUp = src.statuses.some((s) => s.type === 'ATK_UP') ? 1.25 : 1;
    const defDown = tgt.statuses.some((s) => s.type === 'DEF_DOWN') ? 0.78 : 1;
    const awakenBonus = src.awakened ? 1.3 : 1;
    const base =
      (atkStat * power * atkUp * awakenBonus * 300) / (300 + tgt.stats.defense * defDown * 1.2);
    const varia = 0.92 + rnd() * 0.16;
    let dmg = base * varia * aff * (crit ? src.stats.criticalDamage / 100 : 1);
    if (tgt.statuses.some((s) => s.type === 'SHIELD')) dmg *= 0.65;
    dmg = Math.max(1, Math.round(dmg));

    tgt.hp = Math.max(0, tgt.hp - dmg);
    src.damageDealt += dmg;
    tgt.damageTaken += dmg;
    src.ultGauge = Math.min(100, src.ultGauge + 12);
    tgt.ultGauge = Math.min(100, tgt.ultGauge + 7);

    push({
      type: 'DAMAGE',
      sourceId: src.id,
      targetId: tgt.id,
      skillId: sk.id,
      skillName: sk.name,
      value: dmg,
      critical: crit,
      affinity: aff,
      element: src.element,
      fx: sk.fx,
      grouped,
      text: `${src.name} → ${tgt.name} に ${dmg} ダメージ${crit ? '(会心!)' : ''}${aff > 1 ? '【弱点】' : aff < 1 ? '【耐性】' : ''}`,
    });

    if (tgt.hp <= 0 && tgt.alive) {
      tgt.alive = false;
      src.kills += 1;
      if (tgt.side === 'ALLY') alliesDefeated += 1;
      else enemiesDefeated += 1;
      push({
        type: 'DEFEAT',
        sourceId: src.id,
        targetId: tgt.id,
        fx: 'defeat',
        text: `${tgt.name} は倒れた`,
      });
      for (const a of units) tryAwaken(a);
    } else {
      tryAwaken(tgt);
    }
  };

  const applyHeal = (src: SimUnit, tgt: SimUnit, sk: Skill, power: number, grouped = false): void => {
    const amount = Math.max(
      1,
      Math.round(tgt.maxHp * power * (src.stats.healing / 100) * (0.95 + rnd() * 0.1)),
    );
    const real = Math.min(amount, tgt.maxHp - tgt.hp);
    tgt.hp = Math.min(tgt.maxHp, tgt.hp + amount);
    src.healing += real;
    push({
      type: 'HEAL',
      sourceId: src.id,
      targetId: tgt.id,
      skillId: sk.id,
      skillName: sk.name,
      value: real,
      fx: sk.fx ?? 'heal_wave',
      grouped,
      text: `${tgt.name} のHPが ${real} 回復`,
    });
  };

  const pickTargets = (src: SimUnit, sk: Skill): SimUnit[] => {
    const side = sk.target.side;
    const pool =
      side === 'SELF'
        ? [src]
        : side === 'ALLY'
          ? alive(src.side)
          : alive(src.side === 'ALLY' ? 'ENEMY' : 'ALLY');
    if (pool.length === 0) return [];
    switch (sk.target.pattern) {
      case 'ALL':
        return pool;
      case 'SELF':
        return [src];
      case 'LOWEST_HP':
        return [[...pool].sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)[0]!];
      case 'HIGHEST_ATK':
        return [[...pool].sort((a, b) => b.stats.attack - a.stats.attack)[0]!];
      case 'RANDOM': {
        const n = Math.min(sk.target.count ?? 1, pool.length);
        const out: SimUnit[] = [];
        for (let i = 0; i < n; i++) out.push(pool[Math.floor(rnd() * pool.length)]!);
        return out;
      }
      default: {
        const taunt = pool.find((u) => u.statuses.some((s) => s.type === 'TAUNT'));
        return [taunt ?? pool[Math.floor(rnd() * pool.length)]!];
      }
    }
  };

  const act = (u: SimUnit): void => {
    push({ type: 'ACTION_START', sourceId: u.id, text: `${u.name} の行動` }, false);

    // 行動不能
    const inc = u.statuses.find((s) => s.type === 'STUN' || s.type === 'FREEZE');
    if (inc) {
      push({
        type: 'ACTION_END',
        sourceId: u.id,
        status: inc.type,
        fx: 'stunned',
        text: `${u.name} は ${inc.type === 'STUN' ? '気絶' : '氷結'} していて動けない`,
      });
      return;
    }

    const silenced = u.statuses.some((s) => s.type === 'SILENCE');
    let sk: Skill;
    if (u.ult && u.ultGauge >= 100 && !silenced) {
      sk = u.ult;
      u.ultGauge = 0;
    } else {
      const ready = silenced ? [] : u.skillPool.filter((s) => (u.cooldowns[s.id] ?? 0) <= 0);
      sk = ready.length > 0 && rnd() < 0.62 ? ready[Math.floor(rnd() * ready.length)]! : u.normal;
      if (sk !== u.normal) u.cooldowns[sk.id] = sk.cooldown;
    }

    u.skillUses[sk.id] = (u.skillUses[sk.id] ?? 0) + 1;

    const isUlt = sk.kind === 'ULTIMATE';
    push({
      type: 'SKILL_USE',
      sourceId: u.id,
      skillId: sk.id,
      skillName: sk.name,
      element: u.element,
      fx: sk.fx,
      text: isUlt ? `${u.name} 必殺技「${sk.name}」!!` : `${u.name} は「${sk.name}」を発動`,
    });

    for (const eff of sk.effects) {
      const targets = eff.target
        ? pickTargets(u, { ...sk, target: eff.target })
        : pickTargets(u, sk);
      // grouped: 同じスキル・同じ効果が複数対象に連続適用される場合、2件目以降(ti>0)に
      // true を立てる。UIはこれを見てログ行を1行にまとめる(P0-3)。
      targets.forEach((t, ti) => {
        if (!t.alive && eff.type !== 'HEAL') return;
        const grouped = ti > 0;
        const hits = eff.hits ?? 1;
        switch (eff.type) {
          case 'DAMAGE':
            for (let h = 0; h < hits; h++) {
              if (!t.alive) break;
              applyDamage(u, t, sk, eff.power ?? 1, grouped);
            }
            break;
          case 'HEAL':
            if (t.alive) applyHeal(u, t, sk, eff.power ?? 0.2, grouped);
            break;
          case 'STATUS': {
            if (!eff.status) break;
            const chance = eff.chance ?? 100;
            const resisted = rnd() * 100 >= chance - t.stats.resistance * 0.3;
            if (resisted && chance < 100) {
              push({
                type: 'STATUS_RESIST',
                sourceId: u.id,
                targetId: t.id,
                status: eff.status,
                fx: 'resist',
                grouped,
                text: `${t.name} は効果を抵抗した`,
              });
            } else {
              addStatus(t, {
                type: eff.status,
                duration: eff.duration ?? 2,
                potency: eff.potency ?? 10,
                sourceId: u.id,
              });
              push({
                type: 'STATUS_APPLY',
                sourceId: u.id,
                targetId: t.id,
                status: eff.status,
                duration: eff.duration ?? 2,
                fx: 'status_apply',
                grouped,
                text: `${t.name} に ${eff.status} (${eff.duration ?? 2}ターン)`,
              });
            }
            break;
          }
          case 'CLEANSE':
            if (t.statuses.length > 0) {
              const removed = t.statuses.filter((s) =>
                ['POISON', 'BURN', 'FREEZE', 'STUN', 'SILENCE', 'BLEED', 'SLOW', 'DEF_DOWN', 'ATK_DOWN'].includes(s.type),
              );
              t.statuses = t.statuses.filter((s) => !removed.includes(s));
              // CLEANSEは対象ごとに解除される状態異常の組み合わせがまちまちなので、
              // ここでは grouped 化(行のまとめ)は行わない(誤ってまとめると意味が変わる)。
              removed.forEach((r) => {
                push({
                  type: 'STATUS_EXPIRE',
                  targetId: t.id,
                  status: r.type,
                  fx: 'cleanse_ring',
                  text: `${t.name} の ${r.type} が解除された`,
                });
              });
            }
            break;
          case 'GAUGE':
            t.gauge = Math.min(99, t.gauge + (eff.amount ?? 20));
            push({
              type: 'GAUGE_CHANGE',
              sourceId: u.id,
              targetId: t.id,
              value: eff.amount ?? 20,
              fx: 'tempo_pulse',
              grouped,
              text: `${t.name} の行動ゲージ +${eff.amount ?? 20}%`,
            });
            break;
          case 'ULT_GAUGE':
            t.ultGauge = Math.min(100, t.ultGauge + (eff.amount ?? 20));
            push({
              type: 'GAUGE_CHANGE',
              sourceId: u.id,
              targetId: t.id,
              value: eff.amount ?? 20,
              fx: 'ult_charge',
              grouped,
              text: `${t.name} の必殺ゲージ +${eff.amount ?? 20}%`,
            });
            break;
        }
      });
    }

    if (!isUlt) u.ultGauge = Math.min(100, u.ultGauge + 18);
    if (u.ult && u.ultGauge >= 100) {
      push({
        type: 'ULT_READY',
        sourceId: u.id,
        skillName: u.ult.name,
        fx: 'ult_charge',
        text: `${u.name} の必殺技が使用可能に!`,
      });
    }

    // コンボ演出: 編成が実際に満たしているコンボ定義(activeMockCombos)から、
    // 今行動したユニットが参加者であるものを一定確率で発火させる。
    if (u.side === 'ALLY' && comboFires < MAX_COMBO_FIRES) {
      for (const def of activeMockCombos) {
        const involved = def.kind === 'PAIR' || def.kind === 'TRIO'
          ? (def.members ?? []).includes(u.defId)
          : true;
        if (!involved || rnd() >= 0.22) continue;
        const pool = alive('ALLY').filter((x) => x.id !== u.id
          && (def.members ? def.members.includes(x.defId) : true));
        const partner = pool[Math.floor(rnd() * pool.length)] ?? alive('ALLY').find((x) => x.id !== u.id);
        if (!partner) continue;
        comboFires += 1;
        push({
          type: 'COMBO',
          sourceId: u.id,
          targetId: partner.id,
          comboId: def.id,
          skillName: def.name,
          fx: def.fx ?? 'combo_link',
          text: `コンボ発動!「${def.name}」 ${u.name} × ${partner.name}`,
        });
        break;
      }
    }

    for (const k of Object.keys(u.cooldowns)) {
      if (u.cooldowns[k]! > 0) u.cooldowns[k]! -= 1;
    }

    tryAwaken(u);

    push({ type: 'ACTION_END', sourceId: u.id }, false);
  };

  const tickStatuses = (): void => {
    for (const u of units) {
      if (!u.alive || u.statuses.length === 0) continue;
      for (const s of [...u.statuses]) {
        if (s.type === 'POISON' || s.type === 'BURN' || s.type === 'BLEED') {
          const dmg = Math.max(1, Math.round(u.maxHp * (s.potency || 6) * 0.01));
          u.hp = Math.max(0, u.hp - dmg);
          u.damageTaken += dmg;
          push({
            type: 'STATUS_TICK',
            targetId: u.id,
            status: s.type,
            value: dmg,
            fx: s.type === 'BURN' ? 'flame_tick' : 'poison_tick',
            text: `${u.name} は ${s.type} で ${dmg} ダメージ`,
          });
          if (u.hp <= 0) {
            u.alive = false;
            if (u.side === 'ALLY') alliesDefeated += 1;
            else enemiesDefeated += 1;
            push({ type: 'DEFEAT', targetId: u.id, fx: 'defeat', text: `${u.name} は倒れた` });
          }
        } else if (s.type === 'REGEN') {
          const heal = Math.max(1, Math.round(u.maxHp * (s.potency || 8) * 0.01));
          u.hp = Math.min(u.maxHp, u.hp + heal);
          push({
            type: 'STATUS_TICK',
            targetId: u.id,
            status: s.type,
            value: heal,
            fx: 'heal_wave',
            text: `${u.name} は 再生 で ${heal} 回復`,
          });
        }
        s.duration -= 1;
        if (s.duration <= 0) {
          u.statuses = u.statuses.filter((x) => x !== s);
          push({
            type: 'STATUS_EXPIRE',
            targetId: u.id,
            status: s.type,
            text: `${u.name} の ${s.type} が切れた`,
          });
        }
      }
    }
  };

  let actionsInTurn = 0;
  push({ type: 'TURN_START', value: turn, text: `ターン ${turn}` });

  const MAX_TICKS = 4000;
  while (alive('ALLY').length > 0 && alive('ENEMY').length > 0 && tick < MAX_TICKS) {
    tick += 1;
    for (const u of units) {
      if (!u.alive) continue;
      const spdUp = u.statuses.some((s) => s.type === 'SPD_UP') ? 1.35 : 1;
      const slow = u.statuses.some((s) => s.type === 'SLOW') ? 0.7 : 1;
      const awaken = u.awakened ? 1.15 : 1;
      u.gauge += u.stats.speed * 0.1 * spdUp * slow * awaken;
    }
    const ready = units.filter((u) => u.alive && u.gauge >= 100).sort((a, b) => b.gauge - a.gauge);
    for (const u of ready) {
      if (!u.alive) continue;
      if (alive('ALLY').length === 0 || alive('ENEMY').length === 0) break;
      u.gauge = 0;
      act(u);
      actionsInTurn += 1;
      if (actionsInTurn >= units.filter((x) => x.alive).length) {
        actionsInTurn = 0;
        tickStatuses();
        if (alive('ALLY').length === 0 || alive('ENEMY').length === 0) break;
        turn += 1;
        push({ type: 'TURN_START', value: turn, text: `ターン ${turn}` });
        for (const a of units) tryAwaken(a);
      }
    }
  }

  let victory = alive('ENEMY').length === 0 && alive('ALLY').length > 0;
  if (opts.forceOutcome) victory = opts.forceOutcome === 'victory';

  const stats: BattleUnitStat[] = units.map((u) => ({
    id: u.id,
    name: u.name,
    side: u.side,
    damageDealt: u.damageDealt,
    damageTaken: u.damageTaken,
    healing: u.healing,
    kills: u.kills,
    survived: u.alive,
  }));

  const rewards = victory ? buildRewards(allies, stage) : undefined;

  push({
    type: 'BATTLE_END',
    value: victory ? 1 : 0,
    fx: victory ? 'victory' : 'defeat_all',
    text: victory ? '戦闘に勝利した!' : '全滅した…',
  });

  const startUnits: BattleUnit[] = units.map((u) => ({
    id: u.id, side: u.side, slot: u.slot, name: u.name, defId: u.defId,
    element: u.element, roles: u.roles, level: u.level, stats: u.stats,
    hp: u.maxHp, maxHp: u.maxHp, gauge: 0,
    ultGauge: u.side === 'ALLY' ? (u.slot === 0 ? 35 : Math.min(60, u.slot * 12)) : 0,
    statuses: [], alive: true, awakened: false, art: u.art, rarity: u.rarity,
  }));

  return {
    id: `mock_${seed}`,
    seed,
    stageId: stage.id,
    createdAt: new Date().toISOString(),
    units: startUnits,
    events,
    result: { victory, ticks: tick, turns: turn, stats, rewards },
  };
}

export function buildRewards(allies: CharacterView[], stage: StageDef): BattleRewards {
  const levelUps: LevelUpInfo[] = [];
  for (const v of allies.slice(0, 5)) {
    const gained = stage.rewards.exp;
    let level = v.owned.level;
    let exp = v.owned.exp + gained;
    while (exp >= expToNext(level) && level < 99) {
      exp -= expToNext(level);
      level += 1;
    }
    if (level > v.owned.level) {
      const before = computeStats(v.def, v.owned.level, v.owned.rebirth);
      const after = computeStats(v.def, level, v.owned.rebirth);
      levelUps.push({
        uid: v.owned.uid,
        name: v.def.name,
        fromLevel: v.owned.level,
        toLevel: level,
        expGained: gained,
        statGain: {
          hp: after.hp - before.hp,
          attack: after.attack - before.attack,
          defense: after.defense - before.defense,
          speed: after.speed - before.speed,
        },
      });
    }
  }
  return { exp: stage.rewards.exp, gold: stage.rewards.gold, levelUps };
}
