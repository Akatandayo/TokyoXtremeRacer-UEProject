/**
 * ダメージ / 回復の計算
 * ------------------------------------------------------------
 * 設計方針:
 *  1) 防御は「減算」ではなく「割合軽減」にする。
 *     減算式 (dmg = atk - def) は装備インフレで簡単に 0 or 即死に振り切れて壊れる。
 *     mitigation = def / (def + K) なら def をいくら盛っても 1 に漸近するだけで、
 *     「def = K のとき 50% 軽減」という直感的な基準線を持てる (K = config.defenseConstant)。
 *  2) 乗算の順序は 基礎 -> 属性 -> 会心 -> 乱数。
 *     乱数を最後に掛けるのは、会心や属性の「見え方」を乱数で潰さないため
 *     (会心が常に非会心より大きくなることを保証しやすい)。
 *  3) 結果は必ず理由付きで返す ({ value, critical, affinity })。
 *     演出ログに会心/相性を出すため、呼び出し側で再計算させない。
 */
import type { Rng } from './rng.js';

/** ダメージ計算の結果。演出ログにそのまま流せるよう理由を同梱する。 */
export interface DamageResult {
  /** 最終ダメージ (整数、最低1) */
  value: number;
  /** 会心が出たか */
  critical: boolean;
  /** 適用された属性相性倍率 (1.0 = 等倍) */
  affinity: number;
}

export interface DamageInput {
  /** 参照ステータスの「補正後」の値 (ATK_UP/ATK_DOWN 適用済み) */
  attackStat: number;
  /** スキル倍率 (1.0 = 等倍) */
  power: number;
  /** 対象の「補正後」防御 (DEF_UP/DEF_DOWN 適用済み) */
  defense: number;
  /** 防御係数 K。def = K のとき 50% 軽減 */
  defenseConstant: number;
  /** 属性相性倍率 */
  affinity: number;
  /** 会心率 (%) */
  criticalRate: number;
  /** 会心倍率 (%) 150 = 1.5倍 */
  criticalDamage: number;
  /** 乱数幅 (0.05 = ±5%) */
  variance: number;
  rng: Rng;
  /** false なら会心判定を行わない (DoT など) */
  canCritical?: boolean;
}

/** 軽減率の上限。K をどれだけ超えても完全無敵にはしない安全弁。 */
export const MAX_MITIGATION = 0.9;

/**
 * 防御による軽減率 (0..MAX_MITIGATION) を返す。
 * def が負の値でも 0 に丸めるので、デバフで防御がマイナスになっても壊れない。
 */
export function mitigation(defense: number, defenseConstant: number): number {
  const def = Math.max(0, defense);
  const k = Math.max(1, defenseConstant); // K=0 だと常に100%軽減になるため下限1
  const raw = def / (def + k);
  return Math.min(MAX_MITIGATION, raw);
}

/**
 * 1ヒット分のダメージを計算する。
 *
 *   base   = attackStat * power * (1 - mitigation(def, K))
 *   dmg    = base * affinity * (critical ? criticalDamage/100 : 1) * (1 ± variance)
 *   value  = max(1, round(dmg))
 *
 * 乱数の消費順は「会心判定 -> 乱数幅」で固定。ここを変えると既存リプレイが再生できなくなる。
 */
export function computeDamage(input: DamageInput): DamageResult {
  const {
    attackStat, power, defense, defenseConstant, affinity,
    criticalRate, criticalDamage, variance, rng,
  } = input;
  const canCritical = input.canCritical !== false;

  const base = Math.max(0, attackStat) * power * (1 - mitigation(defense, defenseConstant));

  // 会心判定 (乱数1消費)。canCritical=false のときは消費しない = DoT を混ぜても列が安定する。
  const critical = canCritical ? rng.chance(criticalRate) : false;
  const critMul = critical ? Math.max(1, criticalDamage) / 100 : 1;

  // 乱数幅 (乱数1消費)。variance=0 でも呼び出して消費回数を一定に保つ。
  const roll = rng.next();
  const v = Math.max(0, variance);
  const varianceMul = 1 - v + roll * v * 2;

  const raw = base * affinity * critMul * varianceMul;
  // 最低1ダメージ保証: 硬すぎる相手にも必ず「当たった」感触を残す。
  const value = Math.max(1, Math.round(raw));
  return { value, critical, affinity };
}

export interface HealInput {
  /** 参照ステータスの補正後の値 (回復スキルは attack 基準が多いが maxHp 基準も許す) */
  scalingStat: number;
  power: number;
  /** 術者の healing ステータス (%) 100 = 等倍 */
  healingStat: number;
  variance: number;
  rng: Rng;
}

/**
 * 回復量。
 *   heal = scalingStat * power * (healing/100) * (1 ± variance)
 * 会心は乗らない (回復に会心を入れると事故で壊れやすいので Phase1 では非対応)。
 */
export function computeHeal(input: HealInput): DamageResult {
  const { scalingStat, power, healingStat, variance, rng } = input;
  const roll = rng.next();
  const v = Math.max(0, variance);
  const varianceMul = 1 - v + roll * v * 2;
  const raw = Math.max(0, scalingStat) * power * (Math.max(0, healingStat) / 100) * varianceMul;
  return { value: Math.max(1, Math.round(raw)), critical: false, affinity: 1 };
}

/**
 * 属性相性倍率を引く。テーブルに無い組み合わせは等倍 (1.0)。
 * data 担当がテーブルを部分的にしか書かなくても壊れないようにする。
 */
export function affinityMultiplier(
  table: Partial<Record<string, Partial<Record<string, number>>>>,
  attacker: string,
  defender: string,
): number {
  const row = table[attacker];
  if (!row) return 1;
  const v = row[defender];
  return typeof v === 'number' && Number.isFinite(v) ? v : 1;
}
