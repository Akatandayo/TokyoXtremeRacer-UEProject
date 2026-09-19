/**
 * オンラインPvP(あいことば対戦)の型
 * ------------------------------------------------------------
 * 設計方針は docs/API.md の「PvP (あいことば対戦)」節を参照。
 *
 * 重要: このゲームは単体HTML(オフライン)でも遊ばれ、セーブはブラウザの localStorage に
 * あるため、サーバはプレイヤーの「所持キャラ」を必ずしも把握していない。
 * そのため PvP に限り、**クライアントが自分の編成スナップショット(defId・レベル・AI・
 * 計算済みステータス)を申告し、サーバはそれを検証してから使う**という、設計書§37の
 * 「サーバが全て再計算する」原則から外れた信頼境界を採用する。
 * 検証の内容は server/src/services/pvp-service.ts の validatePartySnapshot を参照。
 */
import type { BattleLog, Side, Stats } from './types.js';

/** PvPパーティの人数上限(通常パーティと同じ) */
export const PVP_PARTY_SIZE = 5;

/** あいことばの文字数上限(1文字以上、trim後) */
export const PVP_PASSPHRASE_MAX_LENGTH = 40;

/**
 * クライアントが申告する編成1名分のスナップショット。
 * defId/aiProfile は「実在するID」であることをサーバが検証し、level/stats は
 * 「そのキャラをそのレベルで作れる上限を大きく超えていないか」をサーバが検証する
 * (pvp-service.ts の STAT_CAP_MULTIPLIER/STAT_CAP_BUFFER 参照)。
 * name/element/roles/skills/art など「見た目・技」に関わる情報は一切信用せず、
 * サーバがマスタデータ(defId)から必ず引き直す。
 */
export interface PvpMemberSnapshot {
  /** 所持キャラの defId (data/characters/*.json に実在必須) */
  defId: string;
  level: number;
  /** 選択中のAIプロファイルID(省略時はキャラの既定AI) */
  aiProfile?: string;
  /** クライアントが計算した最終ステータス(装備・転生・覚醒込み) */
  stats: Stats;
}

export interface PvpPartySnapshot {
  /** 1〜PVP_PARTY_SIZE 名。空編成は拒否される */
  members: PvpMemberSnapshot[];
}

export type PvpRoomStatus = 'WAITING' | 'READY';

/**
 * PvP部屋の現在状態(join/status 共通のレスポンス形)。
 * status が 'READY' のときだけ log/side が入る。
 */
export interface PvpRoomView {
  roomId: string;
  status: PvpRoomStatus;
  /** リクエストしたプレイヤーから見た自陣営。'READY' のときのみ確定する */
  side?: Side;
  /** 両陣営が完全に一致する戦闘ログ。'READY' のときのみ入る */
  log?: BattleLog;
  /** 相手がまだ来ていないか(WAITING中の表示用) */
  opponentJoined: boolean;
  createdAt: string;
  expiresAt: string;
}

/** 相手が来ないまま部屋が失効するまでの時間(ミリ秒) */
export const PVP_ROOM_WAIT_TTL_MS = 10 * 60 * 1000; // 10分
/** 決着後、両者が結果を取得できる猶予(ミリ秒) */
export const PVP_ROOM_RESULT_TTL_MS = 60 * 60 * 1000; // 1時間
