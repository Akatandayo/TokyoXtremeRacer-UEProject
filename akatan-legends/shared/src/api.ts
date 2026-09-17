/**
 * クライアント/サーバ間のAPI契約。
 * 重要: ガチャ結果・ダメージ計算・報酬・EXP・育成はすべてサーバ側で確定させる。
 * クライアントから送られた数値(ダメージ/報酬/レベル等)は一切信用しない。
 */
import type {
  CharacterView, ChapterDef, StageDef, BattleLog, BattleRewards,
  PlayerProfile, Party, AiProfile, Skill, EnemyDef, CharacterDef,
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
  | 'INTERNAL';

/* ---------- GET /api/player ---------- */
export interface PlayerStateResponse {
  player: PlayerProfile;
  characters: CharacterView[];
  party: Party;
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
}

export const API_BASE = '/api';
