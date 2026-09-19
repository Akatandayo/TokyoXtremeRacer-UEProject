/** 装備(ハクスラ)まわりの表示ヘルパー */
import type {
  EquipmentInstance, CharacterView, InventoryResponse, Stats, StatKey, ItemRarity,
} from '@akatan/shared';
import { ITEM_RARITY_ORDER, STAT_LABEL, formatNumber } from './labels';

export function equipmentOf(inv: InventoryResponse | null, uid?: string): EquipmentInstance | undefined {
  if (!inv || !uid) return undefined;
  return inv.equipment.find((e) => e.uid === uid);
}

/** キャラが現在装着している装備一式(スロット順) */
export function equippedItemsOf(view: CharacterView, inv: InventoryResponse | null): EquipmentInstance[] {
  const slots = view.owned.equipment;
  if (!slots || !inv) return [];
  return (['WEAPON', 'ARMOR', 'ACCESSORY'] as const)
    .map((s) => (slots[s] ? equipmentOf(inv, slots[s]) : undefined))
    .filter((e): e is EquipmentInstance => !!e);
}

export interface StatDelta {
  key: StatKey;
  delta: number;
  percent: boolean;
}

/**
 * ソート/絞り込みの対象にできる能力値。`Stats`(shared/src/types.ts)が持つ
 * 全フィールドと一致させること。ここに無いキーは並び替え・絞り込みの選択肢に出さない。
 */
export const EQUIPMENT_STAT_KEYS: StatKey[] = [
  'hp', 'attack', 'defense', 'speed', 'critical', 'criticalDamage', 'resistance', 'healing',
];

/**
 * 一覧のソート/絞り込み用に、装備1個が持つ特定ステータスの「実効値」を返す。
 *
 * - `item.stats` は生成時点で mainStat + フラットaffix + ボーナス行が既に合算済みの値
 *   (server/src/services/item-generator.ts の rollEquipment 参照)。
 * - `item.statsPercent` は「装着したキャラの現在値に対する加算率」であり、装備単体では
 *   基準となるキャラのステータスが定まらないため正確なフラット換算はできない
 *   (statDeltasOf() がキャラの baseline ありきで概算しているのと同じ理由)。
 *
 * 一覧はキャラに依存しない並び替え/絞り込みなので、ここでは両者を単純に加算した値を
 * 「目安の実効値」として使う。画面上の内訳表示(ItemStatsList)は従来通りflat/%を分けて見せる。
 */
export function equipmentStatValue(item: EquipmentInstance, key: StatKey): number {
  return (item.stats[key] ?? 0) + (item.statsPercent?.[key] ?? 0);
}

/**
 * 装備の flat/percent ステータスを、"現在のキャラの計算済みステータス" に対する
 * 概算の増減量として展開する(装着前の比較表示専用。最終的な確定値はサーバ計算)。
 */
export function statDeltasOf(item: EquipmentInstance, baseline: Stats): StatDelta[] {
  const out: StatDelta[] = [];
  for (const [k, v] of Object.entries(item.stats)) {
    if (!v) continue;
    out.push({ key: k as StatKey, delta: v, percent: false });
  }
  if (item.statsPercent) {
    for (const [k, pct] of Object.entries(item.statsPercent)) {
      if (!pct) continue;
      const key = k as StatKey;
      const applied = Math.round((baseline[key] ?? 0) * (pct / 100));
      out.push({ key, delta: applied, percent: true });
    }
  }
  return out;
}

/** 装着プレビュー: 新しい装備を着けた場合(既存装備があれば入れ替え)の合計デルタ */
export function combinedDelta(
  baseline: Stats,
  next: EquipmentInstance,
  prev: EquipmentInstance | undefined,
): Map<StatKey, number> {
  const map = new Map<StatKey, number>();
  const add = (item: EquipmentInstance, sign: 1 | -1) => {
    for (const d of statDeltasOf(item, baseline)) {
      map.set(d.key, (map.get(d.key) ?? 0) + d.delta * sign);
    }
  };
  add(next, 1);
  if (prev) add(prev, -1);
  return map;
}

export function formatSigned(n: number): string {
  const r = Math.round(n);
  if (r === 0) return '±0';
  return r > 0 ? `+${formatNumber(r)}` : formatNumber(r);
}

export function statDeltaLabel(key: StatKey, value: number): string {
  const isPct = key === 'critical' || key === 'criticalDamage' || key === 'resistance' || key === 'healing';
  const v = isPct ? Math.round(value * 10) / 10 : Math.round(value);
  const sign = v > 0 ? '+' : v < 0 ? '' : '±';
  return `${STAT_LABEL[key]} ${sign}${v}${isPct ? '%' : ''}`;
}

/* ============================================================
 * 一括売却プレビュー(第6ラウンド)
 * ------------------------------------------------------------
 * 売却額の式は shared/src/economy.ts の sellPrice() が唯一の定義。ここでは再実装せず
 * そのまま使い、実行前の確認ダイアログで「いくら入るか」を確定値として見せる。
 * 実行後は必ずサーバ応答の `gold` で上書きする(ここはあくまで確認用のプレビュー)。
 * ========================================================== */
export { SELL_BASE_GOLD, sellPrice } from '@akatan/shared';
import { sellPrice } from '@akatan/shared';

/** @deprecated shared の sellPrice() を直接使ってください(名前だけの互換エイリアス)。 */
export const sellPriceEstimate = sellPrice;

export interface BulkSellPreview {
  /** 売却対象(装着中・お気に入りを除く) */
  toSell: EquipmentInstance[];
  /** 対象レアリティ/Lv条件には合うが、装着中またはお気に入りで除外された件数 */
  skipped: number;
  /** toSell の売却額合計(概算。実際の金額は実行後のサーバ応答を必ず使う) */
  gold: number;
}

/**
 * `maxRarity` 以下(`belowItemLevel` を指定した場合はそれ未満)を対象に、
 * 一括売却の実行前プレビューを計算する。装着中・お気に入りは対象から除外し、
 * `skipped` として件数だけ数える(実際の売却では消えない)。
 */
export function estimateBulkSell(
  equipment: EquipmentInstance[],
  maxRarity: ItemRarity,
  belowItemLevel?: number,
): BulkSellPreview {
  const cutoff = ITEM_RARITY_ORDER[maxRarity];
  const toSell: EquipmentInstance[] = [];
  let skipped = 0;
  for (const item of equipment) {
    if (ITEM_RARITY_ORDER[item.rarity] > cutoff) continue;
    if (belowItemLevel !== undefined && item.itemLevel >= belowItemLevel) continue;
    if (item.equippedBy || item.favorite) {
      skipped += 1;
      continue;
    }
    toSell.push(item);
  }
  const gold = toSell.reduce((sum, item) => sum + sellPriceEstimate(item), 0);
  return { toSell, skipped, gold };
}
