/**
 * 状態異常 / バフの管理
 * ------------------------------------------------------------
 * 重ねがけ(スタック)の統一ルール:
 *   同種の状態を重ねて付与した場合、**効果量(potency)は高い方を残し、duration は長い方を採用**する。
 *   - 別々に持つ「スタック数」方式にしないのは、DoT が何体からも刺さって即死ゲーになるのを防ぐため。
 *   - 「弱いが長い」デバフで「強いが短い」デバフを上書きされる理不尽を避けるため、
 *     potency と duration を独立に max で取る (= どちらの観点でも損をしない)。
 *   - SHIELD だけは potency が「残り吸収量」なので、strongerな盾で張り替える形になる。
 *
 * potency の意味 (種別ごとに違うので必ずここを参照):
 *   POISON/BURN/BLEED : 1回の経過で与える継続ダメージ = 対象の最大HP * potency%
 *                       (固定値ではなく割合にすることで、装備インフレでも腐らない/壊れない)
 *   REGEN             : 1回の経過で回復する量 = 対象の最大HP * potency%
 *   SHIELD            : 残り吸収可能ダメージ量(絶対値)。付与時に「最大HPの potency%」から変換する。
 *   ATK/DEF/SPD 系    : ステータス補正(%)。ATK_UP 30 なら攻撃 +30%、ATK_DOWN 30 なら -30%。
 *   FREEZE/STUN/SILENCE/TAUNT : potency は未使用 (0 で良い)
 */
import { INCAPACITATING_STATUS } from '@akatan/shared';
import type { ActiveStatus, BattleUnit, StatKey, StatusType } from '@akatan/shared';
import type { Rng } from './rng.js';

/** 継続ダメージ系 */
export const DOT_STATUS: readonly StatusType[] = ['POISON', 'BURN', 'BLEED'];

/** 不利な状態 = 耐性(resistance)による抵抗判定の対象 */
export const DEBUFF_STATUS: readonly StatusType[] = [
  'POISON', 'BURN', 'BLEED', 'FREEZE', 'STUN', 'SILENCE', 'SLOW', 'DEF_DOWN', 'ATK_DOWN',
];

/** 有利な状態 = 抵抗判定なしで必ず入る */
export const BUFF_STATUS: readonly StatusType[] = [
  'ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT',
];

/** 演出ログ用の日本語表記 */
export const STATUS_LABEL: Record<StatusType, string> = {
  POISON: '毒', BURN: '火傷', FREEZE: '氷結', STUN: 'スタン', SILENCE: '沈黙', BLEED: '出血',
  SLOW: '鈍足', DEF_DOWN: '防御低下', ATK_DOWN: '攻撃低下', ATK_UP: '攻撃上昇',
  DEF_UP: '防御上昇', SPD_UP: '速度上昇', SHIELD: 'シールド', REGEN: '再生', TAUNT: '挑発',
};

export function isDot(type: StatusType): boolean {
  return DOT_STATUS.includes(type);
}
export function isDebuff(type: StatusType): boolean {
  return DEBUFF_STATUS.includes(type);
}
export function isBuff(type: StatusType): boolean {
  return BUFF_STATUS.includes(type);
}

export function hasStatus(unit: BattleUnit, type: StatusType): boolean {
  return unit.statuses.some((s) => s.type === type && s.duration > 0);
}

export function getStatus(unit: BattleUnit, type: StatusType): ActiveStatus | undefined {
  return unit.statuses.find((s) => s.type === type && s.duration > 0);
}

/** FREEZE / STUN のいずれかを持つなら行動不能 */
export function isIncapacitated(unit: BattleUnit): boolean {
  return INCAPACITATING_STATUS.some((t) => hasStatus(unit, t));
}

/** 行動不能の原因になっている状態 (ログ表示用。複数あれば最初のもの) */
export function incapacitatingReason(unit: BattleUnit): StatusType | undefined {
  return INCAPACITATING_STATUS.find((t) => hasStatus(unit, t));
}

/** SILENCE 中はスキル/必殺技が撃てず、通常攻撃のみになる */
export function isSilenced(unit: BattleUnit): boolean {
  return hasStatus(unit, 'SILENCE');
}

export interface ApplyStatusOptions {
  type: StatusType;
  duration: number;
  /** 種別ごとの意味は冒頭コメント参照。SHIELD は「最大HPに対する%」で渡す */
  potency?: number;
  sourceId?: string;
  /** 発動確率(%)。省略時100 */
  chance?: number;
  /** true なら耐性による抵抗判定をスキップ (覚醒付与・自己バフなど) */
  ignoreResistance?: boolean;
}

export type ApplyStatusOutcome =
  | { kind: 'APPLIED'; status: ActiveStatus }
  | { kind: 'RESISTED' }
  | { kind: 'MISSED' };

/**
 * 状態を付与する。
 * 乱数の消費順は「発動確率 -> 抵抗判定」で固定 (どちらもスキップ条件では消費しない)。
 */
export function applyStatus(
  unit: BattleUnit,
  opts: ApplyStatusOptions,
  rng: Rng,
): ApplyStatusOutcome {
  if (!unit.alive) return { kind: 'MISSED' };

  // 1) スキル側の発動確率。100%指定なら乱数を消費しない (通常攻撃だらけの戦闘で列を汚さないため)。
  const chance = opts.chance ?? 100;
  if (chance < 100 && !rng.chance(chance)) return { kind: 'MISSED' };

  // 2) 耐性による抵抗。デバフのみ対象、バフは必ず入る。
  const needResist = !opts.ignoreResistance && isDebuff(opts.type);
  if (needResist) {
    // 耐性は 0..95% にクランプ。100%耐性で完全無効化されると状態異常構成が死ぬため上限を置く。
    const resist = Math.min(95, Math.max(0, unit.stats.resistance));
    if (resist > 0 && rng.chance(resist)) return { kind: 'RESISTED' };
  }

  // 3) potency の正規化。SHIELD だけは「最大HPの%」->「残り吸収量(絶対値)」へ変換する。
  const rawPotency = opts.potency ?? 0;
  const potency = opts.type === 'SHIELD'
    ? Math.max(1, Math.round(unit.maxHp * (rawPotency / 100)))
    : rawPotency;

  const incoming: ActiveStatus = {
    type: opts.type,
    duration: Math.max(1, Math.round(opts.duration)),
    potency,
    sourceId: opts.sourceId,
  };

  const existing = unit.statuses.find((s) => s.type === opts.type);
  if (existing) {
    // 重ねがけ: potency も duration も「強い方 / 長い方」を残す (冒頭のルール)
    existing.potency = Math.max(existing.potency, incoming.potency);
    existing.duration = Math.max(existing.duration, incoming.duration);
    existing.sourceId = incoming.sourceId ?? existing.sourceId;
    return { kind: 'APPLIED', status: existing };
  }
  unit.statuses.push(incoming);
  return { kind: 'APPLIED', status: incoming };
}

/**
 * ステータス補正倍率を返す。
 * 同種は1つに統合されているので、単純に (1 + up% - down%) で求まる。
 * 下限 0.1 倍 / 上限 5.0 倍でクランプし、デバフ盛りでゼロ除算や実質0火力にならないようにする。
 */
export function statMultiplier(unit: BattleUnit, key: StatKey): number {
  let pct = 0;
  for (const s of unit.statuses) {
    if (s.duration <= 0) continue;
    if (key === 'attack') {
      if (s.type === 'ATK_UP') pct += s.potency;
      else if (s.type === 'ATK_DOWN') pct -= s.potency;
    } else if (key === 'defense') {
      if (s.type === 'DEF_UP') pct += s.potency;
      else if (s.type === 'DEF_DOWN') pct -= s.potency;
    } else if (key === 'speed') {
      if (s.type === 'SPD_UP') pct += s.potency;
      else if (s.type === 'SLOW') pct -= s.potency;
    }
  }
  return Math.min(5, Math.max(0.1, 1 + pct / 100));
}

/** 状態異常込みの実効ステータス値 */
export function effectiveStat(unit: BattleUnit, key: StatKey): number {
  const base = unit.stats[key];
  if (key === 'attack' || key === 'defense' || key === 'speed') {
    return base * statMultiplier(unit, key);
  }
  return base;
}

/**
 * SHIELD によるダメージ肩代わり。
 * 返り値: { absorbed: 盾が吸った量, through: 実際にHPへ通る量, broken: 盾が割れたか }
 * 盾は「先に張られた(配列の前方)」ものから消費する = 更新順が決定論的になる。
 */
export function absorbWithShield(
  unit: BattleUnit,
  damage: number,
): { absorbed: number; through: number; broken: boolean } {
  let remaining = damage;
  let absorbed = 0;
  let broken = false;
  for (const s of unit.statuses) {
    if (s.type !== 'SHIELD' || s.duration <= 0 || remaining <= 0) continue;
    const take = Math.min(s.potency, remaining);
    s.potency -= take;
    remaining -= take;
    absorbed += take;
    if (s.potency <= 0) {
      s.duration = 0; // 割れた盾は即座に期限切れ扱い -> 次の掃除で消える
      broken = true;
    }
  }
  return { absorbed, through: remaining, broken };
}

export interface StatusTickResult {
  /** 継続ダメージ (POISON/BURN/BLEED) */
  damage: { type: StatusType; value: number }[];
  /** 継続回復 (REGEN) */
  heal: { type: StatusType; value: number }[];
}

/**
 * DoT / REGEN の量を計算する (HPへの反映と DEFEAT 判定はエンジン側の責務)。
 * 量は「対象の最大HPの potency%」。最低1を保証して「効いてない」状態を作らない。
 */
export function computeStatusTick(unit: BattleUnit): StatusTickResult {
  const result: StatusTickResult = { damage: [], heal: [] };
  for (const s of unit.statuses) {
    if (s.duration <= 0) continue;
    if (isDot(s.type)) {
      result.damage.push({ type: s.type, value: Math.max(1, Math.round(unit.maxHp * (s.potency / 100))) });
    } else if (s.type === 'REGEN') {
      result.heal.push({ type: s.type, value: Math.max(1, Math.round(unit.maxHp * (s.potency / 100))) });
    }
  }
  return result;
}

/**
 * 継続時間を1減らし、0になったものを取り除いて返す。
 * 「そのユニットが行動したタイミング」で呼ぶ = duration の単位は "自分の行動回数"。
 * (全体ティック基準にすると素早いキャラだけデバフが軽くなってしまうため)
 */
export function advanceStatuses(unit: BattleUnit): ActiveStatus[] {
  const expired: ActiveStatus[] = [];
  for (const s of unit.statuses) {
    s.duration -= 1;
  }
  const kept: ActiveStatus[] = [];
  for (const s of unit.statuses) {
    if (s.duration <= 0) expired.push(s);
    else kept.push(s);
  }
  unit.statuses = kept;
  return expired;
}

/** 死亡時などに全状態を消す */
export function clearAll(unit: BattleUnit): void {
  unit.statuses = [];
}

/**
 * デバフ解除 (CLEANSE)。count 指定時は配列先頭から count 個だけ消す (付与が古い順 = 決定論的)。
 * 解除したものを返す。
 */
export function cleanseDebuffs(unit: BattleUnit, count?: number): ActiveStatus[] {
  const removed: ActiveStatus[] = [];
  const kept: ActiveStatus[] = [];
  let left = count ?? Number.POSITIVE_INFINITY;
  for (const s of unit.statuses) {
    if (isDebuff(s.type) && left > 0) {
      removed.push(s);
      left--;
    } else {
      kept.push(s);
    }
  }
  unit.statuses = kept;
  return removed;
}

/** 挑発しているユニットだけを抜き出す (単体攻撃の対象誘導用) */
export function tauntingUnits<T extends BattleUnit>(candidates: T[]): T[] {
  return candidates.filter((u) => u.alive && hasStatus(u, 'TAUNT'));
}
