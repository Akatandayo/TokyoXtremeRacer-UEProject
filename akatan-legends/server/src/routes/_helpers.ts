/**
 * ルータ共通ヘルパ
 * ------------------------------------------------------------
 * - ApiResponse 封筒での送信
 * - 非同期ハンドラの例外をミドルウェアへ流す asyncHandler
 * - 入力バリデーション用の小道具(zod は未導入のため自前)
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { ApiResponse } from '@akatan/shared';
import { AppError, badRequest } from '../services/app-error.js';
import { LOCAL_PLAYER_ID } from '../services/player-service.js';

/** 成功レスポンス: { ok: true, data } */
export function sendOk<T>(res: Response, data: T, status = 200): void {
  const body: ApiResponse<T> = { ok: true, data };
  res.status(status).json(body);
}

/** 失敗レスポンス: { ok: false, error } */
export function sendError(res: Response, err: AppError): void {
  const body: ApiResponse<never> = {
    ok: false,
    error: { code: err.code, message: err.message, details: err.details },
  };
  res.status(err.status).json(body);
}

/**
 * 現在のプレイヤーIDを解決する。
 * MVP は認証なしで 'local' 固定。将来はここでセッション/トークンを見る。
 */
export function currentPlayerId(_req: Request): string {
  return LOCAL_PLAYER_ID;
}

/** 同期/非同期どちらのハンドラでも例外をエラーミドルウェアへ委譲する */
export function handler(
  fn: (req: Request, res: Response) => unknown | Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    try {
      const result = fn(req, res);
      if (result instanceof Promise) result.catch(next);
    } catch (err) {
      next(err);
    }
  };
}

/* ============================================================
 * バリデーション小道具 (zod 未導入のため自前)
 * ========================================================== */

export function requireBody(req: Request): Record<string, unknown> {
  const body = req.body as unknown;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('リクエストボディは JSON オブジェクトである必要があります');
  }
  return body as Record<string, unknown>;
}

export function requireString(
  value: unknown,
  field: string,
  opts: { maxLength?: number } = {},
): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw badRequest(`${field} は必須の文字列です`);
  }
  const max = opts.maxLength ?? 200;
  if (value.length > max) {
    throw badRequest(`${field} が長すぎます (最大 ${max} 文字)`);
  }
  return value;
}

/** URL パラメータの id 系: 空・異常に長い・制御文字を弾く */
export function requireIdParam(req: Request, name: string): string {
  const raw = req.params[name];
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 128) {
    throw badRequest(`${name} が不正です`);
  }
  return raw;
}

/* ============================================================
 * エラーハンドリングミドルウェア
 * ========================================================== */

/** 404: 未定義の /api/* パス */
export function notFoundMiddleware(_req: Request, res: Response): void {
  sendError(res, new AppError('NOT_FOUND', 'エンドポイントが見つかりません'));
}

/**
 * 例外 -> ApiResponse 変換。
 * AppError はそのコード/ステータスで、それ以外は 500 / INTERNAL に丸める。
 * **スタックトレースはサーバログにのみ出力し、レスポンスには含めない。**
 */
export function errorMiddleware(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    sendError(res, err);
    return;
  }
  // JSON パースエラー (express.json) は 400 扱い
  if (err instanceof SyntaxError && 'body' in err) {
    sendError(res, badRequest('JSON の形式が不正です'));
    return;
  }
  console.error('[api] 未処理の例外:', err);
  sendError(res, new AppError('INTERNAL', 'サーバ内部エラーが発生しました'));
}
