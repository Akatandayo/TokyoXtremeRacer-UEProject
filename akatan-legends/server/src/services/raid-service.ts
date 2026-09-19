/**
 * レイドバトル(サーバ権威。設計書§28〜§29)
 * ------------------------------------------------------------
 * 実装方針(最速で動かすための設計。docs/API.md も参照):
 *   レイドボスは「巨大な共有HPプール」(RaidBossDef.totalHp)を持つ。
 *   1回の挑戦は通常の戦闘(battle-service.startBattle と同じ組み立て)を
 *   そのまま `runBattle` に流し、**その戦闘で味方が与えた合計ダメージ**を
 *   プールから引く。戦闘エンジン(server/src/battle/**)には一切手を入れない。
 *
 * 流れ:
 *   1. 撃破済みなら RAID_DEFEATED で拒否
 *   2. 味方 CombatantInput を battle-service.toAllyCombatant で組み立てる
 *      (装備・転生・コンボはそちらの実装がそのまま反映する)
 *   3. ボスは RaidBossDef.enemyId + level から toEnemyCombatant で1体だけ作る
 *   4. 現在の残りHP割合で発動済みのギミックを求め、statBonus/unlockSkills をボスへ適用する
 *   5. runBattle を実行(通常戦闘と同じ BattleContext)
 *   6. 味方の合計与ダメージを残りHPから引く(0未満にはクランプしない。0で下げ止め)
 *   7. 新たに閾値を跨いだギミックを newGimmicks として返す
 *   8. 参加報酬(毎回)+ 撃破報酬(このターンで倒したときだけ)を1トランザクションで付与
 */
import { randomUUID } from 'node:crypto';
import type {
  BattleContext, CombatantInput,
} from '../battle/contract.js';
import type {
  BattleLog, BattleRewards, DropResult, MaterialStack, RaidAttackResponse, RaidAttemptResult,
  RaidBossDef, RaidGimmick, RaidListResponse, RaidState, StatKey,
} from '@akatan/shared';
import * as repo from '../db/repository.js';
import { getGameData, type GameData } from '../data/loader.js';
import { badRequest, notFound, raidDefeated } from './app-error.js';
import { getBattleEngine } from './battle-engine.js';
import { grantBattleExp } from './progression.js';
import {
  generateSeed, resolveBattleMembers, toAllyCombatant, toEnemyCombatant,
} from './battle-service.js';
import { listCharacterViews, getPlayerProfile } from './player-service.js';
import { resolveDrops } from './drop-service.js';
import { buildInventoryResponse } from './equipment-service.js';

/* ============================================================
 * 状態の解決
 * ========================================================== */

export function resolveRaidBoss(bossId: string, data: GameData = getGameData()): RaidBossDef {
  const boss = data.raidBosses.get(bossId);
  if (!boss) throw notFound(`レイドボスが見つかりません: ${bossId}`);
  return boss;
}

/** 未挑戦時の初期状態(remainingHp = totalHp)。DBには書き込まない(参照専用)。 */
function initRaidState(boss: RaidBossDef): RaidState {
  return {
    bossId: boss.id,
    remainingHp: boss.totalHp,
    totalHp: boss.totalHp,
    attempts: 0,
    totalDamage: 0,
    defeated: false,
    triggeredGimmicks: [],
  };
}

function getOrInitRaidState(playerId: string, boss: RaidBossDef): RaidState {
  return repo.findRaidState(playerId, boss.id) ?? initRaidState(boss);
}

/** GET /api/raid */
export function getRaidListResponse(
  playerId: string,
  data: GameData = getGameData(),
): RaidListResponse {
  const bosses = [...data.raidBosses.values()];
  const states: Record<string, RaidState> = {};
  for (const boss of bosses) {
    states[boss.id] = getOrInitRaidState(playerId, boss);
  }
  return { bosses, states };
}

/* ============================================================
 * ギミック
 * ========================================================== */

/** 指定 HP割合(%) で発動済みのギミック一覧(hpBelow の降順で評価。§29) */
function activeGimmicks(gimmicks: RaidGimmick[] | undefined, hpPercent: number): RaidGimmick[] {
  return [...(gimmicks ?? [])]
    .filter((g) => hpPercent <= g.hpBelow)
    .sort((a, b) => b.hpBelow - a.hpBelow);
}

/** HP/攻撃などは整数、%系は小数1桁まで(progression.ts の roundStat と同じ丸め方針) */
function roundStat(key: StatKey, value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (key === 'critical' || key === 'criticalDamage' || key === 'resistance' || key === 'healing') {
    return Math.round(value * 10) / 10;
  }
  return Math.round(value);
}

/**
 * 発動済みギミックの statBonus(%)/unlockSkills をボスの CombatantInput へ乗せる。
 * `grant`(状態異常の直接付与)は戦闘開始時の状態として渡す受け口が CombatantInput に無いため、
 * **今回は statBonus と unlockSkills だけ反映する**(将来対応。TODO: 戦闘エンジン担当と調整の上、
 * contract.ts に「戦闘開始時に付与する状態異常」の受け口を追加してから接続すること)。
 */
function applyGimmicksToBoss(base: CombatantInput, gimmicks: RaidGimmick[]): CombatantInput {
  if (gimmicks.length === 0) return base;

  const bonusPercent: Partial<Record<StatKey, number>> = {};
  const skills = new Set(base.skills);
  for (const g of gimmicks) {
    for (const [key, value] of Object.entries(g.statBonus ?? {}) as [StatKey, number | undefined][]) {
      if (typeof value !== 'number') continue;
      bonusPercent[key] = (bonusPercent[key] ?? 0) + value;
    }
    for (const skillId of g.unlockSkills ?? []) skills.add(skillId);
    // g.grant は未対応(上記コメント参照)。ここでは意図的に無視する。
  }

  const stats = { ...base.stats };
  for (const key of Object.keys(bonusPercent) as StatKey[]) {
    const pct = bonusPercent[key];
    if (typeof pct === 'number' && pct !== 0) {
      stats[key] = roundStat(key, stats[key] * (1 + pct / 100));
    }
  }

  return { ...base, stats, skills: [...skills] };
}

/* ============================================================
 * ドロップの合算(参加報酬 + 撃破報酬を1つの DropResult にまとめる)
 * ========================================================== */

function mergeMaterialStacks(a: MaterialStack[], b: MaterialStack[]): MaterialStack[] {
  const totals = new Map<string, number>();
  for (const m of [...a, ...b]) totals.set(m.id, (totals.get(m.id) ?? 0) + m.count);
  return [...totals.entries()].map(([id, count]) => ({ id, count }));
}

function mergeDropResults(a: DropResult, b: DropResult | null): DropResult {
  if (!b) return a;
  return {
    gold: a.gold + b.gold,
    equipment: [...a.equipment, ...b.equipment],
    materials: mergeMaterialStacks(a.materials, b.materials),
    characters: [...a.characters, ...b.characters],
    tickets: mergeMaterialStacks(a.tickets, b.tickets),
  };
}

/* ============================================================
 * 挑戦の実行
 * ========================================================== */

export interface AttackRaidParams {
  playerId: string;
  bossId: unknown;
  members?: unknown;
}

export function attackRaidBoss(
  params: AttackRaidParams,
  data: GameData = getGameData(),
): RaidAttackResponse {
  const { playerId } = params;

  if (typeof params.bossId !== 'string' || params.bossId.length === 0) {
    throw badRequest('bossId は必須の文字列です');
  }
  const boss = resolveRaidBoss(params.bossId, data);
  const enemyDef = data.enemies.get(boss.enemyId);
  if (!enemyDef) throw notFound(`レイドボスの敵定義が見つかりません: ${boss.enemyId}`);

  const existing = getOrInitRaidState(playerId, boss);
  if (existing.defeated) {
    throw raidDefeated(`このレイドボスは既に撃破済みです: ${boss.id}`, { bossId: boss.id });
  }

  // 味方編成: battle-service.startBattle とまったく同じ組み立て(装備・転生・コンボを反映)
  const members = resolveBattleMembers(playerId, params.members, data);
  const equipmentByUid = new Map(repo.listEquipment(playerId).map((e) => [e.uid, e]));
  const allies = members.map((m) => toAllyCombatant(
    m.owned, m.def, m.slot, equipmentByUid, data.rebirthNodes, data.rebirthConfig.growthBonusPercent,
  ));

  // ボスは1体だけ。現在の残りHP割合(このターン開始時点)で発動済みのギミックを適用する。
  const totalHp = existing.totalHp > 0 ? existing.totalHp : boss.totalHp;
  const hpBeforePercent = (existing.remainingHp / totalHp) * 100;
  const gimmicksAtStart = activeGimmicks(boss.gimmicks, hpBeforePercent);
  const bossBase = toEnemyCombatant(enemyDef, Math.max(1, Math.floor(boss.level || 1)), 0, 0);
  const bossCombatant = applyGimmicksToBoss(bossBase, gimmicksAtStart);
  const enemies: CombatantInput[] = [bossCombatant];

  const seed = generateSeed();
  const now = new Date().toISOString();
  const ctx: BattleContext = {
    skills: data.skills,
    aiProfiles: data.aiProfiles,
    affinity: data.affinity,
    config: data.progression.battle,
    seed,
    combos: data.combos,
    now,
  };

  const runBattle = getBattleEngine();
  const log: BattleLog = runBattle(allies, enemies, ctx);
  if (!log.id) log.id = `raid_${randomUUID()}`;
  if (typeof log.seed !== 'number') log.seed = seed;
  if (!log.createdAt) log.createdAt = now;

  // 味方が与えた合計ダメージを共有HPプールから引く(0未満にはならない)
  const allyStats = (log.result?.stats ?? []).filter((s) => s.side === 'ALLY');
  const damage = allyStats.reduce((sum, s) => sum + Math.max(0, s.damageDealt || 0), 0);
  const hpBefore = existing.remainingHp;
  const hpAfter = Math.max(0, hpBefore - damage);
  const willDefeatNow = hpAfter <= 0;

  // 新たに閾値を跨いだギミック(このターンで削った後のHP%で判定。既発動分は除く)
  const triggeredBefore = new Set(existing.triggeredGimmicks);
  const hpAfterPercent = (hpAfter / totalHp) * 100;
  const newGimmicks = (boss.gimmicks ?? [])
    .filter((g) => hpAfterPercent <= g.hpBelow && !triggeredBefore.has(g.name))
    .sort((a, b) => b.hpBelow - a.hpBelow);
  const triggeredGimmicks = [...new Set([...existing.triggeredGimmicks, ...newGimmicks.map((g) => g.name)])];

  let mvp: RaidAttemptResult['mvp'];
  for (const s of allyStats) {
    if (!mvp || s.damageDealt > mvp.damage) mvp = { id: s.id, name: s.name, damage: s.damageDealt };
  }

  const newState: RaidState = {
    bossId: boss.id,
    remainingHp: hpAfter,
    totalHp,
    attempts: existing.attempts + 1,
    totalDamage: existing.totalDamage + damage,
    defeated: willDefeatNow,
    triggeredGimmicks,
    updatedAt: now,
  };

  // レイドの EXP/ゴールドはボス定義に個別の値が無いため、ボスのレベルから概算する。
  // 通常ステージの水準(data/dungeons/*.json の rewards)を大まかに参考にした簡易係数
  // (exp ≈ level×35 / gold ≈ level×20。バランス調整は今回の対象外なので雑な固定係数で構わない)。
  const stageExp = Math.max(0, Math.round(boss.level * 35));
  const gold = Math.max(0, Math.round(boss.level * 20));

  // 状態の永続化・EXP/ゴールド付与・ドロップ付与は1トランザクションで行う。
  const { rewards, drops } = repo.inTransaction<{ rewards: BattleRewards; drops: DropResult | null }>(() => {
    repo.saveRaidState(playerId, newState);

    const survivedByUid = new Map<string, boolean>();
    for (const s of allyStats) survivedByUid.set(s.id, s.survived !== false);
    const { updates, levelUps, expPerMember } = grantBattleExp(
      members.map((m) => ({ owned: m.owned, def: m.def })),
      stageExp,
      data.progression,
      survivedByUid,
      { nodeDefs: data.rebirthNodes, growthBonusPercent: data.rebirthConfig.growthBonusPercent },
    );
    repo.updateCharacterProgressBulk(
      playerId,
      updates.map((u) => ({ uid: u.uid, level: u.level, exp: u.exp })),
    );
    repo.addGold(playerId, gold);

    // 参加報酬は毎回抽選する。撃破報酬は「このターンで撃破した」ときだけ抽選する
    // (resolveDrops は自身も repo.inTransaction を張るが better-sqlite3 の SAVEPOINT で
    // ネスト可能。battle-service.ts の同様のコメント参照)。
    const attemptDrops = resolveDrops(playerId, data, boss.attemptDropTable, boss.level);
    const defeatDrops = willDefeatNow ? resolveDrops(playerId, data, boss.dropTable, boss.level) : null;
    const mergedDrops = mergeDropResults(attemptDrops, defeatDrops);

    return { rewards: { exp: expPerMember, gold, levelUps }, drops: mergedDrops };
  });

  const raid: RaidAttemptResult = {
    damage,
    hpBefore,
    hpAfter,
    defeated: willDefeatNow,
    newGimmicks,
    mvp,
  };

  return {
    log,
    raid,
    state: newState,
    player: getPlayerProfile(playerId),
    characters: listCharacterViews(playerId, data),
    rewards,
    drops,
    inventory: buildInventoryResponse(playerId, data),
  };
}
