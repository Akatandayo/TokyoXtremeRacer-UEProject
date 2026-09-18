/**
 * デモモード用の API 実装。
 * `?mock=1` または 設定画面のトグルで有効になり、バックエンド無しで全画面が動く。
 */
import type {
  PlayerStateResponse, CharacterListResponse, MasterDataResponse,
  DungeonListResponse, UpdatePartyResponse, BattleStartResponse, StageDef,
  InventoryResponse, EquipResponse, SellEquipmentResponse, GachaListResponse,
  GachaPullResponse, EquipmentSlot, CharacterView,
  RebirthStatusResponse, RebirthResponse, ResetRebirthResponse,
} from '@akatan/shared';
import {
  MOCK_CHARACTERS, MOCK_ENEMIES, MOCK_SKILLS, MOCK_AI_PROFILES, MOCK_CHAPTERS, MOCK_COMBOS,
  MOCK_PLANNED_CHARACTERS, MOCK_MATERIALS,
} from './master';
import { mockState, mockCharacterViews, expToNext } from './player';
import { generateMockBattle } from './battle';
import { rollMockDrops } from './equipment';
import { MOCK_BANNERS, pullBanner } from './gacha';
import {
  MOCK_REBIRTH_CONFIG, MOCK_REBIRTH_NODES,
  getMockRebirthStatus, performMockRebirth, allocateMockRebirth, resetMockRebirth,
} from './rebirth';
import { ApiClientError } from '../api/client';

function cloneInventory(): InventoryResponse {
  return {
    equipment: mockState.inventory.equipment.map((e) => ({ ...e })),
    materials: mockState.inventory.materials.map((m) => ({ ...m })),
    tickets: mockState.inventory.tickets.map((t) => ({ ...t })),
  };
}

function findCharacterView(uid: string): CharacterView | undefined {
  return mockCharacterViews().find((v) => v.owned.uid === uid);
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function findStage(stageId: string): StageDef | undefined {
  for (const c of MOCK_CHAPTERS) {
    const s = c.stages.find((x) => x.id === stageId);
    if (s) return s;
  }
  return undefined;
}

export const mockApi = {
  async getPlayer(): Promise<PlayerStateResponse> {
    await delay(120);
    return {
      player: { ...mockState.player },
      characters: mockCharacterViews(),
      party: { ...mockState.party, members: [...mockState.party.members] },
      inventory: cloneInventory(),
    };
  },

  async getCharacters(): Promise<CharacterListResponse> {
    await delay(80);
    return { characters: mockCharacterViews() };
  },

  async getMaster(): Promise<MasterDataResponse> {
    await delay(90);
    return {
      characters: MOCK_CHARACTERS,
      enemies: MOCK_ENEMIES,
      skills: MOCK_SKILLS,
      aiProfiles: MOCK_AI_PROFILES,
      chapters: MOCK_CHAPTERS,
      combos: MOCK_COMBOS,
      materials: MOCK_MATERIALS,
      plannedCharacters: MOCK_PLANNED_CHARACTERS,
      rebirthNodes: MOCK_REBIRTH_NODES,
      rebirthConfig: MOCK_REBIRTH_CONFIG,
    };
  },

  async getDungeons(): Promise<DungeonListResponse> {
    await delay(80);
    return { chapters: MOCK_CHAPTERS, clearedStages: [...mockState.player.clearedStages] };
  },

  async updateParty(members: (string | null)[]): Promise<UpdatePartyResponse> {
    await delay(100);
    mockState.party = { ...mockState.party, members: members.slice(0, 5) };
    return { party: { ...mockState.party, members: [...mockState.party.members] } };
  },

  async updateAi(uid: string, aiProfile: string): Promise<unknown> {
    await delay(80);
    const o = mockState.owned.find((x) => x.uid === uid);
    if (o) o.aiProfile = aiProfile;
    return { ok: true };
  },

  async startBattle(stageId: string, members?: (string | null)[]): Promise<BattleStartResponse> {
    await delay(260);
    const stage = findStage(stageId);
    if (!stage) throw new Error(`stage not found: ${stageId}`);

    const uids = (members ?? mockState.party.members).filter((m): m is string => !!m);
    const views = mockCharacterViews();
    const party = uids
      .map((uid) => views.find((v) => v.owned.uid === uid))
      .filter((v): v is NonNullable<typeof v> => !!v);

    if (party.length === 0) {
      throw new Error('パーティが空です');
    }

    const log = generateMockBattle(party, stage);
    const rewards = log.result.rewards ?? null;

    if (log.result.victory && rewards) {
      mockState.player = {
        ...mockState.player,
        gold: mockState.player.gold + rewards.gold,
        clearedStages: mockState.player.clearedStages.includes(stage.id)
          ? mockState.player.clearedStages
          : [...mockState.player.clearedStages, stage.id],
      };
      for (const uid of uids) {
        const o = mockState.owned.find((x) => x.uid === uid);
        if (!o) continue;
        o.exp += rewards.exp;
        while (o.exp >= expToNext(o.level) && o.level < 99) {
          o.exp -= expToNext(o.level);
          o.level += 1;
        }
      }
    }

    const drops = rollMockDrops(stage, log.result.victory);
    if (drops && drops.gold > 0) {
      mockState.player = { ...mockState.player, gold: mockState.player.gold + drops.gold };
    }

    return {
      log,
      rewards,
      player: { ...mockState.player },
      characters: mockCharacterViews(),
      stage,
      drops,
      inventory: cloneInventory(),
    };
  },

  async getInventory(): Promise<InventoryResponse> {
    await delay(80);
    return cloneInventory();
  },

  async equip(equipmentUid: string, characterUid: string): Promise<EquipResponse> {
    await delay(120);
    const item = mockState.inventory.equipment.find((e) => e.uid === equipmentUid);
    if (!item) throw new ApiClientError('NOT_FOUND', '装備が見つかりません。');
    const owned = mockState.owned.find((o) => o.uid === characterUid);
    if (!owned) throw new ApiClientError('NOT_FOUND', 'キャラクターが見つかりません。');
    if (item.equippedBy && item.equippedBy !== characterUid) {
      throw new ApiClientError('ALREADY_EQUIPPED', 'この装備はすでに他のキャラクターが装着しています。');
    }

    // 同スロットの既存装備があれば外す
    const prevUid = owned.equipment?.[item.slot];
    if (prevUid) {
      const prevItem = mockState.inventory.equipment.find((e) => e.uid === prevUid);
      if (prevItem) prevItem.equippedBy = undefined;
    }
    owned.equipment = { ...owned.equipment, [item.slot]: item.uid };
    item.equippedBy = characterUid;

    const character = findCharacterView(characterUid);
    if (!character) throw new ApiClientError('NOT_FOUND', 'キャラクターが見つかりません。');
    return { character, inventory: cloneInventory() };
  },

  async unequip(characterUid: string, slot: EquipmentSlot): Promise<EquipResponse> {
    await delay(100);
    const owned = mockState.owned.find((o) => o.uid === characterUid);
    if (!owned) throw new ApiClientError('NOT_FOUND', 'キャラクターが見つかりません。');
    const uid = owned.equipment?.[slot];
    if (uid) {
      const item = mockState.inventory.equipment.find((e) => e.uid === uid);
      if (item) item.equippedBy = undefined;
      owned.equipment = { ...owned.equipment, [slot]: undefined };
    }
    const character = findCharacterView(characterUid);
    if (!character) throw new ApiClientError('NOT_FOUND', 'キャラクターが見つかりません。');
    return { character, inventory: cloneInventory() };
  },

  async sellEquipment(equipmentUids: string[]): Promise<SellEquipmentResponse> {
    await delay(120);
    let gained = 0;
    const remaining: typeof mockState.inventory.equipment = [];
    for (const item of mockState.inventory.equipment) {
      if (equipmentUids.includes(item.uid)) {
        if (item.equippedBy) {
          throw new ApiClientError('BAD_REQUEST', `${item.name} は装着中のため売却できません。`);
        }
        const rarityMult: Record<string, number> = {
          COMMON: 12, UNCOMMON: 24, RARE: 48, EPIC: 96, LEGENDARY: 220, MYTHIC: 520,
        };
        gained += Math.round((rarityMult[item.rarity] ?? 12) * (1 + item.itemLevel * 0.06));
      } else {
        remaining.push(item);
      }
    }
    mockState.inventory.equipment = remaining;
    mockState.player = { ...mockState.player, gold: mockState.player.gold + gained };
    return { gold: gained, player: { ...mockState.player }, inventory: cloneInventory() };
  },

  async getGacha(): Promise<GachaListResponse> {
    await delay(90);
    const pityCounters: Record<string, number> = {};
    for (const b of MOCK_BANNERS) pityCounters[b.id] = mockState.gachaPity[b.id] ?? 0;
    return {
      banners: MOCK_BANNERS,
      player: { ...mockState.player },
      pityCounters,
      tickets: mockState.inventory.tickets.map((t) => ({ ...t })),
    };
  },

  async gachaPull(bannerId: string, count: number): Promise<GachaPullResponse> {
    await delay(320);
    const { results, pityCounter } = pullBanner(bannerId, count);
    return {
      results,
      player: { ...mockState.player },
      characters: mockCharacterViews(),
      inventory: cloneInventory(),
      pityCounter,
    };
  },

  // ---------- 転生 (設計書§17〜§20, P4-1) ----------

  async getRebirthStatus(uid: string): Promise<RebirthStatusResponse> {
    await delay(110);
    return getMockRebirthStatus(uid);
  },

  async rebirth(uid: string): Promise<RebirthResponse> {
    await delay(260);
    return performMockRebirth(uid);
  },

  async allocateRebirth(uid: string, nodeId: string, ranks?: number): Promise<RebirthStatusResponse> {
    await delay(140);
    return allocateMockRebirth(uid, nodeId, ranks);
  },

  async resetRebirth(uid: string): Promise<ResetRebirthResponse> {
    await delay(180);
    return resetMockRebirth(uid);
  },
};
