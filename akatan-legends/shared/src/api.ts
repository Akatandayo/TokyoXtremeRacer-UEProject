/**
 * クライアント/サーバ間のAPI契約。
 * 重要: ガチャ結果・ダメージ計算・報酬・EXP・育成はすべてサーバ側で確定させる。
 * クライアントから送られた数値(ダメージ/報酬/レベル等)は一切信用しない。
 */
import type {
  CharacterView, ChapterDef, StageDef, BattleLog, BattleRewards,
  PlayerProfile, Party, AiProfile, Skill, EnemyDef, CharacterDef, ComboDef,
  EquipmentInstance, MaterialStack, MaterialDef, DropResult, EquipmentSlot,
  GachaBannerDef, GachaPullResult, PlannedCharacterDef,
  RebirthNodeDef, RebirthConfig, RebirthStatus,
  RaidBossDef, RaidState, RaidAttemptResult, AudioConfig,
} from './types.js';

/** 全レスポンスの共通封筒 */
export type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: ApiError };

export interface ApiError {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
}

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'PARTY_EMPTY'
  | 'PARTY_INVALID'
  | 'STAGE_LOCKED'
  | 'NOT_ENOUGH_CURRENCY'
  | 'REBIRTH_LOCKED'
  | 'NOT_ENOUGH_POINTS'
  | 'RAID_DEFEATED'
  | 'SLOT_MISMATCH'
  | 'ALREADY_EQUIPPED'
  | 'INTERNAL';

/* ---------- GET /api/player ---------- */
export interface PlayerStateResponse {
  player: PlayerProfile;
  characters: CharacterView[];
  party: Party;
  /** 所持している装備・素材・召喚チケット */
  inventory?: InventoryResponse;
}

/* ---------- GET /api/inventory ---------- */
export interface InventoryResponse {
  equipment: EquipmentInstance[];
  materials: MaterialStack[];
  tickets: MaterialStack[];
}

/* ---------- POST /api/equipment/equip ---------- */
export interface EquipRequest {
  /** 装備インスタンスID */
  equipmentUid: string;
  /** 装備させるキャラの所持インスタンスID */
  characterUid: string;
}
export interface EquipResponse {
  /** 装備後のキャラ */
  character: CharacterView;
  inventory: InventoryResponse;
}

/* ---------- POST /api/equipment/unequip ---------- */
export interface UnequipRequest {
  characterUid: string;
  slot: EquipmentSlot;
}
/** 取り外しのレスポンスは装着と同じ形(更新後のキャラ + 所持品) */
export type UnequipResponse = EquipResponse;

/* ---------- POST /api/equipment/sell ---------- */
export interface SellEquipmentRequest {
  equipmentUids: string[];
}
export interface SellEquipmentResponse {
  gold: number;
  player: PlayerProfile;
  inventory: InventoryResponse;
}

/* ---------- GET /api/gacha ---------- */
export interface GachaListResponse {
  banners: GachaBannerDef[];
  player: PlayerProfile;
  /** バナーID -> 現在の天井カウント */
  pityCounters: Record<string, number>;
  tickets: MaterialStack[];
}

/* ---------- POST /api/gacha/pull ---------- */
export interface GachaPullRequest {
  bannerId: string;
  /** 1 または 10 */
  count: number;
}
export interface GachaPullResponse {
  results: GachaPullResult[];
  player: PlayerProfile;
  characters: CharacterView[];
  inventory: InventoryResponse;
  /** 引いた後の天井カウント */
  pityCounter: number;
}

/* ---------- GET /api/characters ---------- */
export interface CharacterListResponse {
  characters: CharacterView[];
}

/* ---------- GET /api/master ---------- */
/** マスターデータ一括取得(図鑑/UI表示用。読み取り専用) */
export interface MasterDataResponse {
  characters: CharacterDef[];
  enemies: EnemyDef[];
  skills: Skill[];
  aiProfiles: AiProfile[];
  chapters: ChapterDef[];
  /**
   * コンボ定義。編成画面が「今この編成で成立するコンボ」をリアルタイム表示するため、
   * クライアント側で判定できるよう定義そのものを配る(勝敗に関わる実際の発動判定は
   * サーバの戦闘エンジンが行うので、これを配ってもサーバ権威は崩れない)。
   */
  combos?: ComboDef[];
  /** 素材定義(図鑑・ドロップ表示用) */
  materials?: MaterialDef[];
  /** 転生ノード定義(転生画面のツリー表示用) */
  rebirthNodes?: RebirthNodeDef[];
  /** 転生の基本設定 */
  rebirthConfig?: RebirthConfig;
  /** レイドボス定義 */
  raidBosses?: RaidBossDef[];
  /** BGM・効果音の割り当て */
  audio?: AudioConfig;
  /**
   * コンボ定義から参照されているが未実装のキャラ。
   * UIが「〇〇(実装予定)」と名前で表示できるようにするため。
   */
  plannedCharacters?: PlannedCharacterDef[];
}

/* ---------- PUT /api/party ---------- */
export interface UpdatePartyRequest {
  /** 長さ5。キャラのuid、空き枠はnull */
  members: (string | null)[];
}
export interface UpdatePartyResponse {
  party: Party;
}

/* ---------- PUT /api/characters/:uid/ai ---------- */
export interface UpdateAiRequest {
  aiProfile: string;
}

/* ---------- 転生 (設計書§17〜§20) ---------- */

/** GET /api/characters/:uid/rebirth */
export interface RebirthStatusResponse {
  character: CharacterView;
  status: RebirthStatus;
}

/** POST /api/characters/:uid/rebirth — 転生を実行する */
export interface RebirthResponse {
  character: CharacterView;
  status: RebirthStatus;
  player: PlayerProfile;
  /** 転生前後の比較(演出用) */
  before: { level: number; rebirth: number; stats: Record<string, number> };
  after: { level: number; rebirth: number; stats: Record<string, number> };
  inventory?: InventoryResponse;
}

/** POST /api/characters/:uid/rebirth/allocate — 転生ポイントを振る */
export interface AllocateRebirthRequest {
  nodeId: string;
  /** 振るランク数。省略時は1 */
  ranks?: number;
}

/** POST /api/characters/:uid/rebirth/reset — 振り直す */
export interface ResetRebirthResponse {
  character: CharacterView;
  status: RebirthStatus;
  inventory?: InventoryResponse;
}

/* ---------- レイド (設計書§28〜§29) ---------- */

/** GET /api/raid */
export interface RaidListResponse {
  bosses: RaidBossDef[];
  /** ボスID -> 進行状況 */
  states: Record<string, RaidState>;
}

/** POST /api/raid/attack */
export interface RaidAttackRequest {
  bossId: string;
  /** 省略時は保存済みパーティ */
  members?: (string | null)[];
}

export interface RaidAttackResponse {
  log: BattleLog;
  raid: RaidAttemptResult;
  state: RaidState;
  player: PlayerProfile;
  characters: CharacterView[];
  rewards: BattleRewards | null;
  drops?: DropResult | null;
  inventory?: InventoryResponse;
}

/* ---------- GET /api/dungeons ---------- */
export interface DungeonListResponse {
  chapters: ChapterDef[];
  clearedStages: string[];
}

/* ---------- POST /api/battle/start ---------- */
export interface BattleStartRequest {
  stageId: string;
  /** 指定時はそのパーティを使う。省略時は保存済みパーティ */
  members?: (string | null)[];
}

export interface BattleStartResponse {
  /** 戦闘全体を再生可能な完全ログ */
  log: BattleLog;
  rewards: BattleRewards | null;
  player: PlayerProfile;
  /** 戦闘後の最新キャラ状態 */
  characters: CharacterView[];
  stage: StageDef;
  /** 勝利時のドロップ(装備・素材・キャラ・チケット)。敗北時は null */
  drops?: DropResult | null;
  /** ドロップ後の所持品 */
  inventory?: InventoryResponse;
}

export const API_BASE = '/api';
