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
  CharacterDef, EnemyDef, EquipmentInstance, GrowthRates, LevelUpInfo, OwnedCharacter,
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
  /** Phase3: 装備による加算(EquipmentInstance.stats を集計した値を渡す) */
  equipmentFlat?: Partial<Record<StatKey, number>>;
  /**
   * Phase3: 装備による割合加算(EquipmentInstance.statsPercent を集計した値。単位は%)。
   * **「装備フラット適用後の値に対する割合」として一番最後に乗算する**(下記 computeStats のコメント参照)。
   */
  equipmentPercent?: Partial<Record<StatKey, number>>;
}

/**
 * 最終ステータスを算出する。
 *
 * === 適用順序(変更すると既存バランスが壊れるので固定すること) ===
 *   1. base + growth * (level - 1)                    …… レベル成長
 *   2. + rebirthPoints[key]                            …… 転生ポイント(Phase2)
 *   3. + equipmentFlat[key]                             …… 装備の固定値加算(Phase3)
 *   4. × (1 + limitBreakRate * limitBreak)              …… 限界突破(Phase2。現状は係数0=無効)
 *   5. × (1 + equipmentPercent[key] / 100)              …… 装備の%加算(Phase3)
 * 「装備の%は装備フラット適用後の値に対する割合」という仕様(docs/API.md §3)を満たすため、
 * equipmentPercent は必ず他のすべての加算・乗算より後に適用する。
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

    // --- 手順2: 転生ポイント: 現状は単純加算だけ受け付ける ---
    const rebirth = mods.rebirthPoints?.[key];
    if (typeof rebirth === 'number') value += rebirth;

    // --- 手順3: 装備(フラット): 装備解決済みの加算値を加える ---
    const equipFlat = mods.equipmentFlat?.[key];
    if (typeof equipFlat === 'number') value += equipFlat;

    // --- 手順4: 限界突破: 乗算補正(現状は係数0 = 無効) ---
    // if (mods.limitBreak) value *= 1 + LIMIT_BREAK_RATE * mods.limitBreak;

    // --- 手順5: 装備(%): 「ここまでの値」に対する割合加算。必ず最後に適用する ---
    const equipPercent = mods.equipmentPercent?.[key];
    if (typeof equipPercent === 'number' && equipPercent !== 0) value *= 1 + equipPercent / 100;

    out[key] = roundStat(key, value);
  }
  return out;
}

/**
 * 装着中の装備一覧(スロット→uid)から equipmentFlat/equipmentPercent を集計する。
 * `equipmentByUid` を渡さない場合は装備効果なし(呼び出し側が装備を解決したくない場面向け)。
 */
export function resolveEquipmentMods(
  owned: OwnedCharacter,
  equipmentByUid?: Map<string, EquipmentInstance>,
): Pick<StatModifierSources, 'equipmentFlat' | 'equipmentPercent'> {
  if (!equipmentByUid) return {};
  const flat: Partial<Record<StatKey, number>> = {};
  const percent: Partial<Record<StatKey, number>> = {};
  for (const uid of Object.values(owned.equipment ?? {})) {
    if (!uid) continue;
    const item = equipmentByUid.get(uid);
    if (!item) continue;
    for (const key of STAT_KEYS) {
      const flatV = item.stats?.[key];
      if (typeof flatV === 'number') flat[key] = (flat[key] ?? 0) + flatV;
      const pctV = item.statsPercent?.[key];
      if (typeof pctV === 'number') percent[key] = (percent[key] ?? 0) + pctV;
    }
  }
  return { equipmentFlat: flat, equipmentPercent: percent };
}

/** HP/攻撃などは整数、%系は小数1桁まで許容 */
function roundStat(key: StatKey, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (key === 'critical' || key === 'criticalDamage' || key === 'resistance' || key === 'healing') {
    return Math.round(value * 10) / 10;
  }
  return Math.round(value);
}

/**
 * 所持キャラの最終ステータス。
 * `equipmentByUid` を渡すと `owned.equipment` (スロット→装備uid) を解決して
 * 装備の効果(フラット+%)を反映する。省略時は装備なしとして計算する
 * (装備テーブルを引く必要が無い軽量な呼び出し向け)。
 */
export function computeOwnedStats(
  def: CharacterDef,
  owned: OwnedCharacter,
  equipmentByUid?: Map<string, EquipmentInstance>,
): Stats {
  return computeStats(def.baseStats, def.growth, owned.level, {
    limitBreak: owned.limitBreak,
    rebirthPoints: owned.rebirthPoints,
    ...resolveEquipmentMods(owned, equipmentByUid),
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
 * 戦闘不能者への EXP 減額率(生存者比)。P1-4 で導入。
 * 0.5 = 生存者の半額。0 にはしない(育成が詰んだキャラがさらに育たなくなる
 * 負のループを避けるため。詳細は下の grantBattleExp のコメント参照)。
 */
export const DEFEATED_EXP_RATE = 0.5;

/**
 * 出撃メンバーへ EXP を配分する。
 *
 * 配分ルール(P1-4 で第2ラウンド差し戻し対応として変更):
 *   **生存者には全額、戦闘不能になった者には `DEFEATED_EXP_RATE`(50%)** を配る。
 *   `survivedByUid` を渡さない場合は従来通り全員同額(呼び出し側の後方互換)。
 *
 *   経緯:
 *     - 第1回評価で「全員生き残る編成を組む動機が無い」ことが 30/30 全勝の一因と
 *       指摘された(docs/REVIEW_ROUND1.md B節)。前任は「オート戦闘なので誰が落ちる
 *       かをプレイヤーが操作できず、減EXPは育成の負ループになる」と警告しており、
 *       この指摘自体は妥当。そのため **0%(無配布)ではなく 50%** を選び、
 *       「敗北のダメージはあるが再起不能ではない」バランスにした。
 *     - P0-1(ステージ開放制御)導入により、そもそも身の丈に合わないステージへ
 *       直行できなくなったため、「弱いキャラだけが延々ハンデを受け続ける」状況は
 *       起きにくくなっている。難しすぎるステージで負け続けて育成が詰む前に、
 *       開放条件が下位ステージでの育成を促す形になっている。
 *     - 控えメンバーには配らないので「編成して出す」動機は変わらず保たれる。
 *   将来: 与ダメージ量に応じた傾斜配分を入れる場合は、BattleUnitStat を丸ごと
 *         受け取って係数を掛ける形に拡張する(呼び出し側の互換を保つため引数は
 *         末尾に追加すること)。
 */
export function grantBattleExp(
  targets: RewardTarget[],
  stageExp: number,
  config: ProgressionConfig,
  survivedByUid?: Map<string, boolean>,
): GrantExpResult {
  const expPerMember = Math.max(0, Math.floor(stageExp || 0));
  const defeatedExp = Math.max(0, Math.round(expPerMember * DEFEATED_EXP_RATE));
  const updates: GrantedProgress[] = [];
  const levelUps: LevelUpInfo[] = [];

  for (const t of targets) {
    const survived = survivedByUid ? survivedByUid.get(t.owned.uid) ?? true : true;
    const amount = survived ? expPerMember : defeatedExp;
    const before = computeOwnedStats(t.def, t.owned);
    const result = applyExp({ level: t.owned.level, exp: t.owned.exp }, amount, config);
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
