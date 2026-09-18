/**
 * 装備の装着/付け替え/売却 + インベントリ組み立て
 * ------------------------------------------------------------
 * 設計書§37: 装備の効果反映はサーバが `computeStatsWithEquipment` (progression.ts) 経由で
 * 必ず再計算する。クライアントからの「装備後のステータス」は一切受け取らない。
 *
 * SLOT_MISMATCH の扱い(EquipRequest/UnequipRequest には明示的な slot フィールドが無いため):
 *   - 装備インスタンス自身の slot が EQUIPMENT_SLOTS の値でない(データ不整合)場合
 *   - unequip の `slot` フィールドが EQUIPMENT_SLOTS の値でない場合
 *   のいずれかでこのコードを返す。装備は常に自身の slot にしか付けられない設計なので、
 *   「別スロット用の装備を無理やり装着しようとする」という意味でのミスマッチは
 *   API上そもそも起こり得ない(EquipRequest が slot を受け取らないため)。
 */
import type {
  CharacterView, EquipmentInstance, EquipmentSlot, EquipResponse, InventoryResponse, SellEquipmentResponse,
} from '@akatan/shared';
import { EQUIPMENT_SLOTS } from '@akatan/shared';
import * as repo from '../db/repository.js';
import type { GameData } from '../data/loader.js';
import { alreadyEquipped, badRequest, notFound, slotMismatch } from './app-error.js';
import { buildCharacterView } from './player-service.js';

/* ============================================================
 * インベントリ組み立て
 * ========================================================== */

export function buildInventoryResponse(playerId: string, data: GameData): InventoryResponse {
  const equipment = repo.listEquipment(playerId);
  const allMaterials = repo.listMaterials(playerId);
  const materials = allMaterials.filter((m) => !data.ticketMaterialIds.has(m.id));
  const tickets = allMaterials.filter((m) => data.ticketMaterialIds.has(m.id));
  return { equipment, materials, tickets };
}

/** playerId の全装備を uid -> EquipmentInstance の Map にする(ステータス計算の一括引き当て用) */
export function equipmentByUidMap(playerId: string): Map<string, EquipmentInstance> {
  return new Map(repo.listEquipment(playerId).map((e) => [e.uid, e]));
}

/* ============================================================
 * 装着
 * ========================================================== */

export function equipItem(
  playerId: string,
  data: GameData,
  equipmentUidRaw: unknown,
  characterUidRaw: unknown,
): EquipResponse {
  if (typeof equipmentUidRaw !== 'string' || equipmentUidRaw.length === 0) {
    throw badRequest('equipmentUid は必須の文字列です');
  }
  if (typeof characterUidRaw !== 'string' || characterUidRaw.length === 0) {
    throw badRequest('characterUid は必須の文字列です');
  }
  const equipmentUid = equipmentUidRaw;
  const characterUid = characterUidRaw;

  const item = repo.findEquipment(playerId, equipmentUid);
  if (!item) throw notFound(`所持していない装備です: ${equipmentUid}`);
  if (!EQUIPMENT_SLOTS.includes(item.slot)) {
    throw slotMismatch(`装備データのスロットが不正です: ${equipmentUid} (${item.slot})`);
  }
  const owned = repo.findOwnedCharacter(playerId, characterUid);
  if (!owned) throw notFound(`所持していないキャラクターです: ${characterUid}`);

  // 既に自分自身が装着中なら実質no-op(冪等に成功扱い)。他キャラが装着中なら拒否。
  if (item.equippedBy && item.equippedBy !== characterUid) {
    throw alreadyEquipped(
      `この装備は既に他のキャラクターが装着しています: ${equipmentUid} (equippedBy=${item.equippedBy})`,
      { equipmentUid, equippedBy: item.equippedBy },
    );
  }

  repo.inTransaction(() => {
    // 同じスロットに既に別の装備があれば自動的に外す(付け替え)
    const currentInSlot = owned.equipment?.[item.slot];
    if (currentInSlot && currentInSlot !== item.uid) {
      repo.setEquipmentEquippedBy(playerId, currentInSlot, null);
    }
    repo.setEquipmentEquippedBy(playerId, item.uid, characterUid);
    repo.setCharacterEquipmentSlot(playerId, characterUid, item.slot, item.uid);
  });

  const updatedOwned = repo.findOwnedCharacter(playerId, characterUid);
  if (!updatedOwned) throw notFound(`キャラクターが見つかりません: ${characterUid}`);
  const def = data.characters.get(updatedOwned.defId);
  if (!def) throw notFound(`キャラクター定義が見つかりません: ${updatedOwned.defId}`);

  const character: CharacterView = buildCharacterView(updatedOwned, def, data, equipmentByUidMap(playerId));
  return { character, inventory: buildInventoryResponse(playerId, data) };
}

/* ============================================================
 * 取り外し
 * ========================================================== */

export interface UnequipResult {
  character: CharacterView;
  inventory: InventoryResponse;
}

export function unequipItem(
  playerId: string,
  data: GameData,
  characterUidRaw: unknown,
  slotRaw: unknown,
): UnequipResult {
  if (typeof characterUidRaw !== 'string' || characterUidRaw.length === 0) {
    throw badRequest('characterUid は必須の文字列です');
  }
  if (typeof slotRaw !== 'string' || !EQUIPMENT_SLOTS.includes(slotRaw as EquipmentSlot)) {
    throw slotMismatch(`slot は ${EQUIPMENT_SLOTS.join('/')} のいずれかである必要があります: ${String(slotRaw)}`);
  }
  const characterUid = characterUidRaw;
  const slot = slotRaw as EquipmentSlot;

  const owned = repo.findOwnedCharacter(playerId, characterUid);
  if (!owned) throw notFound(`所持していないキャラクターです: ${characterUid}`);

  const equippedUid = owned.equipment?.[slot];
  if (equippedUid) {
    repo.inTransaction(() => {
      repo.setEquipmentEquippedBy(playerId, equippedUid, null);
      repo.setCharacterEquipmentSlot(playerId, characterUid, slot, null);
    });
  }

  const updatedOwned = repo.findOwnedCharacter(playerId, characterUid);
  if (!updatedOwned) throw notFound(`キャラクターが見つかりません: ${characterUid}`);
  const def = data.characters.get(updatedOwned.defId);
  if (!def) throw notFound(`キャラクター定義が見つかりません: ${updatedOwned.defId}`);

  const character: CharacterView = buildCharacterView(updatedOwned, def, data, equipmentByUidMap(playerId));
  return { character, inventory: buildInventoryResponse(playerId, data) };
}

/* ============================================================
 * 売却
 * ========================================================== */

/** レアリティ別の売却基準額(itemLevel 補正込み)。バランス調整用の暫定値。 */
const SELL_BASE_GOLD: Record<EquipmentInstance['rarity'], number> = {
  COMMON: 10,
  UNCOMMON: 25,
  RARE: 60,
  EPIC: 150,
  LEGENDARY: 400,
  MYTHIC: 1000,
};

function sellPrice(item: EquipmentInstance): number {
  const base = SELL_BASE_GOLD[item.rarity] ?? 10;
  return Math.round(base * (1 + Math.max(0, item.itemLevel - 1) * 0.05));
}

export function sellEquipment(
  playerId: string,
  data: GameData,
  equipmentUidsRaw: unknown,
): SellEquipmentResponse {
  if (!Array.isArray(equipmentUidsRaw) || equipmentUidsRaw.length === 0) {
    throw badRequest('equipmentUids は1件以上の配列である必要があります');
  }
  if (equipmentUidsRaw.some((v) => typeof v !== 'string' || v.length === 0)) {
    throw badRequest('equipmentUids の各要素は文字列(uid)である必要があります');
  }
  const uids = [...new Set(equipmentUidsRaw as string[])];

  const items: EquipmentInstance[] = [];
  for (const uid of uids) {
    const item = repo.findEquipment(playerId, uid);
    if (!item) throw notFound(`所持していない装備です: ${uid}`);
    if (item.equippedBy) {
      throw alreadyEquipped(`装着中の装備は売却できません(先に外してください): ${uid}`, { equipmentUid: uid, equippedBy: item.equippedBy });
    }
    items.push(item);
  }

  const gold = items.reduce((sum, item) => sum + sellPrice(item), 0);

  repo.inTransaction(() => {
    for (const item of items) repo.deleteEquipment(playerId, item.uid);
    if (gold > 0) repo.addGold(playerId, gold);
  });

  return {
    gold,
    player: repoPlayerProfileOrThrow(playerId),
    inventory: buildInventoryResponse(playerId, data),
  };
}

function repoPlayerProfileOrThrow(playerId: string) {
  const player = repo.findPlayer(playerId);
  if (!player) throw notFound(`プレイヤーが見つかりません: ${playerId}`);
  return player;
}
