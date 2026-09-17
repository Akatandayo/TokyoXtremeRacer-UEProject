/**
 * 育成計算(サーバ権威)
 * ------------------------------------------------------------
 * 設計書 §37: レベル・EXP・ステータス・報酬はすべてサーバ側でのみ確定させる。
 * クライアントから送られてきたレベル/EXP/ステータスは一切参照しない。
 *
 * 最終ステータス = baseStats + growth * (level - 1)
 *   + [Phase2] 限界突破ボーナス
 *   + [Phase2] 転生ポイント
 *   + [Phase2] 装備補正
 *   + [Phase2] 覚醒補正(戦闘中に適用されるため戦闘エンジン側)
 * 拡張点は computeStats() 内にコメントで明示してある。
 */
import type {
  CharacterDef, EnemyDef, GrowthRates, LevelUpInfo, OwnedCharacter,
  ProgressionConfig, Stats, StatKey,
} from '@akatan/shared';

export const STAT_KEYS: StatKey[] = [
  'hp', 'attack', 'defense', 'speed', 'critical', 'criticalDamage', 'resistance', 'healing',
];

const ZERO_STATS: Stats = {
  hp: 0, attack: 0, defense: 0, speed: 0,
  critical: 0, criticalDamage: 0, resistance: 0, healing: 0,
};

/** baseStats が部分的でも落ちないように補完する */
function normalizeStats(base: Partial<Stats> | undefined): Stats {
  const out = { ...ZERO_STATS };
  if (!base) return out;
  for (const key of STAT_KEYS) {
    const v = base[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/* ============================================================
 * ステータス計算
 * ========================================================== */

export interface StatModifierSources {
  /** Phase2: 限界突破段階 */
  limitBreak?: number;
  /** Phase2: 転生ポイント割り振り */
  rebirthPoints?: Partial<Record<StatKey, number>>;
  /** Phase2: 装備による加算(装備テーブル解決済みの値を渡す) */
  equipmentFlat?: Partial<Record<StatKey, number>>;
}

/**
 * 最終ステータスを算出する。
 * 現時点では level と growth のみを反映する(MVP)。
 *
 * === 拡張ポイント(Phase 2 以降) ===
 *  1. 限界突破:  stat *= (1 + limitBreakRate * limitBreak)
 *  2. 転生ポイント: stat += rebirthPoints[key] * pointValue[key]
 *  3. 装備:      stat += equipmentFlat[key] (+ 割合補正)
 *  いずれも「加算 → 乗算」の順で適用する方針。順序を変えると既存バランスが崩れるので注意。
 */
export function computeStats(
  base: Partial<Stats> | undefined,
  growth: GrowthRates | undefined,
  level: number,
  mods: StatModifierSources = {},
): Stats {
  const lv = Math.max(1, Math.floor(level || 1));
  const baseStats = normalizeStats(base);
  const out = { ...ZERO_STATS };

  for (const key of STAT_KEYS) {
    const perLevel = growth?.[key] ?? 0;
    let value = baseStats[key] + perLevel * (lv - 1);

    // --- 拡張ポイント(2) 転生ポイント: 現状は単純加算だけ受け付ける ---
    const rebirth = mods.rebirthPoints?.[key];
    if (typeof rebirth === 'number') value += rebirth;

    // --- 拡張ポイント(3) 装備: 装備解決済みのフラット値を加算 ---
    const equip = mods.equipmentFlat?.[key];
    if (typeof equip === 'number') value += equip;

    // --- 拡張ポイント(1) 限界突破: 乗算補正(現状は係数0 = 無効) ---
    // if (mods.limitBreak) value *= 1 + LIMIT_BREAK_RATE * mods.limitBreak;

    out[key] = roundStat(key, value);
  }
  return out;
}

/** HP/攻撃などは整数、%系は小数1桁まで許容 */
function roundStat(key: StatKey, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (key === 'critical' || key === 'criticalDamage' || key === 'resistance' || key === 'healing') {
    return Math.round(value * 10) / 10;
  }
  return Math.round(value);
}

/** 所持キャラの最終ステータス */
export function computeOwnedStats(def: CharacterDef, owned: OwnedCharacter): Stats {
  return computeStats(def.baseStats, def.growth, owned.level, {
    limitBreak: owned.limitBreak,
    rebirthPoints: owned.rebirthPoints,
    // equipmentFlat: [Phase2] 装備マスタ解決後にここへ渡す
  });
}

/** 敵の最終ステータス(レベルに応じて成長させる) */
export function computeEnemyStats(def: EnemyDef, level: number): Stats {
  return computeStats(def.baseStats, def.growth, level);
}

/* ============================================================
 * EXP テーブル
 * ========================================================== */

/**
 * Lv n -> n+1 に必要な EXP = round(base * n^exponent)。
 * levelCap に到達したら 0(=これ以上必要なEXPは無い)を返す。
 */
export function expToNext(level: number, config: ProgressionConfig): number {
  const cap = config.levelCap > 0 ? config.levelCap : 1;
  const lv = Math.max(1, Math.floor(level || 1));
  if (lv >= cap) return 0;
  const { base, exponent } = config.expCurve;
  const need = Math.round(base * Math.pow(lv, exponent));
  return Math.max(1, need);
}

/** Lv1 から指定レベルに到達するまでの累計EXP(デバッグ/表示用) */
export function totalExpForLevel(level: number, config: ProgressionConfig): number {
  let total = 0;
  for (let lv = 1; lv < Math.max(1, level); lv += 1) total += expToNext(lv, config);
  return total;
}

/* ============================================================
 * EXP 付与とレベルアップ
 * ========================================================== */

export interface ApplyExpResult {
  level: number;
  exp: number;
  fromLevel: number;
  gained: number;
  leveledUp: boolean;
  /** 上限到達で切り捨てたEXP */
  discarded: number;
}

/**
 * EXP を加算し、繰り上がりループで複数レベル上昇を処理する。
 * levelCap 到達後の余剰EXPは捨てる(exp = 0 に固定)。
 */
export function applyExp(
  current: { level: number; exp: number },
  amount: number,
  config: ProgressionConfig,
): ApplyExpResult {
  const cap = config.levelCap > 0 ? config.levelCap : 1;
  const fromLevel = Math.max(1, Math.min(cap, Math.floor(current.level || 1)));
  const gained = Math.max(0, Math.floor(amount || 0));

  let level = fromLevel;
  let exp = Math.max(0, Math.floor(current.exp || 0)) + gained;
  let discarded = 0;

  if (level >= cap) {
    // すでに上限。獲得EXPはすべて捨てる。
    discarded = exp;
    return { level: cap, exp: 0, fromLevel, gained, leveledUp: false, discarded };
  }

  // 繰り上がりループ。need が 0 になる = 上限到達。
  for (;;) {
    const need = expToNext(level, config);
    if (need <= 0) break;
    if (exp < need) break;
    exp -= need;
    level += 1;
    if (level >= cap) {
      level = cap;
      discarded = exp;
      exp = 0;
      break;
    }
  }

  return { level, exp, fromLevel, gained, leveledUp: level > fromLevel, discarded };
}

/** ステータス差分(LevelUpInfo.statGain 用)。増分が 0 のキーは含めない。 */
export function diffStats(before: Stats, after: Stats): Partial<Stats> {
  const gain: Partial<Stats> = {};
  for (const key of STAT_KEYS) {
    const d = roundStat(key, after[key] - before[key]);
    if (d !== 0) gain[key] = d;
  }
  return gain;
}

/* ============================================================
 * 戦闘報酬の付与
 * ========================================================== */

export interface RewardTarget {
  owned: OwnedCharacter;
  def: CharacterDef;
}

export interface GrantedProgress {
  uid: string;
  level: number;
  exp: number;
  /** レベルが上がった場合のみ */
  levelUp?: LevelUpInfo;
}

export interface GrantExpResult {
  /** DB に書き戻す更新内容 */
  updates: GrantedProgress[];
  levelUps: LevelUpInfo[];
  /** 1人あたりの獲得EXP */
  expPerMember: number;
}

/**
 * 出撃メンバーへ EXP を配分する。
 *
 * 配分ルール(MVP):
 *   **生存/戦闘不能を問わず、出撃した全員に同額** を配る。
 *   理由:
 *     - 完全オート戦闘のため「誰が落ちるか」はプレイヤーの操作でコントロールできない。
 *       戦闘不能を減EXPで罰すると、育成が遅れたキャラがさらに育たない負のループになる。
 *     - 控えメンバーには配らないので「編成して出す」動機は保たれる。
 *   将来: 与ダメージ/生存に応じた傾斜配分を入れる場合は、ここで BattleUnitStat を
 *         受け取って係数を掛ける(呼び出し側の互換を保つため引数は末尾に追加すること)。
 */
export function grantBattleExp(
  targets: RewardTarget[],
  stageExp: number,
  config: ProgressionConfig,
): GrantExpResult {
  const expPerMember = Math.max(0, Math.floor(stageExp || 0));
  const updates: GrantedProgress[] = [];
  const levelUps: LevelUpInfo[] = [];

  for (const t of targets) {
    const before = computeOwnedStats(t.def, t.owned);
    const result = applyExp({ level: t.owned.level, exp: t.owned.exp }, expPerMember, config);
    const entry: GrantedProgress = { uid: t.owned.uid, level: result.level, exp: result.exp };

    if (result.leveledUp) {
      const after = computeStats(t.def.baseStats, t.def.growth, result.level, {
        limitBreak: t.owned.limitBreak,
        rebirthPoints: t.owned.rebirthPoints,
      });
      const info: LevelUpInfo = {
        uid: t.owned.uid,
        name: t.def.name,
        fromLevel: result.fromLevel,
        toLevel: result.level,
        expGained: result.gained,
        statGain: diffStats(before, after),
      };
      entry.levelUp = info;
      levelUps.push(info);
    }
    updates.push(entry);
  }

  return { updates, levelUps, expPerMember };
}

/** ステージ報酬のゴールド(サーバ側で確定。クライアント申告は無視) */
export function computeGoldReward(stageGold: number): number {
  return Math.max(0, Math.floor(stageGold || 0));
}
