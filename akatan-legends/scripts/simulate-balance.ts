#!/usr/bin/env -S npx tsx
/**
 * バランス調整用の戦闘シミュレータ (data担当のスクラッチツール)
 * ------------------------------------------------------------
 * server/src/battle/engine.ts (本番のバトルエンジン) を直接呼び出し、
 * DB/HTTPを経由せずに大量試行のシミュレーションを行う。
 * `node scripts/validate-data.mjs` の対象外・本番コードにも影響しない。
 *
 * 使い方:
 *   npx tsx scripts/simulate-balance.ts <stageId> <partyLevel> [trials] [partyIds...]
 *   npx tsx scripts/simulate-balance.ts ch1-1 1 300
 *   npx tsx scripts/simulate-balance.ts ch1-5 9 300 kurogane hokuto momiji enji amagi
 *
 * partyIds を省略すると新規プレイヤーの初期パーティ
 * (kurogane, hokuto, momiji, enji, amagi) を使う。
 */
import { getGameData } from '../server/src/data/loader.js';
import { runBattle } from '../server/src/battle/engine.js';
import { computeStats } from '../server/src/services/progression.js';
import type { CombatantInput } from '../server/src/battle/contract.js';
import type { CharacterDef, EnemyDef, StageDef } from '@akatan/shared';

const DEFAULT_PARTY = ['kurogane', 'hokuto', 'momiji', 'enji', 'amagi'];

function toAllyInput(def: CharacterDef, level: number, slot: number): CombatantInput {
  return {
    id: `ally_${slot}_${def.id}`,
    side: 'ALLY',
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles,
    level,
    stats: computeStats(def.baseStats, def.growth, level),
    normalAttack: def.normalAttack,
    skills: def.skills,
    ultimate: def.ultimate,
    passives: def.passives,
    aiProfile: def.defaultAi,
    awakening: def.awakening,
    art: def.art,
    rarity: def.rarity,
    tags: def.tags,
  };
}

function toEnemyInput(def: EnemyDef, level: number, slot: number, idx: number): CombatantInput {
  return {
    id: `enemy_${slot}_${idx}_${def.id}`,
    side: 'ENEMY',
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles,
    level,
    stats: computeStats(def.baseStats, def.growth, level),
    normalAttack: def.normalAttack,
    skills: def.skills,
    ultimate: def.ultimate,
    aiProfile: def.defaultAi,
    art: def.art,
    rarity: undefined,
  };
}

function main(): void {
  const [stageId, levelStr, trialsStr, ...rest] = process.argv.slice(2);
  if (!stageId || !levelStr) {
    console.error('使い方: npx tsx scripts/simulate-balance.ts <stageId> <partyLevel> [trials] [partyIds...]');
    process.exit(1);
  }
  const level = Number(levelStr);
  const trials = trialsStr ? Number(trialsStr) : 200;
  const partyIds = rest.length > 0 ? rest : DEFAULT_PARTY;

  const data = getGameData();
  if (data.warnings.length > 0) {
    console.error(`[警告 ${data.warnings.length}件]`);
    for (const w of data.warnings) console.error('  ⚠ ' + w);
  }

  const stageEntry = data.stages.get(stageId);
  if (!stageEntry) { console.error(`ステージが見つかりません: ${stageId}`); process.exit(1); }
  const stage: StageDef = stageEntry.stage;

  const allyDefs = partyIds.map((id) => {
    const d = data.characters.get(id);
    if (!d) throw new Error(`キャラが見つかりません: ${id}`);
    return d;
  });

  let wins = 0;
  let totalActions = 0;
  let totalSurvivors = 0;
  let totalAllyDeaths = 0;
  let totalCombos = 0;
  const actionCounts: number[] = [];

  for (let i = 0; i < trials; i++) {
    const allies = allyDefs.map((d, slot) => toAllyInput(d, level, slot));
    const enemies = (stage.enemies ?? []).map((p, idx) => {
      const def = data.enemies.get(p.enemyId);
      if (!def) throw new Error(`敵が見つかりません: ${p.enemyId}`);
      return toEnemyInput(def, p.level, p.position ?? idx, idx);
    });

    const log = runBattle(allies, enemies, {
      skills: data.skills,
      aiProfiles: data.aiProfiles,
      affinity: data.affinity,
      config: data.progression.battle,
      seed: 1000 + i,
      stageId: stage.id,
      combos: data.combos,
    });

    if (log.result.victory) wins++;
    const actions = log.events.filter((e) => e.type === 'ACTION_START').length;
    totalActions += actions;
    actionCounts.push(actions);
    const survivors = log.result.stats.filter((s) => s.side === 'ALLY' && s.survived).length;
    totalSurvivors += survivors;
    totalAllyDeaths += (allyDefs.length - survivors);
    totalCombos += log.events.filter((e) => e.type === 'COMBO').length;
  }

  const winRate = (wins / trials) * 100;
  const avgActions = totalActions / trials;
  const avgSurvivors = totalSurvivors / trials;
  const avgDeaths = totalAllyDeaths / trials;
  actionCounts.sort((a, b) => a - b);
  const p50 = actionCounts[Math.floor(trials * 0.5)];

  console.log(`\n=== ${stage.id} "${stage.name}" | Lv${level} | ${partyIds.join(',')} | ${trials}試行 ===`);
  console.log(`  勝率        : ${winRate.toFixed(1)}%`);
  console.log(`  平均行動数  : ${avgActions.toFixed(1)}  (中央値 ${p50})`);
  console.log(`  平均生存    : ${avgSurvivors.toFixed(2)} / ${allyDefs.length}`);
  console.log(`  平均戦闘不能: ${avgDeaths.toFixed(2)} / ${allyDefs.length}`);
  console.log(`  平均コンボ数: ${(totalCombos / trials).toFixed(2)}`);
}

main();
