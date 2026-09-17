/**
 * GET /api/master  マスターデータ一括取得(図鑑/UI表示用・読み取り専用)
 *
 * P1-1: 編成画面でコンボを表示するため `combos` を含めたい。
 * `MasterDataResponse` (shared/src/api.ts) にはまだ `combos` フィールドが無く、
 * このAPI担当は shared/ を書き込み禁止のため型定義そのものは変更できない。
 * そのため公式契約 (`MasterDataResponse`) を壊さない形で、レスポンスの実データにだけ
 * `combos` を追加で載せている(型を拡張した局所的な型でオブジェクトを組み、
 * `MasterDataResponse` として明示アサインはしていないので既存の型チェックは壊れない)。
 * フロントは現状 `shared` の型経由では `combos` を参照できないため、
 * 統括へ `MasterDataResponse.combos?: ComboDef[]` の追加を要望している(報告参照)。
 */
import { Router } from 'express';
import type { ComboDef, MasterDataResponse } from '@akatan/shared';
import { getGameData } from '../data/loader.js';
import { handler, sendOk } from './_helpers.js';

export const masterRouter: Router = Router();

masterRouter.get('/master', handler((_req, res) => {
  const data = getGameData();
  const body: MasterDataResponse & { combos: ComboDef[] } = {
    characters: [...data.characters.values()],
    enemies: [...data.enemies.values()],
    skills: [...data.skills.values()],
    aiProfiles: [...data.aiProfiles.values()],
    chapters: [...data.chapters.values()],
    // 暫定フィールド(shared 未定義)。統括の型追加後は shared 側の正式フィールドに揃える。
    combos: [...data.combos.values()],
  };
  sendOk(res, body);
}));
