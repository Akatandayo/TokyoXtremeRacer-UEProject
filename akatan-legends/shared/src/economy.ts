/**
 * 経済ルール(売却価格など)の唯一の定義。設計書§37「サーバ権威」の一部。
 *
 * ここに置く理由: 売却額の式がサーバ・クライアントのプレビュー・オフライン版の
 * 3箇所に複製されていて、オフライン版だけ itemLevel 補正を落としていた(同じ装備が
 * サーバとオフラインで違う額で売れる)という不具合があったため。式は必ずここだけに置く。
 */
import type { EquipmentInstance, ItemRarity } from './types.js';

/** レアリティ別の売却基準額(itemLevel 補正前)。バランス調整用の暫定値。 */
export const SELL_BASE_GOLD: Record<ItemRarity, number> = {
  COMMON: 10,
  UNCOMMON: 25,
  RARE: 60,
  EPIC: 150,
  LEGENDARY: 400,
  MYTHIC: 1000,
};

/** 装備1点の売却額。itemLevel 1 を基準に 1Lvごとに +5%。 */
export function sellPrice(item: Pick<EquipmentInstance, 'rarity' | 'itemLevel'>): number {
  const base = SELL_BASE_GOLD[item.rarity] ?? 10;
  return Math.round(base * (1 + Math.max(0, item.itemLevel - 1) * 0.05));
}
