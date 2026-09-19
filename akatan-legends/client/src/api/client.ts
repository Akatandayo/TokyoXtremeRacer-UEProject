/**
 * API 呼び出しの集約点。
 * - `ApiResponse<T>` 封筒をここで剥がし、型付きの値を返す。
 * - 失敗はすべて `ApiClientError` の例外にして、画面側で捕捉させる。
 * - モックモード時は `src/mock` の実装に差し替える(サーバ不要のデモ)。
 */
import type {
  ApiResponse, ApiErrorCode, PlayerStateResponse, CharacterListResponse,
  MasterDataResponse, DungeonListResponse, UpdatePartyResponse,
  BattleStartResponse, UpdatePartyRequest, UpdateAiRequest, BattleStartRequest,
  InventoryResponse, EquipRequest, EquipResponse, UnequipRequest,
  SellEquipmentRequest, SellEquipmentResponse, GachaListResponse,
  GachaPullRequest, GachaPullResponse, EquipmentSlot,
  RebirthStatusResponse, RebirthResponse, ResetRebirthResponse, AllocateRebirthRequest,
  RaidListResponse, RaidAttackRequest, RaidAttackResponse,
} from '@akatan/shared';
import { isMockMode } from './mode';
import { mockApi } from '../mock';

export const API_BASE = '/api';

export type ApiFailureCode = ApiErrorCode | 'NETWORK' | 'PARSE';

export class ApiClientError extends Error {
  readonly code: ApiFailureCode;
  readonly details?: unknown;
  constructor(code: ApiFailureCode, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.details = details;
  }
}

/** 画面に出す日本語メッセージ */
export function describeError(err: unknown): { title: string; detail: string; code: string } {
  if (err instanceof ApiClientError) {
    const map: Record<string, string> = {
      NETWORK: 'サーバに接続できませんでした',
      PARSE: 'サーバの応答を解釈できませんでした',
      BAD_REQUEST: 'リクエストが不正です',
      NOT_FOUND: 'データが見つかりません',
      PARTY_EMPTY: 'パーティが空です',
      PARTY_INVALID: 'パーティ編成が不正です',
      STAGE_LOCKED: 'このステージはまだ解放されていません',
      NOT_ENOUGH_CURRENCY: '所持GOLD/チケット/素材が足りません',
      REBIRTH_LOCKED: 'まだ転生できません',
      NOT_ENOUGH_POINTS: '転生ポイントが足りません',
      RAID_DEFEATED: 'このレイドボスはすでに撃破されています。',
      SLOT_MISMATCH: 'この装備は対応する部位(スロット)が異なります',
      ALREADY_EQUIPPED: 'すでに他のキャラクターが装着中です',
      INTERNAL: 'サーバ内部エラーが発生しました',
    };
    return {
      title: map[err.code] ?? 'エラーが発生しました',
      detail: err.message,
      code: err.code,
    };
  }
  return {
    title: '予期しないエラーが発生しました',
    detail: err instanceof Error ? err.message : String(err),
    code: 'UNKNOWN',
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch (e) {
    throw new ApiClientError(
      'NETWORK',
      'バックエンド(localhost:8787)が起動していない可能性があります。',
      e,
    );
  }

  let body: unknown;
  const raw = await res.text();
  try {
    body = raw.length > 0 ? JSON.parse(raw) : null;
  } catch (e) {
    throw new ApiClientError('PARSE', `JSONとして解釈できない応答 (HTTP ${res.status})`, e);
  }

  if (body === null || typeof body !== 'object' || !('ok' in body)) {
    throw new ApiClientError('PARSE', `API封筒の形式が不正です (HTTP ${res.status})`, body);
  }

  const envelope = body as ApiResponse<T>;
  if (!envelope.ok) {
    throw new ApiClientError(envelope.error.code, envelope.error.message, envelope.error.details);
  }
  return envelope.data;
}

export interface GameApi {
  getPlayer(): Promise<PlayerStateResponse>;
  getCharacters(): Promise<CharacterListResponse>;
  getMaster(): Promise<MasterDataResponse>;
  getDungeons(): Promise<DungeonListResponse>;
  updateParty(members: (string | null)[]): Promise<UpdatePartyResponse>;
  updateAi(uid: string, aiProfile: string): Promise<unknown>;
  startBattle(stageId: string, members?: (string | null)[]): Promise<BattleStartResponse>;
  getInventory(): Promise<InventoryResponse>;
  equip(equipmentUid: string, characterUid: string): Promise<EquipResponse>;
  unequip(characterUid: string, slot: EquipmentSlot): Promise<EquipResponse>;
  sellEquipment(equipmentUids: string[]): Promise<SellEquipmentResponse>;
  getGacha(): Promise<GachaListResponse>;
  gachaPull(bannerId: string, count: number): Promise<GachaPullResponse>;
  /** 転生 (設計書§17〜§20) */
  getRebirthStatus(uid: string): Promise<RebirthStatusResponse>;
  rebirth(uid: string): Promise<RebirthResponse>;
  /**
   * ポイント割り振り。shared/src/api.ts には `AllocateRebirthRequest` はあるが
   * 対応するレスポンス型の明示的な宣言が無いため、他の転生エンドポイント
   * (`RebirthStatusResponse` = `{ character, status }`)と対称になる想定で扱う。
   * バックエンド実装時にレスポンス形が異なる場合はここを合わせる。
   */
  allocateRebirth(uid: string, nodeId: string, ranks?: number): Promise<RebirthStatusResponse>;
  resetRebirth(uid: string): Promise<ResetRebirthResponse>;
  /** レイド (設計書§28〜§29) */
  getRaid(): Promise<RaidListResponse>;
  raidAttack(bossId: string, members?: (string | null)[]): Promise<RaidAttackResponse>;
}

const httpApi: GameApi = {
  getPlayer: () => request<PlayerStateResponse>('/player'),
  getCharacters: () => request<CharacterListResponse>('/characters'),
  getMaster: () => request<MasterDataResponse>('/master'),
  getDungeons: () => request<DungeonListResponse>('/dungeons'),
  updateParty: (members) => {
    const payload: UpdatePartyRequest = { members };
    return request<UpdatePartyResponse>('/party', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  updateAi: (uid, aiProfile) => {
    const payload: UpdateAiRequest = { aiProfile };
    return request<unknown>(`/characters/${encodeURIComponent(uid)}/ai`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },
  startBattle: (stageId, members) => {
    const payload: BattleStartRequest = members ? { stageId, members } : { stageId };
    return request<BattleStartResponse>('/battle/start', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
  getInventory: () => request<InventoryResponse>('/inventory'),
  equip: (equipmentUid, characterUid) => {
    const payload: EquipRequest = { equipmentUid, characterUid };
    return request<EquipResponse>('/equipment/equip', { method: 'POST', body: JSON.stringify(payload) });
  },
  unequip: (characterUid, slot) => {
    const payload: UnequipRequest = { characterUid, slot };
    // shared/src/api.ts には UnequipResponse の明示的な型が無いが、equip と対称の
    // { character, inventory } 形式を返す想定でリクエストする(サーバ実装側との契約前提)。
    return request<EquipResponse>('/equipment/unequip', { method: 'POST', body: JSON.stringify(payload) });
  },
  sellEquipment: (equipmentUids) => {
    const payload: SellEquipmentRequest = { equipmentUids };
    return request<SellEquipmentResponse>('/equipment/sell', { method: 'POST', body: JSON.stringify(payload) });
  },
  getGacha: () => request<GachaListResponse>('/gacha'),
  gachaPull: (bannerId, count) => {
    const payload: GachaPullRequest = { bannerId, count };
    return request<GachaPullResponse>('/gacha/pull', { method: 'POST', body: JSON.stringify(payload) });
  },
  getRebirthStatus: (uid) => request<RebirthStatusResponse>(`/characters/${encodeURIComponent(uid)}/rebirth`),
  rebirth: (uid) => request<RebirthResponse>(`/characters/${encodeURIComponent(uid)}/rebirth`, { method: 'POST' }),
  allocateRebirth: (uid, nodeId, ranks) => {
    const payload: AllocateRebirthRequest = ranks !== undefined ? { nodeId, ranks } : { nodeId };
    return request<RebirthStatusResponse>(
      `/characters/${encodeURIComponent(uid)}/rebirth/allocate`,
      { method: 'POST', body: JSON.stringify(payload) },
    );
  },
  resetRebirth: (uid) => request<ResetRebirthResponse>(
    `/characters/${encodeURIComponent(uid)}/rebirth/reset`,
    { method: 'POST' },
  ),
  getRaid: () => request<RaidListResponse>('/raid'),
  raidAttack: (bossId, members) => {
    const payload: RaidAttackRequest = members ? { bossId, members } : { bossId };
    return request<RaidAttackResponse>('/raid/attack', { method: 'POST', body: JSON.stringify(payload) });
  },
};

/** 現在のモードに応じた API 実装を返す */
export function api(): GameApi {
  return isMockMode() ? mockApi : httpApi;
}
