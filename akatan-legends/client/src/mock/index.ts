/**
 * デモモード用の API 実装。
 * `?mock=1` または 設定画面のトグルで有効になり、バックエンド無しで全画面が動く。
 */
import type {
  PlayerStateResponse, CharacterListResponse, MasterDataResponse,
  DungeonListResponse, UpdatePartyResponse, BattleStartResponse, StageDef,
} from '@akatan/shared';
import { MOCK_CHARACTERS, MOCK_ENEMIES, MOCK_SKILLS, MOCK_AI_PROFILES, MOCK_CHAPTERS, MOCK_COMBOS } from './master';
import { mockState, mockCharacterViews, expToNext } from './player';
import { generateMockBattle } from './battle';

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

    return {
      log,
      rewards,
      player: { ...mockState.player },
      characters: mockCharacterViews(),
      stage,
    };
  },
};
