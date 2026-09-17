/**
 * 戦闘サービス(サーバ権威)
 * ------------------------------------------------------------
 * 設計書 §37: **クライアントから来た数値は一切信用しない**。
 * リクエストで受け取るのは `stageId` と編成の uid のみ。
 * レベル・ステータス・敵構成・シード・報酬はすべてサーバが DB とマスタから再構築する。
 *
 * 流れ:
 *   1. ステージ解決 (マスタから)
 *   2. 編成の検証 (所持キャラか / 重複が無いか)
 *   3. 味方 CombatantInput 構築 (DB のレベル + マスタの成長率から再計算)
 *   4. 敵 CombatantInput 構築 (EnemyPlacement のレベルで成長計算)
 *   5. シード生成 -> runBattle 実行(決定論的)
 *   6. **勝利時のみ** 報酬付与 (EXP/ゴールド/クリア記録)
 *   7. ログ保存 (直近50件)
 */
import { randomUUID } from 'node:crypto';
import type {
  BattleLog, BattleRewards, BattleStartResponse, CharacterDef, EnemyDef,
  OwnedCharacter, StageDef,
} from '@akatan/shared';
import type { BattleContext, CombatantInput } from '../battle/contract.js';
import * as repo from '../db/repository.js';
import { getGameData, type GameData } from '../data/loader.js';
import { badRequest, notFound, partyEmpty, partyInvalid } from './app-error.js';
import { getBattleEngine } from './battle-engine.js';
import { computeEnemyStats, computeOwnedStats, computeGoldReward, grantBattleExp } from './progression.js';
import { listCharacterViews, getPlayerProfile } from './player-service.js';
import { getParty, validateMembers } from './party-service.js';

/* ============================================================
 * CombatantInput への変換
 * ========================================================== */

/** 所持キャラ + マスタ定義 -> 味方 CombatantInput */
export function toAllyCombatant(
  owned: OwnedCharacter,
  def: CharacterDef,
  slot: number,
): CombatantInput {
  return {
    // 戦闘中の識別子には uid をそのまま使う(報酬付与で紐付けるため)
    id: owned.uid,
    side: 'ALLY',
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles ?? [],
    level: owned.level,
    // ステータスはサーバ側で再計算した値のみ
    stats: computeOwnedStats(def, owned),
    normalAttack: def.normalAttack,
    skills: def.skills ?? [],
    ultimate: def.ultimate,
    passives: def.passives,
    // プレイヤーが選んだAI。未設定ならキャラ既定AI
    aiProfile: owned.aiProfile ?? def.defaultAi,
    awakening: def.awakening,
    art: def.art,
    rarity: def.rarity,
  };
}

/** 敵配置 + 敵定義 -> 敵 CombatantInput */
export function toEnemyCombatant(
  def: EnemyDef,
  level: number,
  slot: number,
  index: number,
): CombatantInput {
  return {
    id: `enemy_${slot}_${def.id}_${index}`,
    side: 'ENEMY',
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles ?? [],
    level,
    stats: computeEnemyStats(def, level),
    normalAttack: def.normalAttack,
    skills: def.skills ?? [],
    ultimate: def.ultimate,
    aiProfile: def.defaultAi,
    art: def.art,
  };
}

/* ============================================================
 * 入力解決
 * ========================================================== */

export function resolveStage(stageId: string, data: GameData = getGameData()): StageDef {
  const entry = data.stages.get(stageId);
  if (!entry) throw notFound(`ステージが見つかりません: ${stageId}`);
  return entry.stage;
}

/**
 * 出撃メンバーを解決する。
 * members 指定があればそれを検証して使い、無ければ保存済みパーティを使う。
 * どちらの場合も「そのプレイヤーの所持キャラか」を DB で必ず確認する。
 */
export function resolveBattleMembers(
  playerId: string,
  requested: unknown,
  data: GameData = getGameData(),
): { owned: OwnedCharacter; def: CharacterDef; slot: number }[] {
  const memberUids = requested === undefined || requested === null
    ? getParty(playerId).members
    : validateMembers(playerId, requested);

  const out: { owned: OwnedCharacter; def: CharacterDef; slot: number }[] = [];
  memberUids.forEach((uid, slot) => {
    if (!uid) return;
    // 保存済みパーティ経由でも必ず所持確認する(DB整合性が崩れていた場合の保険)
    const owned = repo.findOwnedCharacter(playerId, uid);
    if (!owned) throw partyInvalid(`所持していないキャラクターが編成されています: ${uid}`);
    const def = data.characters.get(owned.defId);
    if (!def) throw partyInvalid(`キャラクター定義が見つかりません: ${owned.defId}`);
    out.push({ owned, def, slot });
  });

  if (out.length === 0) throw partyEmpty();
  return out;
}

function buildEnemies(stage: StageDef, data: GameData): CombatantInput[] {
  const placements = stage.enemies ?? [];
  const enemies: CombatantInput[] = [];
  placements.forEach((p, index) => {
    const def = data.enemies.get(p.enemyId);
    if (!def) {
      console.warn(`[battle] stage '${stage.id}': 敵定義 '${p.enemyId}' が見つかりません。スキップします。`);
      return;
    }
    const slot = typeof p.position === 'number' ? p.position : index;
    enemies.push(toEnemyCombatant(def, Math.max(1, Math.floor(p.level || 1)), slot, index));
  });
  return enemies;
}

/** 再現可能かつ衝突しにくいシード(サーバ側で生成。クライアント指定は受け付けない) */
export function generateSeed(): number {
  // 上位ビットは時刻、下位はランダム。BattleLog.seed は number なので 2^31 未満に収める。
  const t = Date.now() % 1_000_000;
  const r = Math.floor(Math.random() * 2048);
  return (t * 2048 + r) % 2_147_483_647;
}

/* ============================================================
 * 戦闘実行
 * ========================================================== */

export interface StartBattleParams {
  playerId: string;
  stageId: unknown;
  members?: unknown;
}

export function startBattle(
  params: StartBattleParams,
  data: GameData = getGameData(),
): BattleStartResponse {
  const { playerId } = params;

  if (typeof params.stageId !== 'string' || params.stageId.length === 0) {
    throw badRequest('stageId は必須の文字列です');
  }
  const stage = resolveStage(params.stageId, data);

  const members = resolveBattleMembers(playerId, params.members, data);
  const allies = members.map((m) => toAllyCombatant(m.owned, m.def, m.slot));
  const enemies = buildEnemies(stage, data);
  if (enemies.length === 0) {
    throw badRequest(`ステージ '${stage.id}' に有効な敵が設定されていません`);
  }

  const seed = generateSeed();
  const ctx: BattleContext = {
    skills: data.skills,
    aiProfiles: data.aiProfiles,
    affinity: data.affinity,
    config: data.progression.battle,
    seed,
    stageId: stage.id,
  };

  const runBattle = getBattleEngine();
  const log: BattleLog = runBattle(allies, enemies, ctx);

  // エンジンが id/seed を埋めていないケースに備える(契約上は埋めてくるはず)
  if (!log.id) log.id = `btl_${randomUUID()}`;
  if (typeof log.seed !== 'number') log.seed = seed;
  if (!log.stageId) log.stageId = stage.id;
  if (!log.createdAt) log.createdAt = new Date().toISOString();

  const victory = log.result?.victory === true;

  // 報酬付与とログ保存は 1 トランザクションで行う(途中失敗で片方だけ残らないように)
  const rewards = repo.inTransaction<BattleRewards | null>(() => {
    const granted = victory ? grantRewards(playerId, stage, members, data) : null;
    repo.saveBattleLog(playerId, log);
    return granted;
  });

  // result.rewards にも同じ内容を入れておく(クライアントのリプレイ表示用)
  if (rewards && log.result) log.result.rewards = rewards;

  return {
    log,
    rewards,
    player: getPlayerProfile(playerId),
    characters: listCharacterViews(playerId, data),
    stage,
  };
}

/**
 * 報酬をサーバ側で確定して付与する。
 * - EXP: 出撃した全員に同額 (理由は progression.grantBattleExp のコメント参照)
 * - ゴールド: プレイヤーへ加算
 * - クリア記録: cleared_stages に記録(2回目以降も報酬自体は貰える)
 */
function grantRewards(
  playerId: string,
  stage: StageDef,
  members: { owned: OwnedCharacter; def: CharacterDef }[],
  data: GameData,
): BattleRewards {
  const stageExp = Math.max(0, Math.floor(stage.rewards?.exp ?? 0));
  const gold = computeGoldReward(stage.rewards?.gold ?? 0);

  const { updates, levelUps, expPerMember } = grantBattleExp(
    members.map((m) => ({ owned: m.owned, def: m.def })),
    stageExp,
    data.progression,
  );

  repo.updateCharacterProgressBulk(
    playerId,
    updates.map((u) => ({ uid: u.uid, level: u.level, exp: u.exp })),
  );
  repo.addGold(playerId, gold);
  repo.markStageCleared(playerId, stage.id);

  return { exp: expPerMember, gold, levelUps };
}
