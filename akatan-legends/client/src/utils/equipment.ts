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
 * サーバの sellPrice() (server/src/services/equipment-service.ts) と同じ計算式を
 * ここに写し、実行前の確認ダイアログで「いくら入るか」を確定値として見せる。
 * 実行後は必ずサーバ応答の `gold` で上書きする(ここはあくまで確認用のプレビュー)。
 * ========================================================== */
export const SELL_BASE_GOLD: Record<ItemRarity, number> = {
  COMMON: 10,
  UNCOMMON: 25,
  RARE: 60,
  EPIC: 150,
  LEGENDARY: 400,
  MYTHIC: 1000,
};

export function sellPriceEstimate(item: EquipmentInstance): number {
  const base = SELL_BASE_GOLD[item.rarity] ?? 10;
  return Math.round(base * (1 + Math.max(0, item.itemLevel - 1) * 0.05));
}

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
