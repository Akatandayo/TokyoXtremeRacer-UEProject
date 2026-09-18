/**
 * アプリケーション例外
 * ------------------------------------------------------------
 * サービス層は AppError を throw し、ルータのエラーハンドリングミドルウェアが
 * ApiResponse<never> (= { ok:false, error }) + 適切な HTTP ステータスへ変換する。
 * AppError 以外の例外はすべて 500 / INTERNAL に丸められ、スタックはサーバログにのみ出る。
 */
import type { ApiErrorCode } from '@akatan/shared';

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  PARTY_EMPTY: 400,
  PARTY_INVALID: 400,
  // P0-1 (第2ラウンド差し戻し): 統括の指示で 403 ではなく 400 に統一。
  // (他のバリデーション系エラー PARTY_INVALID 等も 400 なので揃える)
  STAGE_LOCKED: 400,
  // ガチャ/装備 (Phase 3/5): いずれもクライアントの要求が現在の所持状況と
  // 噛み合っていないケースなので、他のバリデーション系と揃えて 400 にする。
  NOT_ENOUGH_CURRENCY: 400,
  SLOT_MISMATCH: 400,
  ALREADY_EQUIPPED: 400,
  INTERNAL: 500,
};

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code] ?? 500;
    this.details = details;
  }
}

export const badRequest = (message: string, details?: unknown): AppError =>
  new AppError('BAD_REQUEST', message, details);
export const notFound = (message: string, details?: unknown): AppError =>
  new AppError('NOT_FOUND', message, details);
export const partyEmpty = (message = 'パーティにキャラクターが編成されていません', details?: unknown): AppError =>
  new AppError('PARTY_EMPTY', message, details);
export const partyInvalid = (message: string, details?: unknown): AppError =>
  new AppError('PARTY_INVALID', message, details);
export const stageLocked = (message: string, details?: unknown): AppError =>
  new AppError('STAGE_LOCKED', message, details);
export const notEnoughCurrency = (message: string, details?: unknown): AppError =>
  new AppError('NOT_ENOUGH_CURRENCY', message, details);
export const slotMismatch = (message: string, details?: unknown): AppError =>
  new AppError('SLOT_MISMATCH', message, details);
export const alreadyEquipped = (message: string, details?: unknown): AppError =>
  new AppError('ALREADY_EQUIPPED', message, details);
