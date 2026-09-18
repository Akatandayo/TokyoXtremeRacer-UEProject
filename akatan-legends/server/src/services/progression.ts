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
  ProgressionConfig, RebirthNodeDef, RebirthPath, Stats, StatKey,
} from '@akatan/shared';
import { REBIRTH_PATHS } from '@akatan/shared';

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
  /**
   * @deprecated 転生ポイント旧形式(ステータスへの素の加算)。系統ツリー方式(rebirthFlat/
   * rebirthPercent)へ移行したので新規には使わない。既存セーブの読み込みだけ残している。
   */
  rebirthPoints?: Partial<Record<StatKey, number>>;
  /** 転生(Phase2 §18): 転生ノードの STAT_FLAT 効果を集計した値(resolveRebirthStatMods) */
  rebirthFlat?: Partial<Record<StatKey, number>>;
  /**
   * 転生(Phase2 §18): 転生ノードの STAT_PERCENT 効果を集計した値(単位は%)。
   * 装備%と同様「加算適用後の値に対する割合」として乗算するが、**装備%より先に**適用する
   * (下記 computeStats のコメント参照。装備%は仕様上必ず最後)。
   */
  rebirthPercent?: Partial<Record<StatKey, number>>;
  /**
   * 転生(Phase2 §18): 成長率(1レベルあたりの上昇量)への割合加算(単位は%)。
   * 「転生ボーナス(RebirthConfig.growthBonusPercent × rebirth回数)」と
   * 「転生ノードの GROWTH_PERCENT 効果」の合計値を呼び出し側(computeOwnedStats)で
   * 合算して渡す。growth 自体に効くので、レベル成長の一番最初に適用する。
   */
  growthPercent?: Partial<Record<StatKey, number>>;
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
 *   1. growth' = growth × (1 + growthPercent[key] / 100)  …… 転生の成長率ボーナス(Phase2 §18)
 *      base + growth' * (level - 1)                       …… レベル成長
 *   2. + rebirthPoints[key]                            …… 転生ポイント旧形式(非推奨。互換のみ)
 *   3. + rebirthFlat[key]                              …… 転生ノード STAT_FLAT(Phase2)
 *   4. + equipmentFlat[key]                             …… 装備の固定値加算(Phase3)
 *   5. × (1 + limitBreakRate * limitBreak)              …… 限界突破(Phase2。現状は係数0=無効)
 *   6. × (1 + rebirthPercent[key] / 100)                …… 転生ノード STAT_PERCENT(Phase2)
 *   7. × (1 + equipmentPercent[key] / 100)              …… 装備の%加算(Phase3)
 * 「装備の%は装備フラット適用後の値に対する割合」という仕様(docs/API.md §3)を満たすため、
 * equipmentPercent は必ず他のすべての加算・乗算より後に適用する。
 * 転生の%(rebirthPercent)はそれより手前、装備の直前に適用する
 * (= 装備%は「転生込みの素の値」にもかかる、一番外側の乗算という位置づけを維持する)。
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
    // --- 手順1: 転生の成長率ボーナスを growth 自体に先に適用してからレベル成長を計算する ---
    const growthBonus = mods.growthPercent?.[key];
    const perLevel = (growth?.[key] ?? 0) * (1 + (typeof growthBonus === 'number' ? growthBonus / 100 : 0));
    let value = baseStats[key] + perLevel * (lv - 1);

    // --- 手順2: 転生ポイント旧形式: 単純加算(非推奨。互換のみ) ---
    const rebirth = mods.rebirthPoints?.[key];
    if (typeof rebirth === 'number') value += rebirth;

    // --- 手順3: 転生ノード(フラット): STAT_FLAT 効果の加算値 ---
    const rebirthFlat = mods.rebirthFlat?.[key];
    if (typeof rebirthFlat === 'number') value += rebirthFlat;

    // --- 手順4: 装備(フラット): 装備解決済みの加算値を加える ---
    const equipFlat = mods.equipmentFlat?.[key];
    if (typeof equipFlat === 'number') value += equipFlat;

    // --- 手順5: 限界突破: 乗算補正(現状は係数0 = 無効) ---
    // if (mods.limitBreak) value *= 1 + LIMIT_BREAK_RATE * mods.limitBreak;

    // --- 手順6: 転生ノード(%): STAT_PERCENT 効果。装備%の直前に適用する ---
    const rebirthPercent = mods.rebirthPercent?.[key];
    if (typeof rebirthPercent === 'number' && rebirthPercent !== 0) value *= 1 + rebirthPercent / 100;

    // --- 手順7: 装備(%): 「ここまでの値」に対する割合加算。必ず最後に適用する ---
    const equipPercent = mods.equipmentPercent?.[key];
    if (typeof equipPercent === 'number' && equipPercent !== 0) value *= 1 + equipPercent / 100;

    out[key] = roundStat(key, value);
  }
  return out;
}

/* ============================================================
 * 転生ノード効果の集計 (設計書§17〜§18)
 * ------------------------------------------------------------
 * `OwnedCharacter.rebirthNodes`(ノードID→取得ランク)と `RebirthNodeDef` の定義から、
 * ステータス計算に必要な値をここで集計する(サーバのみ・純粋関数。DB/fsに依存しないので
 * standalone からの import も安全)。
 * ========================================================== */

function forEachRebirthEffect(
  nodes: Record<string, number> | undefined,
  nodeDefs: Map<string, RebirthNodeDef> | undefined,
  visit: (effect: RebirthNodeDef['effects'][number], rank: number) => void,
): void {
  if (!nodes || !nodeDefs) return;
  for (const [nodeId, rank] of Object.entries(nodes)) {
    if (!rank || rank <= 0) continue;
    const def = nodeDefs.get(nodeId);
    // データ不整合(存在しないノードID)は起動時の参照整合性チェックとは別に、
    // ここでも黙って無視する(壊れたセーブでステータス計算自体を落とさないため)。
    if (!def) continue;
    for (const effect of def.effects) visit(effect, rank);
  }
}

export interface RebirthStatMods {
  /** STAT_FLAT の合計(ランク×効果量) */
  statFlat: Partial<Record<StatKey, number>>;
  /** STAT_PERCENT の合計(%) */
  statPercent: Partial<Record<StatKey, number>>;
  /** GROWTH_PERCENT の合計(%)。RebirthConfig.growthBonusPercent との合算は呼び出し側の責務 */
  growthPercent: Partial<Record<StatKey, number>>;
}

/** computeStats の rebirthFlat/rebirthPercent/growthPercent に渡す値を集計する */
export function resolveRebirthStatMods(
  nodes: Record<string, number> | undefined,
  nodeDefs: Map<string, RebirthNodeDef> | undefined,
): RebirthStatMods {
  const statFlat: Partial<Record<StatKey, number>> = {};
  const statPercent: Partial<Record<StatKey, number>> = {};
  const growthPercent: Partial<Record<StatKey, number>> = {};
  forEachRebirthEffect(nodes, nodeDefs, (effect, rank) => {
    if (!effect.stat) return;
    const amount = effect.value * rank;
    if (effect.kind === 'STAT_FLAT') statFlat[effect.stat] = (statFlat[effect.stat] ?? 0) + amount;
    else if (effect.kind === 'STAT_PERCENT') statPercent[effect.stat] = (statPercent[effect.stat] ?? 0) + amount;
    else if (effect.kind === 'GROWTH_PERCENT') growthPercent[effect.stat] = (growthPercent[effect.stat] ?? 0) + amount;
  });
  return { statFlat, statPercent, growthPercent };
}

/**
 * ステータスではない転生効果(SKILL_POWER / GAUGE_START / ULT_GAUGE_START)の集計。
 * computeStats の対象外なので、戦闘エンジンへ渡すための値をここで用意する。
 *
 * TODO(戦闘エンジン担当と要調整): `server/src/battle/contract.ts` の `CombatantInput` に
 * これらを受け取るフィールドが無いため、現時点では `toAllyCombatant`(battle-service.ts)
 * から実際に渡す先が無い。フィールド名が決まったら `toAllyCombatant` の該当箇所
 * (TODOコメントあり)に接続すること。
 */
export interface RebirthCombatMods {
  /** スキル威力への割合加算(%)の合計 */
  skillPowerPercent: number;
  /** 戦闘開始時の行動ゲージ(%)の合計 */
  gaugeStartPercent: number;
  /** 戦闘開始時の必殺ゲージ(%)の合計 */
  ultGaugeStartPercent: number;
}

export function resolveRebirthCombatMods(
  nodes: Record<string, number> | undefined,
  nodeDefs: Map<string, RebirthNodeDef> | undefined,
): RebirthCombatMods {
  const mods: RebirthCombatMods = { skillPowerPercent: 0, gaugeStartPercent: 0, ultGaugeStartPercent: 0 };
  forEachRebirthEffect(nodes, nodeDefs, (effect, rank) => {
    const amount = effect.value * rank;
    if (effect.kind === 'SKILL_POWER') mods.skillPowerPercent += amount;
    else if (effect.kind === 'GAUGE_START') mods.gaugeStartPercent += amount;
    else if (effect.kind === 'ULT_GAUGE_START') mods.ultGaugeStartPercent += amount;
  });
  return mods;
}

/**
 * 系統(RebirthPath)ごとの累計投資ポイント。`RebirthStatus.pathPoints` 用。
 * §19 のビルド分岐(散らすと上位ノードに届かない)を成立させる判定はサーバが必ず
 * ここから算出し、クライアントの申告は一切信用しない(呼び出し側は
 * services/rebirth-service.ts の requiresPathPoints 検証を参照)。
 */
export function computeRebirthPathPoints(
  nodes: Record<string, number> | undefined,
  nodeDefs: Map<string, RebirthNodeDef> | undefined,
): Record<RebirthPath, number> {
  const out = {} as Record<RebirthPath, number>;
  for (const p of REBIRTH_PATHS) out[p] = 0;
  if (!nodes || !nodeDefs) return out;
  for (const [nodeId, rank] of Object.entries(nodes)) {
    if (!rank || rank <= 0) continue;
    const def = nodeDefs.get(nodeId);
    if (!def) continue;
    out[def.path] += def.cost * rank;
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
 *
 * `rebirthNodeDefs` / `rebirthGrowthBonusPercent` を渡すと転生ノードの効果
 * (STAT_FLAT/STAT_PERCENT/GROWTH_PERCENT)を反映する(Phase2 §18)。
 * 省略時は転生ノード無しとして計算する(既存呼び出しを壊さないための後方互換)。
 * `rebirthGrowthBonusPercent` は `RebirthConfig.growthBonusPercent`(1転生あたりの%)を渡すこと。
 * ここで `owned.rebirth` 回数を掛けた値とノードの GROWTH_PERCENT を合算して growthPercent とする。
 */
export function computeOwnedStats(
  def: CharacterDef,
  owned: OwnedCharacter,
  equipmentByUid?: Map<string, EquipmentInstance>,
  rebirthNodeDefs?: Map<string, RebirthNodeDef>,
  rebirthGrowthBonusPercent = 0,
): Stats {
  const { statFlat, statPercent, growthPercent: nodeGrowthPercent } =
    resolveRebirthStatMods(owned.rebirthNodes, rebirthNodeDefs);
  const globalGrowthBonus = rebirthGrowthBonusPercent * (owned.rebirth || 0);
  const growthPercent: Partial<Record<StatKey, number>> = {};
  if (globalGrowthBonus !== 0 || Object.keys(nodeGrowthPercent).length > 0) {
    for (const key of STAT_KEYS) {
      const g = (nodeGrowthPercent[key] ?? 0) + globalGrowthBonus;
      if (g !== 0) growthPercent[key] = g;
    }
  }
  return computeStats(def.baseStats, def.growth, owned.level, {
    limitBreak: owned.limitBreak,
    rebirthPoints: owned.rebirthPoints,
    rebirthFlat: statFlat,
    rebirthPercent: statPercent,
    growthPercent,
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
 *
 * `rebirthCtx` (Phase2 §18・転生): レベルアップ時の statGain 表示に転生ノードの
 * 効果を反映させたい場合に渡す。省略時は転生ノード無しとして計算する(後方互換)。
 */
export function grantBattleExp(
  targets: RewardTarget[],
  stageExp: number,
  config: ProgressionConfig,
  survivedByUid?: Map<string, boolean>,
  rebirthCtx?: { nodeDefs: Map<string, RebirthNodeDef>; growthBonusPercent: number },
): GrantExpResult {
  const expPerMember = Math.max(0, Math.floor(stageExp || 0));
  const defeatedExp = Math.max(0, Math.round(expPerMember * DEFEATED_EXP_RATE));
  const updates: GrantedProgress[] = [];
  const levelUps: LevelUpInfo[] = [];

  for (const t of targets) {
    const survived = survivedByUid ? survivedByUid.get(t.owned.uid) ?? true : true;
    const amount = survived ? expPerMember : defeatedExp;
    const before = computeOwnedStats(t.def, t.owned, undefined, rebirthCtx?.nodeDefs, rebirthCtx?.growthBonusPercent);
    const result = applyExp({ level: t.owned.level, exp: t.owned.exp }, amount, config);
    const entry: GrantedProgress = { uid: t.owned.uid, level: result.level, exp: result.exp };

    if (result.leveledUp) {
      const after = computeOwnedStats(
        t.def,
        { ...t.owned, level: result.level },
        undefined,
        rebirthCtx?.nodeDefs,
        rebirthCtx?.growthBonusPercent,
      );
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
