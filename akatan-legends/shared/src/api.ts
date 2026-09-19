/**
 * クライアント/サーバ間のAPI契約。
 * 重要: ガチャ結果・ダメージ計算・報酬・EXP・育成はすべてサーバ側で確定させる。
 * クライアントから送られた数値(ダメージ/報酬/レベル等)は一切信用しない。
 */
import type {
  CharacterView, ChapterDef, StageDef, BattleLog, BattleRewards,
  PlayerProfile, Party, AiProfile, Skill, EnemyDef, CharacterDef, ComboDef,
  EquipmentInstance, MaterialStack, MaterialDef, DropResult, EquipmentSlot,
  GachaBannerDef, GachaPullResult, GachaTicketExchangeDef, PlannedCharacterDef,
  RebirthNodeDef, RebirthConfig, RebirthStatus,
  RaidBossDef, RaidState, RaidAttemptResult, AudioConfig, ItemRarity,
} from './types.js';
import type { PvpPartySnapshot, PvpRoomView } from './pvp.js';

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

/* ---------- POST /api/equipment/favorite ---------- */
export interface FavoriteEquipmentRequest {
  equipmentUids: string[];
  favorite: boolean;
}
export interface FavoriteEquipmentResponse {
  inventory: InventoryResponse;
}

/* ---------- POST /api/equipment/sell-bulk ---------- */
/**
 * レアリティを指定して一括売却する。装備数が増えすぎて動作が重くなるのを
 * 防ぐための整理機能。装着中とお気に入りは必ず除外される。
 */
export interface BulkSellRequest {
  /** このレアリティ以下をすべて売る(COMMON〜MYTHIC の序列で判定) */
  maxRarity: ItemRarity;
  /** 指定するとこのアイテムレベル未満だけを対象にする */
  belowItemLevel?: number;
}
export interface BulkSellResponse {
  /** 売却した数 */
  count: number;
  gold: number;
  /** 装着中・お気に入りで除外した数 */
  skipped: number;
  player: PlayerProfile;
  inventory: InventoryResponse;
}

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
  /** ガチャチケットの交換レート(data/gacha-exchange/*.json)。省略時は交換不可 */
  exchanges?: GachaTicketExchangeDef[];
}

/* ---------- POST /api/gacha/exchange ---------- */
/**
 * チケット交換(設計書§37: サーバ権威)。クライアントが送るのは「どのレートを」
 * 「何回分」交換したいかという意図だけで、消費/付与枚数は必ずサーバが
 * `GachaTicketExchangeDef` から計算して確定させる。
 */
export interface GachaExchangeRequest {
  exchangeId: string;
  /** 交換したい回数。省略時は1 */
  times?: number;
}
export interface GachaExchangeResponse {
  exchangeId: string;
  times: number;
  /** 消費したチケット */
  consumed: MaterialStack;
  /** 得たチケット */
  gained: MaterialStack;
  /** 交換後の所持チケット一覧 */
  tickets: MaterialStack[];
  player: PlayerProfile;
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

/* ---------- PvP (あいことば対戦) ----------
 * 信頼境界の注意点は shared/src/pvp.ts の先頭コメントと docs/API.md を参照。
 */
export interface PvpJoinRequest {
  /** あいことば(前後空白は除去。PVP_PASSPHRASE_MAX_LENGTH 文字まで) */
  passphrase: string;
  /** クライアント申告の編成スナップショット(サーバが検証する) */
  party: PvpPartySnapshot;
}

/** POST /api/pvp/join のレスポンス。相手が既に待っていれば即座に READY で返る */
export type PvpJoinResponse = PvpRoomView;

/** GET /api/pvp/rooms/:roomId のレスポンス(待機中のポーリング用) */
export type PvpStatusResponse = PvpRoomView;

export const API_BASE = '/api';
