/**
 * 装備生成(ハクスラの心臓部 / 設計書§22〜§23)
 * ------------------------------------------------------------
 * Base Item + Prefix + Suffix + ランダムステータス + 特殊効果 の構造で装備を生成する。
 *
 * サーバ権威(設計書§37): 装備の中身はここで確定させる。クライアントから
 * 数値や名前を受け取ることは一切ない。
 *
 * 決定論: `seed` + 入力パラメータが同じなら、`rollEquipment()` は
 * 必ず同じ `stats` / `statsPercent` / `special` / `name` / `prefixId` / `suffixId`
 * を返す(`uid` / `obtainedAt` はインスタンス生成のたびに変わるので対象外)。
 * 乱数は `server/src/battle/rng.ts` の `createRng`(mulberry32)を読み取り専用で再利用する。
 * 呼び出し順序を変えると同じシードでも違う結果になるため、このファイル内の
 * ロール順序(レアリティ → ベース選択 → Prefix → Suffix → ボーナスステータス行)
 * を変更しないこと。
 */
import { randomUUID } from 'node:crypto';
import type {
  AffixDef, AffixStatRange, EquipmentInstance, EquipmentSlot, ItemBaseDef,
  ItemRarity, ItemSpecialEffect, StatKey,
} from '@akatan/shared';
import { ITEM_RARITIES } from '@akatan/shared';
import { createRng, type Rng } from '../battle/rng.js';
import type { GameData } from '../data/loader.js';
import { STAT_KEYS as ALL_STAT_KEYS } from './progression.js';

/* ============================================================
 * コンテキスト(GameData から必要なマップだけを取り出す。テストしやすくするため)
 * ========================================================== */

export interface ItemGeneratorContext {
  bases: Map<string, ItemBaseDef>;
  affixes: Map<string, AffixDef>;
}

export function contextFromGameData(data: GameData): ItemGeneratorContext {
  return { bases: data.itemBases, affixes: data.affixes };
}

/* ============================================================
 * レアリティ別チューニング(設計書§23: オプション数・値の上限・特殊効果の有無に差を付ける)
 * ------------------------------------------------------------
 * `EquipmentInstance` は `prefixId` / `suffixId` を1個ずつしか持てない構造なので、
 * 「オプション数」は (a) Prefix/Suffix の付与数(0〜2)と、(b) 名前の付かない
 * ボーナスステータス行の本数、の2軸で表現する。
 * 具体的な数値はバランス調整用の暫定値であり、data/items/* 側のベース値・アフィックス
 * 範囲を変えるだけで(コード変更なしに)再調整できるようにしてある。
 * ========================================================== */

interface RarityTuning {
  /** Prefix/Suffix を何個付けるか (0/1/2) */
  affixCount: 0 | 1 | 2;
  /** 名前の付かないボーナスステータス行の本数 */
  bonusStatCount: number;
  /** ベースの mainValue に掛ける倍率 */
  valueScale: number;
  /** アフィックスが special を持っていた場合、実際に発動させる確率(%) */
  specialChancePercent: number;
}

const RARITY_TUNING: Record<ItemRarity, RarityTuning> = {
  COMMON: { affixCount: 0, bonusStatCount: 0, valueScale: 1.0, specialChancePercent: 0 },
  UNCOMMON: { affixCount: 1, bonusStatCount: 1, valueScale: 1.15, specialChancePercent: 0 },
  RARE: { affixCount: 2, bonusStatCount: 2, valueScale: 1.35, specialChancePercent: 20 },
  EPIC: { affixCount: 2, bonusStatCount: 3, valueScale: 1.6, specialChancePercent: 45 },
  LEGENDARY: { affixCount: 2, bonusStatCount: 4, valueScale: 1.9, specialChancePercent: 75 },
  MYTHIC: { affixCount: 2, bonusStatCount: 5, valueScale: 2.3, specialChancePercent: 100 },
};

/** レアリティ抽選の既定重み(バナー/ドロップ側で上書きしなかった場合に使う) */
export const DEFAULT_ITEM_RARITY_WEIGHTS: Record<ItemRarity, number> = {
  COMMON: 50,
  UNCOMMON: 27,
  RARE: 15,
  EPIC: 6,
  LEGENDARY: 1.7,
  MYTHIC: 0.3,
};

/** アイテムレベル1段階あたりのステータス増加率(base.mainPerLevel が無いベース向けの既定値) */
const ITEM_LEVEL_FLAT_SCALE = 0.08;

/** ボーナスステータス行が取りうるステータスと、その基準値(itemLevel=1 / COMMON 相当) */
const BONUS_STAT_BASE: Record<StatKey, number> = {
  hp: 8,
  attack: 3,
  defense: 2,
  speed: 1,
  critical: 0.5,
  criticalDamage: 1,
  resistance: 0.5,
  healing: 0.5,
};

/** ボーナス行で「%」表記になりうるステータス(フラット2重取りを避けるため主要4種のみ) */
const PERCENT_ELIGIBLE_STATS: StatKey[] = ['hp', 'attack', 'defense', 'speed'];

function rarityIndex(r: ItemRarity): number {
  return ITEM_RARITIES.indexOf(r);
}

/* ============================================================
 * レアリティ抽選
 * ========================================================== */

function rollRarity(rng: Rng, weights?: Partial<Record<ItemRarity, number>>): ItemRarity {
  const table = weights && Object.values(weights).some((v) => (v ?? 0) > 0) ? weights : DEFAULT_ITEM_RARITY_WEIGHTS;
  const entries = ITEM_RARITIES
    .map((r) => ({ rarity: r, weight: Math.max(0, table[r] ?? 0) }))
    .filter((e) => e.weight > 0);
  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  if (total <= 0) return 'COMMON';
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.rarity;
  }
  return entries[entries.length - 1].rarity;
}

/* ============================================================
 * ベース選択
 * ========================================================== */

function eligibleBases(ctx: ItemGeneratorContext, rarity: ItemRarity, slot?: EquipmentSlot): ItemBaseDef[] {
  const idx = rarityIndex(rarity);
  const list = [...ctx.bases.values()].filter((b) => {
    if (slot && b.slot !== slot) return false;
    const minIdx = b.minRarity ? rarityIndex(b.minRarity) : 0;
    return minIdx <= idx;
  });
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

function pickBase(
  ctx: ItemGeneratorContext,
  rng: Rng,
  rarity: ItemRarity,
  slot?: EquipmentSlot,
  baseId?: string,
): ItemBaseDef | undefined {
  if (baseId) {
    const forced = ctx.bases.get(baseId);
    if (forced) return forced;
    // 指定IDが見つからない場合は通常の抽選にフォールバック(データ不整合で丸ごと失敗させない)
  }
  const pool = eligibleBases(ctx, rarity, slot);
  if (pool.length === 0) return undefined;
  return rng.pick(pool);
}

/* ============================================================
 * アフィックス選択
 * ========================================================== */

function eligibleAffixes(
  ctx: ItemGeneratorContext,
  kind: AffixDef['kind'],
  rarity: ItemRarity,
  slot: EquipmentSlot,
): AffixDef[] {
  const idx = rarityIndex(rarity);
  const list = [...ctx.affixes.values()].filter((a) => {
    if (a.kind !== kind) return false;
    if (a.slots && a.slots.length > 0 && !a.slots.includes(slot)) return false;
    const minIdx = a.minRarity ? rarityIndex(a.minRarity) : 0;
    return minIdx <= idx;
  });
  return list.sort((a, b) => a.id.localeCompare(b.id));
}

function pickAffixes(
  ctx: ItemGeneratorContext,
  rng: Rng,
  rarity: ItemRarity,
  slot: EquipmentSlot,
  affixCount: 0 | 1 | 2,
): { prefix?: AffixDef; suffix?: AffixDef } {
  if (affixCount === 0) return {};
  const prefixPool = eligibleAffixes(ctx, 'PREFIX', rarity, slot);
  const suffixPool = eligibleAffixes(ctx, 'SUFFIX', rarity, slot);

  if (affixCount === 2) {
    return {
      prefix: prefixPool.length > 0 ? rng.pick(prefixPool) : undefined,
      suffix: suffixPool.length > 0 ? rng.pick(suffixPool) : undefined,
    };
  }

  // affixCount === 1: Prefix/Suffix のどちらか1つだけ付ける
  const preferPrefix = rng.chance(50);
  if (preferPrefix && prefixPool.length > 0) return { prefix: rng.pick(prefixPool) };
  if (suffixPool.length > 0) return { suffix: rng.pick(suffixPool) };
  if (prefixPool.length > 0) return { prefix: rng.pick(prefixPool) };
  return {};
}

/* ============================================================
 * ステータス値の丸め・合算
 * ========================================================== */

function roundValue(key: StatKey, value: number): number {
  if (!Number.isFinite(value)) return 0;
  const isPercentLikeStat = key === 'critical' || key === 'criticalDamage' || key === 'resistance' || key === 'healing';
  return isPercentLikeStat ? Math.round(value * 10) / 10 : Math.round(value);
}

function addStat(map: Partial<Record<StatKey, number>>, key: StatKey, value: number): void {
  map[key] = roundValue(key, (map[key] ?? 0) + value);
}

function rollAffixRange(rng: Rng, range: AffixStatRange, itemLevel: number, valueScale: number): number {
  const lo = Math.min(range.min, range.max);
  const hi = Math.max(range.min, range.max);
  const base = lo + rng.next() * (hi - lo);
  const levelMult = 1 + (itemLevel - 1) * ITEM_LEVEL_FLAT_SCALE;
  return base * levelMult * valueScale;
}

function rollBonusStats(
  rng: Rng,
  stats: Partial<Record<StatKey, number>>,
  statsPercent: Partial<Record<StatKey, number>>,
  count: number,
  itemLevel: number,
  rarity: ItemRarity,
): void {
  if (count <= 0) return;
  const idx = rarityIndex(rarity);
  const levelMult = 1 + (itemLevel - 1) * ITEM_LEVEL_FLAT_SCALE;
  const rarityMult = 1 + idx * 0.25;
  for (let i = 0; i < count; i += 1) {
    // ボーナス行の対象ステータスは全 StatKey から抽選する。
    // 主ステータスと重複しても「加算されるだけ」なので、除外はせず単純化している。
    const key = ALL_STAT_KEYS[rng.int(0, ALL_STAT_KEYS.length - 1)];
    const asPercent = PERCENT_ELIGIBLE_STATS.includes(key) && rng.chance(35);
    const baseValue = BONUS_STAT_BASE[key] * (0.7 + rng.next() * 0.6); // ±30%のばらつき
    if (asPercent) {
      // %行は控えめに(1〜数%の加算)
      const pct = baseValue * 0.4 * levelMult * rarityMult;
      addStat(statsPercent, key, pct);
    } else {
      const flat = baseValue * levelMult * rarityMult;
      addStat(stats, key, flat);
    }
  }
}

/* ============================================================
 * 表示名生成
 * ------------------------------------------------------------
 * 例: Prefix "灼熱の" + Base "古びた剣" + Suffix "護り" -> 「灼熱の古びた剣・護り」
 * ========================================================== */

function buildName(base: ItemBaseDef, prefix?: AffixDef, suffix?: AffixDef): string {
  let name = base.name;
  if (prefix) name = `${prefix.name}${name}`;
  if (suffix) {
    // Suffix 定義名が「〜の」「・」等の装飾で始まっていても二重にならないよう剥がしてから繋ぐ
    const label = suffix.name.replace(/^[〜・]+/, '');
    name = `${name}・${label}`;
  }
  return name;
}

/* ============================================================
 * 公開API
 * ========================================================== */

export interface GenerateEquipmentParams {
  /** ドロップ元ステージ/バナー設定の敵レベル相当。1未満は1に丸める */
  itemLevel: number;
  /** 生成に使うシード。省略時は呼び出し側で決めた乱数を渡すこと(このモジュールでは生成しない) */
  seed: number;
  /** 省略時はレアリティ抽選を行う */
  rarity?: ItemRarity;
  rarityWeights?: Partial<Record<ItemRarity, number>>;
  /** 出現スロットを固定したい場合 */
  slot?: EquipmentSlot;
  /** 特定のベースを強制したい場合(見つからなければ通常抽選にフォールバック) */
  baseId?: string;
}

/**
 * 決定論的な中核ロジック。uid/obtainedAt を含まない「再現可能な部分」だけを返す。
 * 同じ ctx(内容が同じ限り)・同じ params なら必ず同じ結果になる。
 * ベース候補が1件も無い場合(データ未作成/スロット不一致)は null を返す。
 */
export function rollEquipment(
  ctx: ItemGeneratorContext,
  params: GenerateEquipmentParams,
): Omit<EquipmentInstance, 'uid' | 'obtainedAt' | 'equippedBy'> | null {
  const rng = createRng(params.seed);
  const itemLevel = Math.max(1, Math.floor(params.itemLevel || 1));

  // 1. レアリティ
  const rarity = params.rarity ?? rollRarity(rng, params.rarityWeights);
  const tuning = RARITY_TUNING[rarity];

  // 2. ベース選択
  const base = pickBase(ctx, rng, rarity, params.slot, params.baseId);
  if (!base) return null;

  // 3. 主ステータス(ベース値 + itemLevel補正 + レアリティ倍率)
  const perLevel = base.mainPerLevel ?? Math.max(1, Math.round(base.mainValue * 0.1));
  const mainValue = (base.mainValue + perLevel * (itemLevel - 1)) * tuning.valueScale;
  const stats: Partial<Record<StatKey, number>> = {};
  addStat(stats, base.mainStat, mainValue);
  const statsPercent: Partial<Record<StatKey, number>> = {};

  // 4. Prefix / Suffix
  const { prefix, suffix } = pickAffixes(ctx, rng, rarity, base.slot, tuning.affixCount);
  let special: ItemSpecialEffect | undefined;
  for (const affix of [prefix, suffix]) {
    if (!affix) continue;
    for (const range of affix.stats ?? []) {
      const v = rollAffixRange(rng, range, itemLevel, tuning.valueScale);
      addStat(range.percent ? statsPercent : stats, range.stat, v);
    }
    if (!special && affix.special && rng.chance(tuning.specialChancePercent)) {
      special = affix.special;
    }
  }

  // 5. ボーナスステータス行(名前の付かない追加オプション。レアリティが高いほど本数が増える)
  rollBonusStats(rng, stats, statsPercent, tuning.bonusStatCount, itemLevel, rarity);

  const name = buildName(base, prefix, suffix);

  const result: Omit<EquipmentInstance, 'uid' | 'obtainedAt' | 'equippedBy'> = {
    baseId: base.id,
    slot: base.slot,
    rarity,
    name,
    itemLevel,
    stats,
    seed: params.seed,
  };
  if (prefix) result.prefixId = prefix.id;
  if (suffix) result.suffixId = suffix.id;
  if (Object.keys(statsPercent).length > 0) result.statsPercent = statsPercent;
  if (special) result.special = special;
  return result;
}

/** 実際に所持品として使える EquipmentInstance(uid/obtainedAt 付き)を生成する */
export function generateEquipment(
  ctx: ItemGeneratorContext,
  params: GenerateEquipmentParams,
): EquipmentInstance | null {
  const core = rollEquipment(ctx, params);
  if (!core) return null;
  return {
    ...core,
    uid: `eq_${randomUUID()}`,
    obtainedAt: new Date().toISOString(),
  };
}
