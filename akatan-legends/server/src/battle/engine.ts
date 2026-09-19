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
import {
  ELEMENTS,
  type ActiveStatus, type AffinityTable, type Awakening, type BattleEvent, type BattleEventType,
  type BattleLog, type BattleResult, type BattleUnit, type BattleUnitSnapshot, type BattleUnitStat,
  type ComboDef, type ComboEffect, type Element, type ItemSpecialEffect, type ProgressionConfig,
  type Side, type Skill, type SkillEffect, type StatKey, type StatusType,
} from '@akatan/shared';
import type { BattleContext, CombatantInput, RunBattle } from './contract.js';
import { createRng, type Rng } from './rng.js';
import { affinityMultiplier, computeDamage, computeHeal } from './damage.js';
import {
  advanceStatuses, absorbWithShield, applyStatus, cleanseDebuffs, clearAll, computeStatusTick,
  effectiveStat, hasStatus, incapacitatingReason, isIncapacitated, STATUS_LABEL,
} from './status.js';
import { decideAction, hpRatio, selectTargets, profileTendency, type AiUnit } from './ai.js';
import { qualifyCombos, type ComboRuntime } from './combo.js';
import { rollSpecialChance, specialFx, specialsOf } from './specials.js';

type BattleConfig = ProgressionConfig['battle'];

/** 実行時ユニット。BattleUnit + AI用情報 + 集計。 */
interface EngineUnit extends AiUnit {
  awakening?: Awakening;
  /** スキルID -> 使用回数 (覚醒条件 skillUsed 用) */
  skillUseCount: Map<string, number>;
  /** 必殺ゲージMAXを既に告知済みか (ULT_READY を毎行動出さないため) */
  ultAnnounced: boolean;
  stat: BattleUnitStat;
  /** 装備から解決済みの特殊効果 (CombatantInput.specials をそのまま保持)。省略時は空配列扱い。 */
  specials?: ItemSpecialEffect[];
  /**
   * 転生の SKILL_POWER 補正を事前に乗数化した値 (1 = 補正なし)。
   * CombatantInput.rebirthMods.skillPowerPercent が未指定なら必ず 1 になる。
   * effectDamage/effectHeal で effect.power に掛けるだけの純粋な倍率で、
   * 乱数を一切消費しないので決定論には影響しない。
   */
  skillPowerMul: number;
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

/**
 * RebirthCombatMods の数値フィールドの防御的正規化。data不整合(NaN/undefined)で
 * NaN が全計算に伝播しないよう、常に有限な数値(既定0)を返す。乱数は使わない。
 */
function safePercent(v: number | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/**
 * 転生の GAUGE_START / ULT_GAUGE_START (§17〜§19) を「戦闘開始時の初期ゲージ実値」に変換する。
 * effectGauge/effectUltGauge と同じ「gaugeMax(または ultMax) に対する%」という規約に揃える。
 * pct 未指定/NaN なら 0 (= 従来通りゲージ0から開始)。[0, max] にクランプするので、
 * ULT_GAUGE_START が100%を超えて持ち越されることはない。乱数は使わない。
 */
function resolveInitialGaugePercent(pct: number | undefined, max: number): number {
  const p = safePercent(pct);
  return Math.min(max, Math.max(0, (max * p) / 100));
}

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
  /**
   * 成立済みコンボの実行時状態。ctx.combos 省略時は空配列
   * (以後のコンボ判定は全て length===0 で早期returnし、既存の挙動に一切影響しない)。
   */
  private readonly comboRuntimes: ComboRuntime[];
  /**
   * 装備の特殊効果の「1行動1回まで」上限を管理する状態 (unitId -> 発動済み specialId 集合)。
   * takeAction() の先頭で毎回クリアする = 1つの enclosing action (コンボの追撃を含む)の中で
   * 同じユニットの同じ特殊効果は高々1回しか発動しない。
   * これが ON_ATTACK の bonusDamage が多段ヒット/複数対象/コンボ追撃で暴発したり、
   * 無限に近い連鎖を起こしたりしないための安全弁 (無限ループ防止)。
   * ON_BATTLE_START はこのクリアより前 (行動ループ開始前) に1度だけ使うので、
   * 初期状態が空であることに依存している (問題なし: フィールド初期値が空Map)。
   */
  private readonly firedSpecialsThisAction = new Map<string, Set<string>>();

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
    // コンボの成立判定は味方の編成(defId)だけを見て、戦闘開始時に1回だけ行う。
    this.comboRuntimes = ctx.combos ? qualifyCombos(allies, ctx.combos) : [];
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
    const mods = c.rebirthMods;
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
      // 転生の GAUGE_START / ULT_GAUGE_START (§17〜§19)。mods 未指定なら resolveInitialGaugePercent が
      // 常に0を返すので、従来通り「行動ゲージ0・必殺ゲージ0から開始」になる。
      // ここで設定するのはコンストラクタ内(=戦闘開始前)の1回だけで、以後の行動では再適用しない。
      gauge: resolveInitialGaugePercent(mods?.gaugeStart, this.cfg.gaugeMax),
      ultGauge: resolveInitialGaugePercent(mods?.ultGaugeStart, this.cfg.ultMax),
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
      specials: c.specials,
      // 転生の SKILL_POWER (§17〜§19)。未指定 (skillPowerPercent === undefined) なら 1 = 補正なし。
      skillPowerMul: 1 + safePercent(mods?.skillPowerPercent) / 100,
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
          // actionDuration 指定時は duration の代わりにそちらを使う (effectStatus と同じ規約)。
          duration: e.actionDuration ?? e.duration ?? 9999,
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
    'GAUGE_CHANGE', 'DEFEAT', 'AWAKEN', 'COMBO', 'BATTLE_END',
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
    this.fireBattleStartCombos();
    this.fireBattleStartSpecials();
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
      // 実時刻をエンジン内で取得しない(P1-1): 呼び出し側が注入した ctx.now を入れるだけにする。
      // これで「同シード同入力ならログ全体が完全一致する」が createdAt を含めても成り立つ。
      createdAt: this.ctx.now ?? '',
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
    // 装備の特殊効果「1行動1回」上限をこの行動の分だけリセットする。
    // (コンボの追撃はこの takeAction 呼び出しの中で同期的に実行されるため、
    //  コンボ追撃者の特殊効果もこの行動の枠を共有する = 意図した挙動)
    this.firedSpecialsThisAction.clear();

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

    // randomEffect: 効果をランダムに1つだけ選ぶ。乱数消費はここで rng.pick 1回だけ
    // (「1つの技の発動」につき1回。resolveEffects は他の呼び出し元(コンボ経由の
    // applySkillEffects)でも同じ規約で1回だけ呼ぶ)。
    // ここで先に選んでおくことで、SKILL_USE の時点で「どの効果が選ばれたか」を
    // テキストに残せる(選ばれなかった効果は以後一切参照されない = 見た目にも影響しない)。
    const effectsToApply = this.resolveEffects(skill);
    const primaryEffect = effectsToApply[0];
    const announceTarget = decision.targets[0];
    // adaptElement: 対象の弱点属性を採用する。乱数は使わない(テーブル参照のみ)。
    const announceElement: Element = primaryEffect?.adaptElement && announceTarget
      ? this.adaptedElement(announceTarget.element)
      : (primaryEffect?.element ?? actor.element);

    this.emit('SKILL_USE', {
      sourceId: actor.id,
      targetId: announceTarget?.id,
      skillId: skill.id,
      skillName: skill.name,
      element: announceElement,
      fx: skill.fx,
      text: skill.randomEffect && primaryEffect
        ? `${actor.name} の ${skill.name}！（${this.describeEffect(primaryEffect)}）`
        : `${actor.name} の ${skill.name}！`,
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
    // effectsToApply は SKILL_USE 直前に resolveEffects() で確定済み(rng.pick はそこで1回消費済み)。
    // ここで再度 resolveEffects を呼ばない = randomEffect スキルの乱数消費が2回になるのを防ぐ。
    this.applySkillEffects(actor, skill, decision.targets, effectsToApply);

    // --- 5.5 コンボ判定 (ON_SKILL_USE) ---
    // 「使った直後」なので、効果適用(ダメージ等)が全部終わった後に判定する。
    this.checkComboOnSkillUse(actor, skill);

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

    // コンボのクールダウン減少。「発動キャラの行動回数基準」= このコンボを発動できる
    // どちらかのキャラ(eligibleActorDefIds)が行動するたびに1減る。
    if (this.comboRuntimes.length > 0) {
      for (const runtime of this.comboRuntimes) {
        if (runtime.cooldownRemaining > 0 && runtime.eligibleActorDefIds.has(actor.defId)) {
          runtime.cooldownRemaining -= 1;
        }
      }
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
      // INVULNERABLE: DoT を含め、受けるダメージは常に0になる。
      // computeStatusTick は無敵を知らない(HPへの反映はエンジン側の責務、との既存方針どおり)ので、
      // ここで弾く。素の「applied<=0なら出さない」ガード(下の通常経路)とは別に、
      // 無敵で防いだこと自体をプレイヤーに見せたいので、value:0 の STATUS_TICK を明示的に出す
      // (通常の 0 ダメージ抑止とは違う理由の0なので、あえて出す判断)。
      if (hasStatus(unit, 'INVULNERABLE')) {
        this.emit('STATUS_TICK', {
          targetId: unit.id,
          status: d.type,
          value: 0,
          text: `${unit.name} は無敵状態で ${STATUS_LABEL[d.type]} のダメージを受けない！`,
        });
        continue;
      }
      const before = unit.hp;
      unit.hp = Math.max(0, unit.hp - d.value);
      const applied = before - unit.hp;
      // 生存中は hp>0 かつ d.value>=1 保証なので applied は事実上常に>0 だが、
      // 将来の計算変更に対する安全弁として P0-2 のガードは入れておく。
      if (applied <= 0) continue;
      unit.stat.damageTaken += applied;
      this.emit('STATUS_TICK', {
        targetId: unit.id,
        status: d.type,
        value: applied,
        text: `${unit.name} は ${STATUS_LABEL[d.type]} で ${applied} ダメージ！`,
      });
      if (unit.hp <= 0) this.defeat(unit, undefined);
      else this.checkComboHpBelow(unit);
    }
    for (const h of t.heal) {
      if (!unit.alive) break;
      const before = unit.hp;
      unit.hp = Math.min(unit.maxHp, unit.hp + h.value);
      const applied = unit.hp - before;
      // P0-2 の根本原因: computeStatusTick の h.value 自体は Math.max(1, ...) で
      // 最低1回復を保証しているが、対象が既に満タンHPだと Math.min(maxHp, ...) で
      // 実際の増分(applied)が0に落ちる。「再生で0回復」はここで発生する。
      // potency の計算そのものにバグは無く、クランプによる「見かけの0」なので、
      // イベントを出さない(=状態が変わっていないので出さなくて良い)ことで解決する。
      if (applied <= 0) continue;
      this.emit('STATUS_TICK', {
        targetId: unit.id,
        status: h.type,
        value: applied,
        text: `${unit.name} は ${STATUS_LABEL[h.type]} で ${applied} 回復！`,
      });
      this.checkComboHpBelow(unit);
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

  /**
   * randomEffect: true のスキルは effects から**ランダムに1つだけ**を適用する。
   * 乱数消費はここで rng.pick を1回だけ (呼び出し元がこのメソッドを1回呼ぶごとに1回)。
   * false/未指定のスキルは skill.effects をそのまま返し、乱数は一切消費しない
   * (= randomEffect を使わない既存スキルの決定論・乱数消費列には一切影響しない)。
   */
  private resolveEffects(skill: Skill): SkillEffect[] {
    if (skill.randomEffect && skill.effects.length > 0) {
      return [this.rng.pick(skill.effects)];
    }
    return skill.effects;
  }

  /** randomEffect のログ表示用に、効果の種別を簡潔な日本語にする。 */
  private describeEffect(effect: SkillEffect | undefined): string {
    if (!effect) return '';
    if (effect.status) return STATUS_LABEL[effect.status];
    switch (effect.type) {
      case 'DAMAGE': return 'ダメージ';
      case 'HEAL': return '回復';
      case 'CLEANSE': return '状態解除';
      case 'GAUGE': return '行動ゲージ';
      case 'ULT_GAUGE': return '必殺ゲージ';
      default: return effect.type;
    }
  }

  /**
   * adaptElement: 対象が「弱点とする属性」を返す = 対象への攻撃倍率が最も高くなる属性。
   * ELEMENTS の並び順で走査し、厳密な '>' でだけ更新するので、同率の場合は必ず
   * 並び順で先頭のものが残る(決定論)。テーブル参照のみで乱数は一切使わない。
   */
  private adaptedElement(defender: Element): Element {
    let best: Element = ELEMENTS[0];
    let bestMul = -Infinity;
    for (const el of ELEMENTS) {
      const mul = affinityMultiplier(this.affinity as Record<string, Record<string, number>>, el, defender);
      if (mul > bestMul) {
        bestMul = mul;
        best = el;
      }
    }
    return best;
  }

  private applySkillEffects(
    actor: EngineUnit, skill: Skill, baseTargets: EngineUnit[], effects: SkillEffect[] = skill.effects,
  ): void {
    const tendency = profileTendency(this.ctx.aiProfiles.get(actor.aiProfileId));

    for (const effect of effects) {
      if (!actor.alive) break;
      // 効果ごとに対象が上書きされる場合は再選択。されない場合は選択済みの対象から死者を除く。
      const targets = effect.target
        ? selectTargets(actor, effect.target, this.alliesOf(actor), this.foesOf(actor), this.rng, tendency)
        : baseTargets.filter((t) => t.alive);
      if (targets.length === 0) continue;

      // P0-3: 同一効果が複数対象へ連続適用される場合、2件目以降の対象は grouped:true にする。
      // (フロントが「味方全体に〜」のように1行へまとめられるようにするため)
      // 判断基準は「targets 配列での順番」であり、1ユニット内の複数ヒット(effectDamage の
      // hits ループ等)はここでは関与しない = 多段攻撃の各ヒットは個別に表示され続ける。
      targets.forEach((target, idx) => {
        if (!target.alive) return;
        const grouped = idx > 0;
        switch (effect.type) {
          case 'DAMAGE': this.effectDamage(actor, target, skill, effect, grouped); break;
          case 'HEAL': this.effectHeal(actor, target, skill, effect, grouped); break;
          case 'STATUS': this.effectStatus(actor, target, skill, effect, grouped); break;
          case 'CLEANSE': this.effectCleanse(target, effect, grouped); break;
          case 'GAUGE': this.effectGauge(target, effect, grouped); break;
          case 'ULT_GAUGE': this.effectUltGauge(target, effect, grouped); break;
          default: break;
        }
      });
    }
  }

  /** ダメージ参照値。scaling が 'hp' なら使用者の最大HP基準(割合ダメージ)。 */
  private scalingValue(unit: EngineUnit, scaling: StatKey | undefined): number {
    const key: StatKey = scaling ?? 'attack';
    if (key === 'hp') return unit.maxHp;
    return effectiveStat(unit, key);
  }

  private effectDamage(
    actor: EngineUnit, target: EngineUnit, skill: Skill, effect: SkillEffect, grouped = false,
  ): void {
    const hits = Math.max(1, Math.round(effect.hits ?? 1));
    // 転生の SKILL_POWER (§17〜§19): actor.skillPowerMul は rebirthMods 未指定なら常に1なので、
    // ここで乗じても既存の呼び出し(乱数消費・数値)には一切影響しない。
    const power = (effect.power ?? 1) * actor.skillPowerMul;
    // adaptElement: 対象の弱点属性(=対象への倍率が最も高い属性)で計算する。element 指定より優先。
    // adaptedElement はテーブル参照のみで乱数を使わないため、決定論・乱数消費には影響しない。
    const element: Element = effect.adaptElement
      ? this.adaptedElement(target.element)
      : (effect.element ?? actor.element);
    const affinity = affinityMultiplier(this.affinity as Record<string, Record<string, number>>, element, target.element);

    for (let i = 0; i < hits; i++) {
      if (!target.alive || !actor.alive) break;

      // INVULNERABLE: 受けるダメージを常に0にする(撃破もされない)。
      // ダメージ計算自体を丸ごとスキップする = 乱数(会心判定・乱数幅)を一切消費しない
      // (INVULNERABLE を使わない既存スキル/戦闘の乱数消費列には一切影響しない)。
      // 「防いだ」ことが分かるよう、value:0 の DAMAGE イベントを明示的に出す。
      // (通常の DAMAGE は最低1ダメージ保証で value===0 になり得ないため、
      //  このイベント自体が「無効化された」ことのシグナルになる。抑止せずそのまま出す判断)
      // 被弾ゲージ加算・ON_ATTACK/ON_HIT_TAKEN 特殊効果も「実際に何も起きていない」ので発火させない。
      if (hasStatus(target, 'INVULNERABLE')) {
        this.emit('DAMAGE', {
          sourceId: actor.id,
          targetId: target.id,
          skillId: skill.id,
          skillName: skill.name,
          value: 0,
          critical: false,
          affinity,
          element,
          fx: skill.fx,
          text: `${actor.name} の ${skill.name}！ ${target.name} は無敵状態で無効化した！`,
          ...(grouped && i === 0 ? { grouped: true } : {}),
        });
        continue;
      }

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

      // 注: computeDamage は最低1ダメージを保証するため res.value は事実上0にならない。
      // 盾が全部吸っても「当てた」事実自体は演出上意味があるので、DAMAGE は抑止しない (P0-2 対象外)。
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
        // grouped は「複数対象の何体目か」の話なので、1体への多段ヒットの2発目以降には付けない。
        ...(grouped && i === 0 ? { grouped: true } : {}),
      });

      // 被弾で必殺ゲージが溜まる (耐えるほど反撃の芽が出る設計)
      this.gainUlt(target, this.cfg.ultGainOnHit);

      // 装備の特殊効果 (ON_ATTACK): 追撃ダメージ・状態異常付与。
      // 撃破判定(target.hp<=0)より先に処理することで、bonusDamage そのもので撃破した場合も
      // 下の1箇所の defeat()/ON_KILL 経路にそのまま合流する(defeat() の二重発火が起きない)。
      this.triggerOnAttackSpecials(actor, target);

      if (target.hp <= 0) {
        this.defeat(target, actor);
        this.triggerOnKillSpecials(actor);
        break;
      }
      this.checkComboHpBelow(target);
      // 装備の特殊効果 (ON_HIT_TAKEN): 被弾側の自己バフなど。target が生存している時のみ意味がある。
      this.triggerOnHitTakenSpecials(target);
    }
  }

  private effectHeal(
    actor: EngineUnit, target: EngineUnit, skill: Skill, effect: SkillEffect, grouped = false,
  ): void {
    // scaling: 'hp' のときは「対象の最大HP割合」回復、それ以外は術者のステータス基準。
    const scalingStat = effect.scaling === 'hp' ? target.maxHp : this.scalingValue(actor, effect.scaling);
    // 転生の SKILL_POWER (§17〜§19): effectDamage と同じ規約 (skillPowerMul は未指定なら1)。
    const res = computeHeal({
      scalingStat,
      power: (effect.power ?? 1) * actor.skillPowerMul,
      healingStat: actor.stats.healing,
      variance: this.cfg.damageVariance,
      rng: this.rng,
    });
    const before = target.hp;
    target.hp = Math.min(target.maxHp, target.hp + res.value);
    const applied = target.hp - before;
    // P0-2: computeHeal 自体は最低1回復を保証するが、対象が既に満タンなら
    // Math.min(maxHp, ...) で実際の増分(applied)が0に落ちる。これが「再生で0回復」の実態
    // (potency の計算自体は正しく、常に applied<=nominal になる clamp が原因)。
    // 状態が変わっていないのでイベントも出さない。
    if (applied <= 0) return;
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
      ...(grouped ? { grouped: true } : {}),
    });
    this.checkComboHpBelow(target);
  }

  private effectStatus(
    actor: EngineUnit, target: EngineUnit, skill: Skill, effect: SkillEffect, grouped = false,
  ): void {
    if (!effect.status) return;
    const outcome = applyStatus(target, {
      type: effect.status,
      // actionDuration: 「自身の行動回数」で切れる状態を指定したい場合の別名。
      // ActiveStatus.duration の単位は元々「そのユニット自身の行動回数」(advanceStatuses参照)
      // なので意味は重複している。無理に別実装せず、指定されていれば duration へそのまま
      // 流し込むだけにする(シンプルさ優先の判断)。
      duration: effect.actionDuration ?? effect.duration ?? 1,
      potency: effect.potency ?? 0,
      sourceId: actor.id,
      chance: effect.chance ?? 100,
      // 自分自身へのバフは抵抗判定しない (status.ts 側でバフは元々素通り)
      ignoreResistance: target.id === actor.id,
    }, this.rng);

    if (outcome.kind === 'IMMUNE') {
      // IMMUNE: RESISTED (耐性ロールで弾かれた) とは別の理由なので、テキストで区別する。
      this.emit('STATUS_RESIST', {
        sourceId: actor.id,
        targetId: target.id,
        skillId: skill.id,
        skillName: skill.name,
        status: effect.status,
        text: `${target.name} は状態異常を受け付けない！`,
        ...(grouped ? { grouped: true } : {}),
      });
      return;
    }
    if (outcome.kind === 'RESISTED') {
      this.emit('STATUS_RESIST', {
        sourceId: actor.id,
        targetId: target.id,
        skillId: skill.id,
        skillName: skill.name,
        status: effect.status,
        text: `${target.name} は ${STATUS_LABEL[effect.status]} を弾いた！`,
        ...(grouped ? { grouped: true } : {}),
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
      ...(grouped ? { grouped: true } : {}),
    });
  }

  private effectCleanse(target: EngineUnit, effect: SkillEffect, grouped = false): void {
    const removed = cleanseDebuffs(target, effect.hits);
    removed.forEach((s, i) => {
      this.emit('STATUS_EXPIRE', {
        targetId: target.id,
        status: s.type,
        text: `${target.name} の ${STATUS_LABEL[s.type]} が解除された！`,
        // 1体が複数状態を同時解除する内側のループは対象外。あくまで「何体目か」だけを見る。
        ...(grouped && i === 0 ? { grouped: true } : {}),
      });
    });
  }

  private effectGauge(target: EngineUnit, effect: SkillEffect, grouped = false): void {
    // amount は gaugeMax に対する % (100 なら1行動ぶん丸ごと)
    const delta = (this.cfg.gaugeMax * (effect.amount ?? 0)) / 100;
    if (delta === 0) return;
    const before = target.gauge;
    target.gauge = Math.max(0, target.gauge + delta);
    const applied = target.gauge - before;
    // P0-2: 下限0でクランプされ、既に0のゲージをさらに減らそうとした場合などに実際の変化が0になる。
    if (applied === 0) return;
    const pct = effect.amount ?? 0;
    this.emit('GAUGE_CHANGE', {
      targetId: target.id,
      value: Math.round(applied * 100) / 100,
      text: `${target.name} の 行動ゲージが ${pct > 0 ? '+' : ''}${pct}% ${pct > 0 ? '上昇' : '低下'}！`,
      ...(grouped ? { grouped: true } : {}),
    });
  }

  private effectUltGauge(target: EngineUnit, effect: SkillEffect, grouped = false): void {
    const delta = (this.cfg.ultMax * (effect.amount ?? 0)) / 100;
    if (delta === 0) return;
    const before = target.ultGauge;
    this.gainUlt(target, delta);
    const applied = target.ultGauge - before;
    // P0-2: 既に満タン/0で clamp され、実際の変化が0になるケースを抑止する。
    if (applied === 0) return;
    this.emit('GAUGE_CHANGE', {
      targetId: target.id,
      value: Math.round(applied * 100) / 100,
      text: `${target.name} の 必殺ゲージが ${effect.amount}% 変動！`,
      ...(grouped ? { grouped: true } : {}),
    });
  }

  /* ========================================================
   * 装備の特殊効果 (ItemSpecialEffect)
   * ------------------------------------------------------------
   * 設計は combo.ts / 上の「キャラクターコンボ」節と同じ思想:
   *   - 判定 (どの特殊効果が対象か) は specials.ts の純粋関数 (specialsOf/rollSpecialChance) に任せる。
   *   - 発動 (乱数を引く・ダメージ/状態を適用する・イベントを出す) はここ engine.ts が行う。
   *
   * 乱数消費順序 (1つの特殊効果につき):
   *   1) markSpecialFired によるチェック (乱数不使用。1行動1回の上限)
   *   2) rollSpecialChance (special.chance が100未満の時だけ rng.chance を1回消費)
   *   3) status 付与時: applyStatus 内部の抵抗判定 (ignoreResistance=false の場合のみ、resistance>0なら1回消費)
   *   4) bonusDamage 適用時: computeDamage 内部の 会心判定+乱数幅 で必ず2回消費
   * この順序を変えると同シードでもログがズレるため、特殊効果の追加・改修時は必ず維持すること。
   *
   * CombatantInput.specials が未指定(空配列扱い)のユニットでは specialsOf が毎回空配列を返し、
   * 上のどの手順も一切実行されない = 乱数消費が1回も増えない(既存84件のリプレイ互換性はこれで担保)。
   * ====================================================== */

  /** 1行動(takeAction 1回、コンボの追撃を含む)につき、同じユニット+同じ特殊効果は高々1回だけ発動を許す。 */
  private markSpecialFired(unitId: string, specialId: string): boolean {
    let fired = this.firedSpecialsThisAction.get(unitId);
    if (!fired) {
      fired = new Set();
      this.firedSpecialsThisAction.set(unitId, fired);
    }
    if (fired.has(specialId)) return false;
    fired.add(specialId);
    return true;
  }

  /** 戦闘開始時: 全ユニット(味方→敵、slot昇順=this.units の並び順)の ON_BATTLE_START を1回ずつ判定する。 */
  private fireBattleStartSpecials(): void {
    for (const u of this.units) {
      for (const special of specialsOf(u.specials, 'ON_BATTLE_START')) {
        if (!this.markSpecialFired(u.id, special.id)) continue;
        if (!rollSpecialChance(special, this.rng)) continue;
        if (!special.status) continue;
        // 自分自身への付与。パッシブの自己バフ(toUnit)と同じく抵抗判定はスキップする。
        this.applySpecialStatus(special, u.id, u, true);
      }
    }
  }

  /** actor が target にダメージを与えた直後。追撃ダメージ・状態異常付与を試みる。 */
  private triggerOnAttackSpecials(actor: EngineUnit, target: EngineUnit): void {
    for (const special of specialsOf(actor.specials, 'ON_ATTACK')) {
      if (!this.markSpecialFired(actor.id, special.id)) continue;
      if (!rollSpecialChance(special, this.rng)) continue;
      // 本命の一撃で既に致命傷(hp<=0)なら、追撃/付与は意味が無い(defeat()はまだ呼ばれておらず
      // target.alive はまだ true だが、hp<=0 の相手に状態を乗せても直後の defeat() の
      // clearAll で即座に消えるだけなので、ここで打ち切ってログを綺麗に保つ)。
      // 撃破そのものは呼び出し元 (effectDamage) が ON_KILL として別途処理する。
      if (target.hp <= 0) continue;
      if (special.status) this.applySpecialStatus(special, actor.id, target, false);
      if (special.bonusDamage) this.applySpecialBonusDamage(special, actor, target);
    }
  }

  /** target が被弾した直後(かつ生存中)。自分自身への状態異常付与(防御バフ等)を試みる。 */
  private triggerOnHitTakenSpecials(target: EngineUnit): void {
    for (const special of specialsOf(target.specials, 'ON_HIT_TAKEN')) {
      if (!this.markSpecialFired(target.id, special.id)) continue;
      if (!rollSpecialChance(special, this.rng)) continue;
      if (!special.status) continue;
      this.applySpecialStatus(special, target.id, target, true);
    }
  }

  /** actor が target を撃破した直後。自分自身への状態異常付与(与ダメバフ等)を試みる。 */
  private triggerOnKillSpecials(actor: EngineUnit): void {
    for (const special of specialsOf(actor.specials, 'ON_KILL')) {
      if (!this.markSpecialFired(actor.id, special.id)) continue;
      if (!rollSpecialChance(special, this.rng)) continue;
      if (!special.status) continue;
      this.applySpecialStatus(special, actor.id, actor, true);
    }
  }

  /**
   * 特殊効果由来の状態付与。発動可否(chance)は呼び出し元の rollSpecialChance で
   * 判定済みなので、ここでは applyStatus に chance:100 を渡して二重に確率を掛けない。
   * ignoreResistance=false のときだけ抵抗判定で追加の乱数を1回消費しうる(通常のデバフと同じ規約)。
   */
  private applySpecialStatus(
    special: ItemSpecialEffect, sourceId: string, target: EngineUnit, ignoreResistance: boolean,
  ): void {
    if (!special.status) return;
    const outcome = applyStatus(target, {
      type: special.status,
      duration: special.duration ?? 1,
      potency: special.potency ?? 0,
      sourceId,
      chance: 100,
      ignoreResistance,
    }, this.rng);

    if (outcome.kind === 'IMMUNE') {
      this.emit('STATUS_RESIST', {
        sourceId,
        targetId: target.id,
        skillName: special.name,
        status: special.status,
        text: `${target.name} は 装備の特殊効果「${special.name}」を受け付けない！`,
      });
      return;
    }
    if (outcome.kind === 'RESISTED') {
      this.emit('STATUS_RESIST', {
        sourceId,
        targetId: target.id,
        skillName: special.name,
        status: special.status,
        text: `${target.name} は 装備の特殊効果「${special.name}」を弾いた！`,
      });
      return;
    }
    if (outcome.kind === 'MISSED') return;

    this.emit('STATUS_APPLY', {
      sourceId,
      targetId: target.id,
      skillName: special.name,
      status: special.status,
      duration: outcome.status.duration,
      value: outcome.status.potency,
      fx: specialFx(special),
      text: statusApplyText(target.name, special.status),
    });
  }

  /**
   * 特殊効果由来の追撃ダメージ (ON_ATTACK の bonusDamage)。
   * 通常のダメージ計算 (computeDamage) をそのまま再利用する = 会心/属性相性/防御軽減/乱数幅の
   * 規約を一切変えない。bonusDamage は power と同じ「攻撃力に対する倍率」として扱う。
   * このダメージ自体が新たな ON_ATTACK を誘発することはない(このメソッドからは
   * triggerOnAttackSpecials を一切呼ばないため、bonusDamage の連鎖的な暴発を構造的に防ぐ)。
   */
  private applySpecialBonusDamage(
    special: ItemSpecialEffect, actor: EngineUnit, target: EngineUnit,
  ): void {
    if (!special.bonusDamage || special.bonusDamage <= 0) return;
    // INVULNERABLE: 現状の呼び出し経路 (triggerOnAttackSpecials) は effectDamage 側の
    // 無敵チェックで既に呼ばれなくなっているため到達しないが、将来の呼び出し元追加に備えた
    // 安全弁として同じ判断をここにも置く(乱数消費前にreturnするので決定論への影響もない)。
    if (hasStatus(target, 'INVULNERABLE')) return;
    const element = actor.element;
    const affinity = affinityMultiplier(
      this.affinity as Record<string, Record<string, number>>, element, target.element,
    );
    const res = computeDamage({
      attackStat: this.scalingValue(actor, 'attack'),
      power: special.bonusDamage,
      defense: effectiveStat(target, 'defense'),
      defenseConstant: this.cfg.defenseConstant,
      affinity,
      criticalRate: actor.stats.critical,
      criticalDamage: actor.stats.criticalDamage,
      variance: this.cfg.damageVariance,
      rng: this.rng,
    });

    const { absorbed, through } = absorbWithShield(target, res.value);
    target.hp = Math.max(0, target.hp - through);
    actor.stat.damageDealt += res.value;
    target.stat.damageTaken += through;

    this.emit('DAMAGE', {
      sourceId: actor.id,
      targetId: target.id,
      skillName: special.name,
      value: res.value,
      critical: res.critical,
      affinity: res.affinity,
      element,
      fx: specialFx(special),
      text: damageText(actor.name, special.name, target.name, res.value, res.critical, res.affinity, absorbed),
    });

    // 追撃でも被弾ゲージは通常どおり溜まる(耐えるほど反撃の芽が出る設計を踏襲)。
    this.gainUlt(target, this.cfg.ultGainOnHit);
  }

  /* ========================================================
   * キャラクターコンボ (設計書§13〜§15)
   * ------------------------------------------------------------
   * 成立判定は constructor で1回だけ行っている (combo.ts の qualifyCombos)。
   * ここでは「成立済みのコンボについて、今このトリガーで発動していいか」だけを判定する。
   * ====================================================== */

  /** 発動可否 (cooldown / maxPerBattle) だけを見る。成立判定はここでは行わない。 */
  private comboReady(runtime: ComboRuntime): boolean {
    if (runtime.cooldownRemaining > 0) return false;
    const max = runtime.def.trigger.maxPerBattle;
    return max === undefined || runtime.timesTriggered < max;
  }

  /** runtime の参加キャラのうち、生存している最初の1体を slot 昇順で返す (excludeId は除外)。 */
  private firstParticipant(runtime: ComboRuntime, excludeId?: string): EngineUnit | undefined {
    return this.units
      .filter((u) => u.side === 'ALLY' && u.alive && u.id !== excludeId
        && runtime.participantDefIds.includes(u.defId))
      .sort((a, b) => a.slot - b.slot)[0];
  }

  /** defId 指定で生存している味方ユニットを探す (ComboEffect.performer の明示指定用)。 */
  private findAliveAllyByDefId(defId: string): EngineUnit | undefined {
    return this.units
      .filter((u) => u.side === 'ALLY' && u.alive && u.defId === defId)
      .sort((a, b) => a.slot - b.slot)[0];
  }

  private fireBattleStartCombos(): void {
    if (this.comboRuntimes.length === 0) return;
    for (const runtime of this.comboRuntimes) {
      if (runtime.def.trigger.type !== 'ON_BATTLE_START' || !this.comboReady(runtime)) continue;
      const source = this.firstParticipant(runtime);
      if (!source) continue;
      this.fireCombo(runtime, source);
    }
  }

  /** ON_SKILL_USE: actor が skill を使った直後に呼ぶ。 */
  private checkComboOnSkillUse(actor: EngineUnit, skill: Skill): void {
    if (this.comboRuntimes.length === 0 || actor.side !== 'ALLY') return;
    for (const runtime of this.comboRuntimes) {
      const t = runtime.def.trigger;
      if (t.type !== 'ON_SKILL_USE') continue;
      if (!runtime.eligibleActorDefIds.has(actor.defId)) continue;
      const matchesSkill = t.skill !== undefined && t.skill === skill.id;
      const matchesTag = t.skillTag !== undefined && (skill.tags ?? []).includes(t.skillTag);
      if (!matchesSkill && !matchesTag) continue;
      if (!this.comboReady(runtime)) continue;
      this.fireCombo(runtime, actor);
    }
  }

  /**
   * ON_HP_BELOW: HPが変化した(かつ生存している)ユニットについて毎回呼ぶ。
   * エッジトリガー化: 閾値を下回った瞬間に1回だけ発動し、閾値を上回るまでは再発動しない
   * (cooldown/maxPerBattle が無いコンボでも、HPが低いままの間ずっと連発しないようにするため)。
   */
  private checkComboHpBelow(unit: EngineUnit): void {
    if (this.comboRuntimes.length === 0 || unit.side !== 'ALLY' || !unit.alive) return;
    const ratio = hpRatio(unit);
    for (const runtime of this.comboRuntimes) {
      const t = runtime.def.trigger;
      if (t.type !== 'ON_HP_BELOW' || t.hpBelow === undefined) continue;
      if (!runtime.participantDefIds.includes(unit.defId)) continue;

      if (ratio > t.hpBelow) {
        runtime.hpBelowArmed.delete(unit.id); // 回復して閾値を上回った -> 再武装
        continue;
      }
      if (runtime.hpBelowArmed.has(unit.id)) continue; // 既にこの下降エッジで発動済み
      runtime.hpBelowArmed.add(unit.id);
      if (!this.comboReady(runtime)) continue;
      this.fireCombo(runtime, unit);
    }
  }

  /** ON_ALLY_DEFEATED: 味方が撃破された直後に呼ぶ。sourceId には撃破された本人を使う。 */
  private checkComboAllyDefeated(defeatedUnit: EngineUnit): void {
    if (this.comboRuntimes.length === 0) return;
    for (const runtime of this.comboRuntimes) {
      if (runtime.def.trigger.type !== 'ON_ALLY_DEFEATED' || !this.comboReady(runtime)) continue;
      this.fireCombo(runtime, defeatedUnit);
    }
  }

  /**
   * コンボを実際に発動する。
   *  - performer(既定は「起点キャラ以外の参加キャラ」)が戦闘不能なら発動しない
   *    (COMBO イベントも出さない・cooldown/maxPerBattle も消費しない)。
   *  - COMBO イベントは必ず1つ出す。sourceId=起点キャラ、targetId=performer (カットイン用に両方必須)。
   *  - 効果は ComboDef.effects を順に適用する。skill 指定は既存の applySkillEffects を再利用するので、
   *    ダメージ計算・snapshot・grouped 判定など通常のスキル実行と全く同じ経路を通る
   *    (= 決定論も既存の乱数消費ルールのまま保たれる)。
   *  - performer の行動ゲージ/必殺ゲージ/クールダウンは一切変更しない
   *    (コンボは「追加のご褒美」であって、performer の本来の手番を消費しない設計)。
   */
  private fireCombo(runtime: ComboRuntime, sourceUnit: EngineUnit): void {
    const defaultPerformer = this.firstParticipant(runtime, sourceUnit.id);
    if (!defaultPerformer) return; // 相方が戦闘不能、または他に参加キャラがいない -> 発動しない

    runtime.timesTriggered += 1;
    // 自分自身の行動でクールダウンを消費したケースと同じ+1トリック
    // (endOfAction の減算がこの直後に走っても、意図した cooldown 回数ぶんは待たされるようにする)。
    runtime.cooldownRemaining = (runtime.def.trigger.cooldown ?? 0) + 1;

    const def = runtime.def;
    this.emit('COMBO', {
      sourceId: sourceUnit.id,
      targetId: defaultPerformer.id,
      comboId: def.id,
      skillName: def.name,
      fx: def.fx,
      text: `${sourceUnit.name} と ${defaultPerformer.name} の連携 ―― ${def.name}！`,
    });

    for (const effect of def.effects) {
      this.applyComboEffect(def, effect, defaultPerformer);
    }
  }

  /** ComboEffect 1件を適用する。performer 省略時は defaultPerformer を使う。 */
  private applyComboEffect(def: ComboDef, effect: ComboEffect, defaultPerformer: EngineUnit): void {
    const performer = effect.performer ? this.findAliveAllyByDefId(effect.performer) : defaultPerformer;
    if (!performer || !performer.alive) return; // この効果の performer だけが戦闘不能 -> この効果だけ諦める

    const tendency = profileTendency(this.ctx.aiProfiles.get(performer.aiProfileId));

    if (effect.skill) {
      const skill = this.ctx.skills.get(effect.skill);
      if (!skill) return; // データ不整合 -> 静かに諦める (他のコンボ効果には影響させない)
      const targets = selectTargets(
        performer, skill.target, this.alliesOf(performer), this.foesOf(performer), this.rng, tendency,
      );
      // コンボ経由で発動する既存スキルが randomEffect を持つ場合も、通常の発動と同じ規約
      // (resolveEffects で rng.pick 1回だけ)を適用する。
      this.applySkillEffects(performer, skill, targets, this.resolveEffects(skill));
      return;
    }

    if (effect.effect) {
      // skill を介さない直接効果。ComboDef の名前をそのままログ用スキル名として使う合成スキルにする。
      const synthetic: Skill = {
        id: def.id,
        name: def.name,
        kind: 'ACTIVE',
        description: def.description,
        cooldown: 0,
        target: effect.effect.target ?? { side: 'SELF', pattern: 'SELF' },
        effects: [effect.effect],
        fx: def.fx,
      };
      const targets = selectTargets(
        performer, synthetic.target, this.alliesOf(performer), this.foesOf(performer), this.rng, tendency,
      );
      this.applySkillEffects(performer, synthetic, targets);
    }
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
    if (unit.side === 'ALLY') this.checkComboAllyDefeated(unit);
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

/**
 * P0-4: 括弧は1行に最大1つまでとする。
 * 優先度: 会心 > 属性相性 > シールド肩代わり。
 *   - 会心/属性相性は「その一撃の質」を表す最重要情報 (次の編成判断に直結する)。
 *   - シールド肩代わりは「結果的にどれだけ通ったか」という補足情報で、優先度は最も低い。
 *   - 落ちた情報は BattleEvent.critical / affinity / value にそのまま残っているので、
 *     UI側はテキストに出ていなくてもアイコン等で表示できる (テキストは1情報に絞るだけ)。
 */
export function damageText(
  actor: string, skillName: string, target: string,
  value: number, critical: boolean, affinity: number, absorbed: number,
): string {
  const base = `${actor} の ${skillName}！ ${target} に ${value} ダメージ！`;
  let suffix = '';
  if (critical) suffix = '(会心)';
  else if (affinity > 1.001) suffix = '(効果は抜群だ！)';
  else if (affinity < 0.999) suffix = '(効果はいまひとつ…)';
  else if (absorbed > 0) suffix = `(シールドが ${absorbed} 肩代わり)`;
  return suffix ? `${base}${suffix}` : base;
}

/** バフは「〜が上がった」、デバフは「〜状態になった」で語調を分ける */
const BUFFY: readonly StatusType[] = [
  'ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT', 'INVULNERABLE', 'IMMUNE',
];
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
