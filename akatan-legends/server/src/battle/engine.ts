/**
 * 戦闘エンジン本体 (完全オートバトル)
 * ------------------------------------------------------------
 * 全体設計:
 *
 * [行動ゲージ方式]
 *   1ティックごとに  gauge += effectiveSpeed * gaugeRate
 *   gauge >= gaugeMax になったユニットが行動する。
 *   ただし **1ティックずつ回さない**。「次に誰かが gaugeMax に届くまでに必要なティック数」を
 *       n = min over units of ceil((gaugeMax - gauge) / (speed * gaugeRate))
 *   で直接求め、全員のゲージを n ティック分まとめて進める。
 *   無限ダンジョンのように maxTicks が数万になっても、計算量は「行動回数」に比例するだけで済む。
 *
 * [同時到達の解決]
 *   ゲージ超過量(gauge - gaugeMax)が大きい順 -> 実効speedが速い順 -> slot昇順 -> side -> id。
 *   最後まで必ず一意に決まる比較にしておかないと、ソートの安定性に依存して
 *   環境ごとにログがズレる = リプレイが壊れる。
 *
 * [決定論]
 *   乱数は createRng(ctx.seed) の単一ストリームのみ。消費順序が行動順で一意に決まるため、
 *   同じ入力 + 同じシード => 同じイベント列になる。
 *   (唯一 BattleLog.createdAt だけが実時刻。リプレイ比較時は除外すること)
 *
 * [イベントログ]
 *   演出の生命線。全イベントに seq/tick を振り、HP・ゲージ・状態が動くイベントには
 *   適用直後の全ユニット snapshot を添える。フロントはイベント列だけで完全再生できる。
 */
import type {
  ActiveStatus, AffinityTable, Awakening, BattleEvent, BattleEventType, BattleLog,
  BattleResult, BattleUnit, BattleUnitSnapshot, BattleUnitStat, Element,
  ProgressionConfig, Side, Skill, SkillEffect, StatKey, StatusType,
} from '@akatan/shared';
import type { BattleContext, CombatantInput, RunBattle } from './contract.js';
import { createRng, type Rng } from './rng.js';
import { affinityMultiplier, computeDamage, computeHeal } from './damage.js';
import {
  advanceStatuses, absorbWithShield, applyStatus, cleanseDebuffs, clearAll, computeStatusTick,
  effectiveStat, incapacitatingReason, isIncapacitated, STATUS_LABEL,
} from './status.js';
import { decideAction, hpRatio, selectTargets, profileTendency, type AiUnit } from './ai.js';

type BattleConfig = ProgressionConfig['battle'];

/** 実行時ユニット。BattleUnit + AI用情報 + 集計。 */
interface EngineUnit extends AiUnit {
  awakening?: Awakening;
  /** スキルID -> 使用回数 (覚醒条件 skillUsed 用) */
  skillUseCount: Map<string, number>;
  /** 必殺ゲージMAXを既に告知済みか (ULT_READY を毎行動出さないため) */
  ultAnnounced: boolean;
  stat: BattleUnitStat;
}

/**
 * config の防御的正規化。
 * data 担当が値を入れ忘れても戦闘APIが NaN で落ちないよう、全項目に妥当な既定値を置く。
 */
function normalizeConfig(cfg: Partial<BattleConfig> | undefined): BattleConfig {
  const num = (v: unknown, d: number, min = 0): number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min ? v : d;
  return {
    gaugeRate: num(cfg?.gaugeRate, 1, 0.0001),
    gaugeMax: num(cfg?.gaugeMax, 100, 1),
    ultGainOnAction: num(cfg?.ultGainOnAction, 10),
    ultGainOnHit: num(cfg?.ultGainOnHit, 5),
    ultMax: num(cfg?.ultMax, 100, 1),
    defenseConstant: num(cfg?.defenseConstant, 300, 1),
    maxTicks: num(cfg?.maxTicks, 20000, 1),
    damageVariance: num(cfg?.damageVariance, 0.05),
  };
}

/** 行動回数の安全弁。ゲージ操作スキルの組み合わせで理論上ティックが進まない事態を止める。 */
const MAX_ACTIONS = 100000;

class BattleRunner {
  private readonly units: EngineUnit[] = [];
  private readonly events: BattleEvent[] = [];
  private readonly rng: Rng;
  private readonly cfg: BattleConfig;
  private readonly affinity: AffinityTable;
  private seq = 0;
  private tick = 0;
  private turn = 1;
  /** 現ラウンドで行動した回数 / このラウンドの定員(ラウンド開始時の生存数) */
  private actionsThisRound = 0;
  private roundQuota = 1;
  private actionCount = 0;
  private finished = false;
  private victory = false;
  private endReason = '';

  constructor(
    allies: CombatantInput[],
    enemies: CombatantInput[],
    private readonly ctx: BattleContext,
  ) {
    this.cfg = normalizeConfig(ctx.config);
    this.affinity = ctx.affinity ?? {};
    this.rng = createRng(ctx.seed);
    // 味方 -> 敵 の順で並べる。この並びがそのまま snapshot の並びになり、フロントの描画順にもなる。
    for (const c of [...allies].sort((a, b) => a.slot - b.slot)) this.units.push(this.toUnit(c, 'ALLY'));
    for (const c of [...enemies].sort((a, b) => a.slot - b.slot)) this.units.push(this.toUnit(c, 'ENEMY'));
  }

  /* ========================================================
   * セットアップ
   * ====================================================== */

  /**
   * CombatantInput -> 実行時ユニット。
   * side は **runBattle に渡された配列の位置** を正とする (c.side は参考値として無視)。
   * API層が同じ CombatantInput を敵味方入れ替えて使う(模擬戦/PvP)場合に、
   * データ側の side が残っていると陣営が壊れるため。
   */
  private toUnit(c: CombatantInput, side: Side): EngineUnit {
    const maxHp = Math.max(1, Math.round(c.stats.hp));
    const u: EngineUnit = {
      id: c.id,
      side,
      slot: c.slot,
      name: c.name,
      defId: c.defId,
      element: c.element,
      roles: [...c.roles],
      level: c.level,
      stats: { ...c.stats, hp: maxHp },
      hp: maxHp,
      maxHp,
      gauge: 0,
      ultGauge: 0,
      statuses: [],
      alive: true,
      awakened: false,
      art: c.art,
      rarity: c.rarity,
      normalAttackId: c.normalAttack,
      skillIds: [...c.skills],
      ultimateId: c.ultimate,
      aiProfileId: c.aiProfile,
      cooldowns: new Map(),
      awakening: c.awakening,
      skillUseCount: new Map(),
      ultAnnounced: false,
      stat: {
        id: c.id, name: c.name, side,
        damageDealt: 0, damageTaken: 0, healing: 0, kills: 0, survived: true,
      },
    };
    // 初期クールダウン (開幕から必殺級スキルを撃たせない用)
    for (const id of [...u.skillIds, u.ultimateId ?? '']) {
      const sk = id ? this.ctx.skills.get(id) : undefined;
      if (sk?.initialCooldown && sk.initialCooldown > 0) u.cooldowns.set(sk.id, sk.initialCooldown);
    }
    // パッシブ: 自分にかかる STATUS 効果だけを開幕から永続付与する (Phase1 の最小実装)
    for (const pid of c.passives ?? []) {
      const sk = this.ctx.skills.get(pid);
      if (!sk || sk.kind !== 'PASSIVE') continue;
      for (const e of sk.effects) {
        if (e.type !== 'STATUS' || !e.status) continue;
        applyStatus(u, {
          type: e.status,
          duration: e.duration ?? 9999,
          potency: e.potency ?? 0,
          sourceId: u.id,
          ignoreResistance: true,
        }, this.rng);
      }
    }
    return u;
  }

  /* ========================================================
   * イベント
   * ====================================================== */

  /** snapshot を必ず付けるイベント種別 (HP/ゲージ/状態が動くもの) */
  private static readonly SNAPSHOT_EVENTS: readonly BattleEventType[] = [
    'BATTLE_START', 'DAMAGE', 'HEAL', 'STATUS_APPLY', 'STATUS_EXPIRE', 'STATUS_TICK',
    'GAUGE_CHANGE', 'DEFEAT', 'AWAKEN', 'BATTLE_END',
  ];

  private emit(type: BattleEventType, e: Omit<BattleEvent, 'seq' | 'tick' | 'type'>): BattleEvent {
    const ev: BattleEvent = { seq: this.seq++, tick: this.tick, type, ...e };
    if (BattleRunner.SNAPSHOT_EVENTS.includes(type)) ev.snapshot = this.snapshot();
    this.events.push(ev);
    return ev;
  }

  /** 適用直後の全ユニット状態。フロントはこれだけで盤面を再構築できる。 */
  private snapshot(): BattleUnitSnapshot[] {
    return this.units.map((u) => ({
      id: u.id,
      hp: u.hp,
      // 浮動小数の桁を丸めて JSON のゆらぎを潰す (リプレイのハッシュ比較を安定させる)
      gauge: Math.round(u.gauge * 100) / 100,
      ultGauge: Math.round(u.ultGauge * 100) / 100,
      alive: u.alive,
      awakened: u.awakened,
      statuses: u.statuses.map((s): ActiveStatus => ({ ...s })),
    }));
  }

  /* ========================================================
   * 参照系
   * ====================================================== */

  private aliveOf(side: Side): EngineUnit[] {
    return this.units.filter((u) => u.side === side && u.alive);
  }
  private alliesOf(u: EngineUnit): EngineUnit[] {
    return this.aliveOf(u.side);
  }
  private foesOf(u: EngineUnit): EngineUnit[] {
    return this.aliveOf(u.side === 'ALLY' ? 'ENEMY' : 'ALLY');
  }
  /** 実効速度 (SLOW/SPD_UP 込み)。0以下にはしない = ゲージが永久に止まるのを防ぐ。 */
  private speedOf(u: EngineUnit): number {
    return Math.max(0.01, effectiveStat(u, 'speed'));
  }
  private gaugePerTick(u: EngineUnit): number {
    return this.speedOf(u) * this.cfg.gaugeRate;
  }

  /* ========================================================
   * メインループ
   * ====================================================== */

  run(): BattleLog {
    const initialUnits = this.units.map(toBattleUnit);

    this.emit('BATTLE_START', {
      text: `戦闘開始！ ${this.aliveOf('ALLY').length} 対 ${this.aliveOf('ENEMY').length}`,
    });
    this.roundQuota = Math.max(1, this.units.filter((u) => u.alive).length);
    this.emit('TURN_START', { value: this.turn, text: `── ${this.turn} ターン目 ──` });

    while (!this.finished) {
      // 決着チェック (開幕から片側0人のような異常入力もここで拾う)
      if (this.checkBattleEnd()) break;

      const actor = this.nextActor();
      if (!actor) {
        // 誰もゲージが溜まらない = 進行不能。時間切れ扱いで決着させる。
        this.resolveTimeout('進行不能');
        break;
      }

      // 時間切れ判定は「ティックを進めた直後・行動を実行する前」に行う。
      // 行動の直後に判定すると、同じティックに同時到達した複数体のうち
      // 先に動いた側だけが1回多く殴った状態で打ち切られ、
      // 引き分けになるべき戦闘が手番順だけで片側有利に倒れてしまう。
      if (this.tick > this.cfg.maxTicks) { this.resolveTimeout('最大ティック超過'); break; }

      this.takeAction(actor);

      if (this.checkBattleEnd()) break;

      // ラウンド管理: 「ラウンド開始時の生存数」ぶん行動したら1ターン経過とみなす。
      // 個々の行動を1ターンと数えると TURN_ATLEAST の閾値設計が破綻するため、ラウンド制にする。
      this.actionsThisRound++;
      if (this.actionsThisRound >= this.roundQuota) {
        this.turn++;
        this.actionsThisRound = 0;
        this.roundQuota = Math.max(1, this.units.filter((u) => u.alive).length);
        this.emit('TURN_START', { value: this.turn, text: `── ${this.turn} ターン目 ──` });
      }

      this.actionCount++;
      if (this.actionCount > MAX_ACTIONS) { this.resolveTimeout('最大行動回数超過'); break; }
    }

    // 何らかの理由で BATTLE_END を出さずに抜けた場合の保険 (ログの最後は必ず BATTLE_END)
    if (this.events[this.events.length - 1]?.type !== 'BATTLE_END') {
      this.emitBattleEnd();
    }

    return {
      id: this.logId(),
      seed: this.ctx.seed,
      stageId: this.ctx.stageId,
      createdAt: new Date().toISOString(),
      units: initialUnits,
      events: this.events,
      result: this.buildResult(),
    };
  }

  /**
   * 次に行動するユニットを返す。必要ならティックをまとめて進める。
   * 既に gaugeMax に達している者がいればティックは進めない (ゲージ操作スキルの結果を即反映する)。
   */
  private nextActor(): EngineUnit | undefined {
    let ready = this.readyUnits();
    if (ready.length === 0) {
      const n = this.ticksUntilNextAction();
      if (n === undefined) return undefined; // 全員止まっている
      this.tick += n;
      for (const u of this.units) {
        if (!u.alive) continue;
        u.gauge += this.gaugePerTick(u) * n;
      }
      ready = this.readyUnits();
      if (ready.length === 0) return undefined;
    }
    return ready[0];
  }

  /** 行動可能(ゲージ充填済み)なユニットを、同時到達の解決順に並べて返す */
  private readyUnits(): EngineUnit[] {
    const max = this.cfg.gaugeMax;
    return this.units
      .filter((u) => u.alive && u.gauge >= max)
      .sort((a, b) => {
        const over = (b.gauge - max) - (a.gauge - max);      // 1) 超過量が大きい方が先
        if (Math.abs(over) > 1e-9) return over;
        const spd = this.speedOf(b) - this.speedOf(a);        // 2) 速い方が先
        if (Math.abs(spd) > 1e-9) return spd;
        if (a.slot !== b.slot) return a.slot - b.slot;        // 3) slot 昇順
        if (a.side !== b.side) return a.side === 'ALLY' ? -1 : 1; // 4) 味方が先
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;        // 5) id (完全な一意化)
      });
  }

  /** 次に誰かが行動するまでに必要な最小ティック数。誰も進めないなら undefined。 */
  private ticksUntilNextAction(): number | undefined {
    let best: number | undefined;
    for (const u of this.units) {
      if (!u.alive) continue;
      const per = this.gaugePerTick(u);
      if (per <= 0) continue;
      // 最低1ティックは進める。0を返すとループが止まらなくなる。
      const need = Math.max(1, Math.ceil((this.cfg.gaugeMax - u.gauge) / per));
      if (best === undefined || need < best) best = need;
    }
    return best;
  }

  /* ========================================================
   * 1行動
   * ====================================================== */

  private takeAction(actor: EngineUnit): void {
    // --- 1〜2. 行動開始 + 行動不能判定 ---
    // ACTION_START は1行動につき必ず1つだけ出す (フロントが行動の区切りに使うため)。
    // 行動不能なら status にその原因を載せ、text も「動けない」実況にする。
    const reason = isIncapacitated(actor) ? incapacitatingReason(actor) : undefined;
    this.emit('ACTION_START', {
      sourceId: actor.id,
      element: actor.element,
      status: reason,
      text: reason
        ? `${actor.name} は ${STATUS_LABEL[reason]} で動けない！`
        : `${actor.name} の番！`,
    });

    if (reason) {
      // 行動はできないが、状態異常の経過とクールダウン減少・ゲージリセットは行う。
      // (そうしないと凍結が永久に解けず詰む)
      this.endOfAction(actor, false);
      return;
    }

    // --- 3. 覚醒条件チェック ---
    this.checkAwaken(actor);

    // --- 4. AIによるスキル選択 ---
    const decision = decideAction({
      actor,
      allies: this.alliesOf(actor),
      foes: this.foesOf(actor),
      skills: this.ctx.skills,
      profile: this.ctx.aiProfiles.get(actor.aiProfileId),
      turn: this.turn,
      ultMax: this.cfg.ultMax,
      rng: this.rng,
    });
    const skill = decision.skill;

    this.emit('SKILL_USE', {
      sourceId: actor.id,
      targetId: decision.targets[0]?.id,
      skillId: skill.id,
      skillName: skill.name,
      element: skill.effects[0]?.element ?? actor.element,
      fx: skill.fx,
      text: `${actor.name} の ${skill.name}！`,
    });

    actor.skillUseCount.set(skill.id, (actor.skillUseCount.get(skill.id) ?? 0) + 1);

    // 必殺技のコスト消費。ゲージは使った瞬間に減らす。
    if (skill.kind === 'ULTIMATE') {
      const cost = skill.ultCost ?? this.cfg.ultMax;
      actor.ultGauge = Math.max(0, actor.ultGauge - cost);
      actor.ultAnnounced = false;
    }
    // クールダウン設定: この行動の最後に一律 -1 するので +1 して置く
    // (こうすると cooldown:3 が「3回あとの自分の行動で再使用可能」になる)
    if (skill.cooldown > 0) actor.cooldowns.set(skill.id, skill.cooldown + 1);

    // --- 5. 効果適用 ---
    this.applySkillEffects(actor, skill, decision.targets);

    // --- 6〜9 ---
    this.endOfAction(actor, true);
  }

  /** 状態経過・DoT・クールダウン減少・ゲージリセット・必殺ゲージ加算 */
  private endOfAction(actor: EngineUnit, acted: boolean): void {
    // 状態異常の継続効果 -> その後に duration を減らす。
    // 順序が逆だと duration:1 の毒が一度も効かずに消えてしまう。
    if (actor.alive) this.runStatusTick(actor);
    // 死亡していた場合 clearAll 済みなので expired は空になる (呼んでも無害)
    for (const s of advanceStatuses(actor)) {
      this.emit('STATUS_EXPIRE', {
        targetId: actor.id,
        status: s.type,
        text: `${actor.name} の ${STATUS_LABEL[s.type]} が切れた。`,
      });
    }

    // クールダウン減少
    for (const [id, cd] of actor.cooldowns) {
      if (cd > 0) actor.cooldowns.set(id, cd - 1);
    }

    // 必殺ゲージ (行動した場合のみ)
    if (acted && actor.alive) this.gainUlt(actor, this.cfg.ultGainOnAction);

    // 行動ゲージ: 超過分は繰り越す。切り捨てると速度比がじわじわ歪むため。
    actor.gauge = Math.max(0, actor.gauge - this.cfg.gaugeMax);

    // ACTION_END はフロントが行動の区切り(カメラ戻し等)に使うマーカー。text も必ず埋める。
    this.emit('ACTION_END', {
      sourceId: actor.id,
      text: `${actor.name} の行動終了。`,
    });
  }

  private runStatusTick(unit: EngineUnit): void {
    const t = computeStatusTick(unit);
    for (const d of t.damage) {
      if (!unit.alive) break;
      const before = unit.hp;
      unit.hp = Math.max(0, unit.hp - d.value);
      const applied = before - unit.hp;
      unit.stat.damageTaken += applied;
      this.emit('STATUS_TICK', {
        targetId: unit.id,
        status: d.type,
        value: d.value,
        text: `${unit.name} は ${STATUS_LABEL[d.type]} で ${d.value} ダメージ！`,
      });
      if (unit.hp <= 0) this.defeat(unit, undefined);
    }
    for (const h of t.heal) {
      if (!unit.alive) break;
      const before = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + h.value);
      const applied = unit.hp - before;
      this.emit('STATUS_TICK', {
        targetId: unit.id,
        status: h.type,
        value: applied,
        text: `${unit.name} は ${STATUS_LABEL[h.type]} で ${applied} 回復！`,
      });
    }
  }

  private gainUlt(unit: EngineUnit, amount: number): void {
    if (amount === 0) return;
    const max = this.cfg.ultMax;
    unit.ultGauge = Math.min(max, Math.max(0, unit.ultGauge + amount));
    if (unit.ultGauge >= max && !unit.ultAnnounced) {
      unit.ultAnnounced = true;
      this.emit('ULT_READY', {
        sourceId: unit.id,
        value: unit.ultGauge,
        text: `${unit.name} の 必殺ゲージが最大だ！`,
      });
    } else if (unit.ultGauge < max) {
      unit.ultAnnounced = false;
    }
  }

  /* ========================================================
   * スキル効果
   * ====================================================== */

  private applySkillEffects(actor: EngineUnit, skill: Skill, baseTargets: EngineUnit[]): void {
    const tendency = profileTendency(this.ctx.aiProfiles.get(actor.aiProfileId));

    for (const effect of skill.effects) {
      if (!actor.alive) break;
      // 効果ごとに対象が上書きされる場合は再選択。されない場合は選択済みの対象から死者を除く。
      const targets = effect.target
        ? selectTargets(actor, effect.target, this.alliesOf(actor), this.foesOf(actor), this.rng, tendency)
        : baseTargets.filter((t) => t.alive);
      if (targets.length === 0) continue;

      for (const target of targets) {
        if (!target.alive) continue;
        switch (effect.type) {
          case 'DAMAGE': this.effectDamage(actor, target, skill, effect); break;
          case 'HEAL': this.effectHeal(actor, target, skill, effect); break;
          case 'STATUS': this.effectStatus(actor, target, skill, effect); break;
          case 'CLEANSE': this.effectCleanse(target, effect); break;
          case 'GAUGE': this.effectGauge(target, effect); break;
          case 'ULT_GAUGE': this.effectUltGauge(target, effect); break;
          default: break;
        }
      }
    }
  }

  /** ダメージ参照値。scaling が 'hp' なら使用者の最大HP基準(割合ダメージ)。 */
  private scalingValue(unit: EngineUnit, scaling: StatKey | undefined): number {
    const key: StatKey = scaling ?? 'attack';
    if (key === 'hp') return unit.maxHp;
    return effectiveStat(unit, key);
  }

  private effectDamage(actor: EngineUnit, target: EngineUnit, skill: Skill, effect: SkillEffect): void {
    const hits = Math.max(1, Math.round(effect.hits ?? 1));
    const power = effect.power ?? 1;
    const element: Element = effect.element ?? actor.element;
    const affinity = affinityMultiplier(this.affinity as Record<string, Record<string, number>>, element, target.element);

    for (let i = 0; i < hits; i++) {
      if (!target.alive || !actor.alive) break;
      const res = computeDamage({
        attackStat: this.scalingValue(actor, effect.scaling),
        power,
        defense: effectiveStat(target, 'defense'),
        defenseConstant: this.cfg.defenseConstant,
        affinity,
        criticalRate: actor.stats.critical,
        criticalDamage: actor.stats.criticalDamage,
        variance: this.cfg.damageVariance,
        rng: this.rng,
      });

      // SHIELD が肩代わりし、残りがHPに通る
      const { absorbed, through } = absorbWithShield(target, res.value);
      target.hp = Math.max(0, target.hp - through);

      // 与ダメは「出した総量(盾で吸われた分を含む)」、被ダメは「実際にHPが減った量」を集計する
      actor.stat.damageDealt += res.value;
      target.stat.damageTaken += through;

      this.emit('DAMAGE', {
        sourceId: actor.id,
        targetId: target.id,
        skillId: skill.id,
        skillName: skill.name,
        value: res.value,
        critical: res.critical,
        affinity: res.affinity,
        element,
        fx: skill.fx,
        text: damageText(actor.name, skill.name, target.name, res.value, res.critical, res.affinity, absorbed),
      });

      // 被弾で必殺ゲージが溜まる (耐えるほど反撃の芽が出る設計)
      this.gainUlt(target, this.cfg.ultGainOnHit);

      if (target.hp <= 0) { this.defeat(target, actor); break; }
    }
  }

  private effectHeal(actor: EngineUnit, target: EngineUnit, skill: Skill, effect: SkillEffect): void {
    // scaling: 'hp' のときは「対象の最大HP割合」回復、それ以外は術者のステータス基準。
    const scalingStat = effect.scaling === 'hp' ? target.maxHp : this.scalingValue(actor, effect.scaling);
    const res = computeHeal({
      scalingStat,
      power: effect.power ?? 1,
      healingStat: actor.stats.healing,
      variance: this.cfg.damageVariance,
      rng: this.rng,
    });
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + res.value);
    const applied = target.hp - before;
    actor.stat.healing += applied;
    this.emit('HEAL', {
      sourceId: actor.id,
      targetId: target.id,
      skillId: skill.id,
      skillName: skill.name,
      value: applied,
      element: actor.element,
      fx: skill.fx,
      text: `${actor.name} の ${skill.name}！ ${target.name} の HPが ${applied} 回復！`,
    });
  }

  private effectStatus(actor: EngineUnit, target: EngineUnit, skill: Skill, effect: SkillEffect): void {
    if (!effect.status) return;
    const outcome = applyStatus(target, {
      type: effect.status,
      duration: effect.duration ?? 1,
      potency: effect.potency ?? 0,
      sourceId: actor.id,
      chance: effect.chance ?? 100,
      // 自分自身へのバフは抵抗判定しない (status.ts 側でバフは元々素通り)
      ignoreResistance: target.id === actor.id,
    }, this.rng);

    if (outcome.kind === 'RESISTED') {
      this.emit('STATUS_RESIST', {
        sourceId: actor.id,
        targetId: target.id,
        skillId: skill.id,
        skillName: skill.name,
        status: effect.status,
        text: `${target.name} は ${STATUS_LABEL[effect.status]} を弾いた！`,
      });
      return;
    }
    if (outcome.kind === 'MISSED') return;

    this.emit('STATUS_APPLY', {
      sourceId: actor.id,
      targetId: target.id,
      skillId: skill.id,
      skillName: skill.name,
      status: effect.status,
      duration: outcome.status.duration,
      value: outcome.status.potency,
      fx: skill.fx,
      text: statusApplyText(target.name, effect.status),
    });
  }

  private effectCleanse(target: EngineUnit, effect: SkillEffect): void {
    const removed = cleanseDebuffs(target, effect.hits);
    for (const s of removed) {
      this.emit('STATUS_EXPIRE', {
        targetId: target.id,
        status: s.type,
        text: `${target.name} の ${STATUS_LABEL[s.type]} が解除された！`,
      });
    }
  }

  private effectGauge(target: EngineUnit, effect: SkillEffect): void {
    // amount は gaugeMax に対する % (100 なら1行動ぶん丸ごと)
    const delta = (this.cfg.gaugeMax * (effect.amount ?? 0)) / 100;
    if (delta === 0) return;
    target.gauge = Math.max(0, target.gauge + delta);
    const pct = effect.amount ?? 0;
    this.emit('GAUGE_CHANGE', {
      targetId: target.id,
      value: Math.round(delta * 100) / 100,
      text: `${target.name} の 行動ゲージが ${pct > 0 ? '+' : ''}${pct}% ${pct > 0 ? '上昇' : '低下'}！`,
    });
  }

  private effectUltGauge(target: EngineUnit, effect: SkillEffect): void {
    const delta = (this.cfg.ultMax * (effect.amount ?? 0)) / 100;
    if (delta === 0) return;
    const before = target.ultGauge;
    this.gainUlt(target, delta);
    this.emit('GAUGE_CHANGE', {
      targetId: target.id,
      value: Math.round((target.ultGauge - before) * 100) / 100,
      text: `${target.name} の 必殺ゲージが ${effect.amount}% 変動！`,
    });
  }

  /* ========================================================
   * 撃破 / 覚醒
   * ====================================================== */

  private defeat(unit: EngineUnit, killer: EngineUnit | undefined): void {
    if (!unit.alive) return;
    unit.alive = false;
    unit.hp = 0;
    unit.gauge = 0;
    unit.stat.survived = false;
    clearAll(unit); // 死亡時に状態異常は全消去 (蘇生実装時もクリーンな状態から始められる)
    if (killer) killer.stat.kills += 1;
    this.emit('DEFEAT', {
      sourceId: killer?.id,
      targetId: unit.id,
      text: `${unit.name} は 倒れた！`,
    });
  }

  /**
   * 覚醒判定。条件は「書かれているものすべて」を満たしたときに成立 (AND)。1戦闘に1回だけ。
   */
  private checkAwaken(unit: EngineUnit): void {
    const aw = unit.awakening;
    if (!aw || unit.awakened) return;
    const c = aw.condition;
    const alliesAll = this.units.filter((u) => u.side === unit.side);
    const foesAll = this.units.filter((u) => u.side !== unit.side);

    if (c.hpBelow !== undefined && hpRatio(unit) > c.hpBelow) return;
    if (c.skillUsed && (unit.skillUseCount.get(c.skillUsed.skill) ?? 0) < c.skillUsed.count) return;
    if (c.allyDefeated !== undefined
      && alliesAll.filter((u) => u.id !== unit.id && !u.alive).length < c.allyDefeated) return;
    if (c.enemyDefeated !== undefined
      && foesAll.filter((u) => !u.alive).length < c.enemyDefeated) return;
    if (c.turnAtLeast !== undefined && this.turn < c.turnAtLeast) return;
    if (c.withAlly !== undefined
      && !alliesAll.some((u) => u.id !== unit.id && (u.defId === c.withAlly || u.id === c.withAlly))) return;

    this.awaken(unit, aw);
  }

  private awaken(unit: EngineUnit, aw: Awakening): void {
    unit.awakened = true;

    // ステータス補正 (%)。HPは最大値と現在値を同量だけ引き上げる = 覚醒で即死しない。
    for (const [k, pct] of Object.entries(aw.statBonus ?? {})) {
      const key = k as StatKey;
      if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
      if (key === 'hp') {
        const newMax = Math.max(1, Math.round(unit.maxHp * (1 + pct / 100)));
        const gain = newMax - unit.maxHp;
        unit.maxHp = newMax;
        unit.stats.hp = newMax;
        unit.hp = Math.min(newMax, unit.hp + Math.max(0, gain));
      } else {
        unit.stats[key] = unit.stats[key] * (1 + pct / 100);
      }
    }

    // スキル置換 { 元ID: 新ID }
    for (const [from, to] of Object.entries(aw.skillReplace ?? {})) {
      if (unit.normalAttackId === from) unit.normalAttackId = to;
      if (unit.ultimateId === from) unit.ultimateId = to;
      unit.skillIds = unit.skillIds.map((s) => (s === from ? to : s));
      // 置換先のクールダウンは引き継がない (別スキル扱い)
      unit.cooldowns.delete(from);
    }

    // 覚醒付与の状態 (抵抗判定なしで確実に乗せる)
    for (const g of aw.grant ?? []) {
      applyStatus(unit, {
        type: g.status, duration: g.duration, potency: g.potency ?? 0,
        sourceId: unit.id, ignoreResistance: true,
      }, this.rng);
    }

    this.emit('AWAKEN', {
      sourceId: unit.id,
      targetId: unit.id,
      skillId: aw.id,
      skillName: aw.name,
      element: unit.element,
      fx: aw.fx,
      text: `${unit.name} 覚醒 ―― ${aw.name}！`,
    });
  }

  /* ========================================================
   * 決着
   * ====================================================== */

  private checkBattleEnd(): boolean {
    const allyAlive = this.aliveOf('ALLY').length;
    const enemyAlive = this.aliveOf('ENEMY').length;
    if (allyAlive > 0 && enemyAlive > 0) return false;

    if (allyAlive === 0 && enemyAlive === 0) {
      this.victory = false;
      this.endReason = '相討ち ―― 全滅につき敗北扱い';
    } else if (enemyAlive === 0) {
      this.victory = true;
      this.endReason = '敵を全滅させた';
    } else {
      this.victory = false;
      this.endReason = '味方が全滅した';
    }
    this.emitBattleEnd();
    return true;
  }

  /** maxTicks 超過などの時間切れ: 残HP割合の合計が多い側の勝ち。同値なら敗北扱い。 */
  private resolveTimeout(reason: string): void {
    const sum = (side: Side): number =>
      this.units.filter((u) => u.side === side)
        .reduce((acc, u) => acc + (u.alive ? hpRatio(u) : 0), 0);
    const ally = sum('ALLY');
    const enemy = sum('ENEMY');
    this.victory = ally > enemy;
    const fmt = (n: number): string => (Math.round(n * 10) / 10).toFixed(1);
    this.endReason = `${reason}（${this.tick}T） ―― 残HP率合計 味方 ${fmt(ally)}% / 敵 ${fmt(enemy)}% → `
      + (this.victory ? '味方の勝ち' : '同値以下のため敗北扱い');
    this.emitBattleEnd();
  }

  private emitBattleEnd(): void {
    this.finished = true;
    const head = this.victory ? '勝利！' : '敗北…';
    this.emit('BATTLE_END', {
      value: this.victory ? 1 : 0,
      text: `${head} ${this.endReason}`,
    });
  }

  private buildResult(): BattleResult {
    for (const u of this.units) u.stat.survived = u.alive;
    return {
      victory: this.victory,
      ticks: this.tick,
      turns: this.turn,
      stats: this.units.map((u) => ({ ...u.stat })),
    };
  }

  /**
   * ログID。実時刻を混ぜず、シードと参加者から決定論的に作る。
   * 同じ戦闘を再実行したら同じIDになる = リプレイの同一性検証に使える。
   */
  private logId(): string {
    const canonical = [
      this.ctx.seed,
      this.ctx.stageId ?? '-',
      ...this.units.map((u) => `${u.side}:${u.slot}:${u.defId}:${u.level}:${u.maxHp}`),
    ].join('|');
    return `bl_${(this.ctx.seed >>> 0).toString(36)}_${fnv1a(canonical).toString(36)}`;
  }
}

/* ============================================================
 * テキスト生成 (演出の実況風1行)
 * ========================================================== */

function damageText(
  actor: string, skillName: string, target: string,
  value: number, critical: boolean, affinity: number, absorbed: number,
): string {
  let s = `${actor} の ${skillName}！ ${target} に ${value} ダメージ！`;
  if (critical) s += '(会心)';
  if (affinity > 1.001) s += '(効果は抜群だ！)';
  else if (affinity < 0.999) s += '(効果はいまひとつ…)';
  if (absorbed > 0) s += `(シールドが ${absorbed} 肩代わり)`;
  return s;
}

/** バフは「〜が上がった」、デバフは「〜状態になった」で語調を分ける */
const BUFFY: readonly StatusType[] = ['ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT'];
function statusApplyText(target: string, type: StatusType): string {
  const label = STATUS_LABEL[type];
  if (type === 'SHIELD') return `${target} に ${label} が張られた！`;
  if (type === 'TAUNT') return `${target} が敵を引きつけている！`;
  if (BUFFY.includes(type)) return `${target} の ${label}！`;
  return `${target} は ${label} 状態になった！`;
}

/* ============================================================
 * ユーティリティ
 * ========================================================== */

/** EngineUnit から BattleUnit 部分だけを取り出す (実行時フィールドをログに漏らさない) */
function toBattleUnit(u: EngineUnit): BattleUnit {
  return {
    id: u.id, side: u.side, slot: u.slot, name: u.name, defId: u.defId, element: u.element,
    roles: [...u.roles], level: u.level, stats: { ...u.stats }, hp: u.hp, maxHp: u.maxHp,
    gauge: u.gauge, ultGauge: u.ultGauge, statuses: u.statuses.map((s) => ({ ...s })),
    alive: u.alive, awakened: u.awakened, art: u.art, rarity: u.rarity,
  };
}

/** 文字列 -> 32bit ハッシュ (FNV-1a)。ログIDの決定論的生成用。 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 契約 (contract.ts) の RunBattle 実装。
 * 副作用なし・決定論的・rewards は付けない (API層の責務)。
 */
export const runBattle: RunBattle = (allies, enemies, ctx): BattleLog => {
  return new BattleRunner(allies, enemies, ctx).run();
};
