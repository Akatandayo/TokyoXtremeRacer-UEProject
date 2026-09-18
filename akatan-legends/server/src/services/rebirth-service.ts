/**
 * 転生サービス(サーバ権威。設計書§17〜§20 / §37)
 * ------------------------------------------------------------
 * クライアントから受け取るのは「どのキャラを転生させるか(uid)」「どのノードに
 * 何ランク振るか(nodeId, ranks)」という意図だけ。転生の実行可否・ポイントの
 * 割り振り・ステータス計算はすべてここ(サーバ)で確定させる。
 *
 * 設計判断メモ:
 *  - **転生しても取得済みノードは維持する**(リセットしない)。転生のたびに
 *    ノードを振り直しにすると「転生する degrees ほど育成が積み上がらない」
 *    (レベルは1に戻るのに、ノードまで失うと純粋な損にしかならず、転生する
 *    動機を壊す)。ノードのやり直しは明示的な `POST /rebirth/reset`(素材消費)
 *    でのみ可能にする。
 *  - `RebirthStatus.pathPoints` はノード定義から**サーバが**算出する
 *    (クライアントの申告は一切信用しない。§19のビルド分岐を成立させる
 *    `requiresPathPoints` 判定もこの値を使う)。
 */
import type {
  CharacterView, GameData as GameDataType, MaterialCost, OwnedCharacter, PlayerProfile,
  RebirthResponse, RebirthStatus, RebirthStatusResponse, ResetRebirthResponse,
} from '@akatan/shared';
import * as repo from '../db/repository.js';
import type { GameData } from '../data/loader.js';
import { notFound, notEnoughPoints, rebirthLocked } from './app-error.js';
import { buildCharacterView, getPlayerProfile } from './player-service.js';
import { buildInventoryResponse, equipmentByUidMap } from './equipment-service.js';
import { computeOwnedStats, computeRebirthPathPoints } from './progression.js';

// `MaterialCost` は shared 側に無いため、この場限りの構造で受ける(RebirthConfig.cost/resetCost の要素型)。
type MaterialCostEntry = { materialId: string; count: number };
void 0 as unknown as MaterialCost; // 型が無ければここでコンパイルエラーになる想定は無いので参照しない

/* ============================================================
 * 素材の検証・消費
 * ========================================================== */

function assertMaterialsAvailable(playerId: string, cost: MaterialCostEntry[] | undefined): void {
  if (!cost || cost.length === 0) return;
  for (const c of cost) {
    const owned = repo.getMaterialCount(playerId, c.materialId);
    if (owned < c.count) {
      throw rebirthLocked(
        `素材が不足しています: ${c.materialId} (必要 ${c.count} / 所持 ${owned})`,
        { materialId: c.materialId, required: c.count, owned },
      );
    }
  }
}

function consumeMaterials(playerId: string, cost: MaterialCostEntry[] | undefined): void {
  if (!cost) return;
  for (const c of cost) repo.addMaterial(playerId, c.materialId, -c.count);
}

/* ============================================================
 * 転生可否の判定
 * ========================================================== */

export interface RebirthEligibility {
  canRebirth: boolean;
  /** 拒否理由(日本語)。canRebirth=true の場合は無い */
  reason?: string;
}

/** レベル・転生回数上限・素材所持を検証する(条件を満たさなければ理由付きで拒否) */
export function evaluateRebirthEligibility(
  playerId: string,
  owned: OwnedCharacter,
  data: GameData,
): RebirthEligibility {
  const config = data.rebirthConfig;
  if (owned.rebirth >= config.maxRebirth) {
    return { canRebirth: false, reason: `転生回数が上限(${config.maxRebirth}回)に達しています` };
  }
  if (owned.level < config.requiredLevel) {
    return {
      canRebirth: false,
      reason: `転生にはLv${config.requiredLevel}以上が必要です(現在Lv${owned.level})`,
    };
  }
  if (config.cost && config.cost.length > 0) {
    for (const c of config.cost) {
      const have = repo.getMaterialCount(playerId, c.materialId);
      if (have < c.count) {
        return {
          canRebirth: false,
          reason: `素材が不足しています: ${c.materialId} (必要 ${c.count} / 所持 ${have})`,
        };
      }
    }
  }
  return { canRebirth: true };
}

/* ============================================================
 * ステータス組み立て
 * ========================================================== */

/** 転生画面表示用の RebirthStatus をサーバ側の値だけから組み立てる */
export function buildRebirthStatus(
  playerId: string,
  owned: OwnedCharacter,
  data: GameData,
): RebirthStatus {
  const eligibility = evaluateRebirthEligibility(playerId, owned, data);
  const nodes = { ...(owned.rebirthNodes ?? {}) };
  return {
    rebirth: owned.rebirth,
    canRebirth: eligibility.canRebirth,
    ...(eligibility.reason ? { reason: eligibility.reason } : {}),
    pointsAvailable: owned.rebirthPointsAvailable ?? 0,
    nodes,
    pathPoints: computeRebirthPathPoints(nodes, data.rebirthNodes),
    growthBonusPercent: data.rebirthConfig.growthBonusPercent * owned.rebirth,
  };
}

function requireOwnedAndDef(
  playerId: string,
  uid: string,
  data: GameData,
): { owned: OwnedCharacter; def: NonNullable<ReturnType<GameData['characters']['get']>> } {
  const owned = repo.findOwnedCharacter(playerId, uid);
  if (!owned) throw notFound(`所持していないキャラクターです: ${uid}`);
  const def = data.characters.get(owned.defId);
  if (!def) throw notFound(`キャラクター定義が見つかりません: ${owned.defId}`);
  return { owned, def };
}

/* ============================================================
 * GET /api/characters/:uid/rebirth
 * ========================================================== */

export function getRebirthStatus(
  playerId: string,
  uid: string,
  data: GameData,
): RebirthStatusResponse {
  const { owned, def } = requireOwnedAndDef(playerId, uid, data);
  const equipmentByUid = equipmentByUidMap(playerId);
  const character: CharacterView = buildCharacterView(owned, def, data, equipmentByUid);
  const status = buildRebirthStatus(playerId, owned, data);
  return { character, status };
}

/* ============================================================
 * POST /api/characters/:uid/rebirth — 転生を実行する
 * ========================================================== */

export function executeRebirth(
  playerId: string,
  uid: string,
  data: GameData,
): RebirthResponse {
  const { owned, def } = requireOwnedAndDef(playerId, uid, data);
  const config = data.rebirthConfig;

  const eligibility = evaluateRebirthEligibility(playerId, owned, data);
  if (!eligibility.canRebirth) {
    throw rebirthLocked(eligibility.reason ?? '転生条件を満たしていません');
  }

  const equipmentByUid = equipmentByUidMap(playerId);
  const beforeStats: Record<string, number> = {
    ...computeOwnedStats(def, owned, equipmentByUid, data.rebirthNodes, config.growthBonusPercent),
  };
  const before = { level: owned.level, rebirth: owned.rebirth, stats: beforeStats };

  const newRebirth = owned.rebirth + 1;
  const newPointsAvailable = (owned.rebirthPointsAvailable ?? 0) + config.pointsPerRebirth;

  // 素材消費・レベル/EXPリセット・転生回数+1・ポイント付与を1トランザクションで確定させる。
  // **転生ノード(rebirth_nodes)はここでは触らない = 取得済みノードを維持する**(ファイル冒頭コメント参照)。
  repo.inTransaction(() => {
    consumeMaterials(playerId, config.cost);
    repo.updateCharacterRebirth(playerId, uid, {
      level: 1,
      exp: 0,
      rebirth: newRebirth,
      rebirthPointsAvailable: newPointsAvailable,
    });
  });

  const updated = repo.findOwnedCharacter(playerId, uid);
  if (!updated) throw notFound(`キャラクターが見つかりません: ${uid}`);
  const afterStats: Record<string, number> = {
    ...computeOwnedStats(def, updated, equipmentByUid, data.rebirthNodes, config.growthBonusPercent),
  };
  const after = { level: updated.level, rebirth: updated.rebirth, stats: afterStats };

  const character: CharacterView = buildCharacterView(updated, def, data, equipmentByUid);
  const status = buildRebirthStatus(playerId, updated, data);
  const player: PlayerProfile = getPlayerProfile(playerId);
  const inventory = buildInventoryResponse(playerId, data);

  return { character, status, player, before, after, inventory };
}

/* ============================================================
 * POST /api/characters/:uid/rebirth/allocate — 転生ポイントを振る
 * ========================================================== */

export function allocateRebirthPoints(
  playerId: string,
  uid: string,
  nodeId: string,
  ranks: number,
  data: GameData,
): RebirthStatusResponse {
  const { owned, def } = requireOwnedAndDef(playerId, uid, data);
  const nodeDef = data.rebirthNodes.get(nodeId);
  if (!nodeDef) throw rebirthLocked(`存在しない転生ノードです: ${nodeId}`, { nodeId });

  const currentNodes = { ...(owned.rebirthNodes ?? {}) };
  const currentRank = currentNodes[nodeId] ?? 0;
  const newRank = currentRank + ranks;
  if (newRank > nodeDef.maxRank) {
    throw rebirthLocked(
      `'${nodeDef.name}' は最大ランク(${nodeDef.maxRank})を超えています(現在 ${currentRank} + ${ranks})`,
      { nodeId, maxRank: nodeDef.maxRank, currentRank, ranks },
    );
  }

  if (nodeDef.requiresRebirth && owned.rebirth < nodeDef.requiresRebirth) {
    throw rebirthLocked(
      `'${nodeDef.name}' の解放には転生${nodeDef.requiresRebirth}回以上が必要です(現在${owned.rebirth}回)`,
      { nodeId, requiresRebirth: nodeDef.requiresRebirth, rebirth: owned.rebirth },
    );
  }

  // requiresPathPoints: 「同系統への累計投資」は今回の割り振り前の状態(= このノード自身の
  // 既存ランクも含む、他ノードからの投資)で判定する。まだ一度も投資していない系統へ
  // いきなり上位ノードから入ることを防ぐのが目的(§19のビルド分岐を成立させる制約)。
  if (nodeDef.requiresPathPoints) {
    const pathPointsBefore = computeRebirthPathPoints(currentNodes, data.rebirthNodes);
    const invested = pathPointsBefore[nodeDef.path] ?? 0;
    if (invested < nodeDef.requiresPathPoints) {
      throw rebirthLocked(
        `'${nodeDef.name}' の解放には${nodeDef.path}系統へ累計${nodeDef.requiresPathPoints}ポイントの` +
        `投資が必要です(現在 ${invested}ポイント)`,
        { nodeId, path: nodeDef.path, requiresPathPoints: nodeDef.requiresPathPoints, invested },
      );
    }
  }

  const totalCost = nodeDef.cost * ranks;
  const available = owned.rebirthPointsAvailable ?? 0;
  if (totalCost > available) {
    throw notEnoughPoints(
      `転生ポイントが不足しています(必要 ${totalCost} / 所持 ${available}): ${nodeDef.name}`,
      { nodeId, required: totalCost, available },
    );
  }

  currentNodes[nodeId] = newRank;
  const remaining = available - totalCost;
  repo.updateCharacterRebirthNodes(playerId, uid, currentNodes, remaining);

  const updated = repo.findOwnedCharacter(playerId, uid);
  if (!updated) throw notFound(`キャラクターが見つかりません: ${uid}`);
  const equipmentByUid = equipmentByUidMap(playerId);
  const character: CharacterView = buildCharacterView(updated, def, data, equipmentByUid);
  const status = buildRebirthStatus(playerId, updated, data);
  return { character, status };
}

/* ============================================================
 * POST /api/characters/:uid/rebirth/reset — 振り直す
 * ========================================================== */

export function resetRebirthPoints(
  playerId: string,
  uid: string,
  data: GameData,
): ResetRebirthResponse {
  const { owned, def } = requireOwnedAndDef(playerId, uid, data);
  const config = data.rebirthConfig;
  if (!config.resetCost || config.resetCost.length === 0) {
    throw rebirthLocked('振り直しは現在利用できません(振り直しに必要な素材が設定されていません)');
  }
  assertMaterialsAvailable(playerId, config.resetCost);

  const currentNodes = owned.rebirthNodes ?? {};
  // 消費済みポイントを全額返す。「消費済み」は現在のノード定義から再計算する
  // (クライアント申告は信用しない。データ不整合で定義が消えたノードは0扱いになる)。
  const spent = Object.entries(currentNodes).reduce((sum, [nodeId, rank]) => {
    const nodeDef = data.rebirthNodes.get(nodeId);
    return sum + (nodeDef ? nodeDef.cost * rank : 0);
  }, 0);
  const refunded = (owned.rebirthPointsAvailable ?? 0) + spent;

  repo.inTransaction(() => {
    consumeMaterials(playerId, config.resetCost);
    repo.updateCharacterRebirthNodes(playerId, uid, {}, refunded);
  });

  const updated = repo.findOwnedCharacter(playerId, uid);
  if (!updated) throw notFound(`キャラクターが見つかりません: ${uid}`);
  const equipmentByUid = equipmentByUidMap(playerId);
  const character: CharacterView = buildCharacterView(updated, def, data, equipmentByUid);
  const status = buildRebirthStatus(playerId, updated, data);
  const inventory = buildInventoryResponse(playerId, data);
  return { character, status, inventory };
}
