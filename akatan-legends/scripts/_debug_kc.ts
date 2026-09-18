#!/usr/bin/env -S npx tsx
/**
 * 孤月紅葉(幽波紋) 実測用スクラッチ (一時ファイル・検証後に削除)
 */
import { getGameData } from '../server/src/data/loader.js';
import { runBattle } from '../server/src/battle/engine.js';
import { computeStats } from '../server/src/services/progression.js';
import type { CombatantInput } from '../server/src/battle/contract.js';
import type { CharacterDef, EnemyDef, StageDef } from '@akatan/shared';

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
  const level = Number(levelStr);
  const trials = trialsStr ? Number(trialsStr) : 200;
  const partyIds = rest.length > 0 ? rest : ['kurogane', 'hokuto', 'momiji_kc', 'enji', 'amagi'];

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

  // 各キャラのLv換算ステータスを1回表示
  console.log(`\n=== Lv${level} ステータス ===`);
  for (const d of allyDefs) {
    const s = computeStats(d.baseStats, d.growth, level);
    console.log(`  ${d.name.padEnd(8, '　')} (${d.id}) HP:${s.hp} ATK:${s.attack} DEF:${s.defense} SPD:${s.speed} CRIT:${s.critical}% CDMG:${s.criticalDamage}%`);
  }

  const perUnit = new Map<string, { actions: number; damageDealt: number; damageTaken: number; deaths: number; kills: number }>();
  for (const d of allyDefs) perUnit.set(d.id, { actions: 0, damageDealt: 0, damageTaken: 0, deaths: 0, kills: 0 });

  let wins = 0;
  let totalCombos = 0;
  let awakenCount = 0;
  let firstActorCounts = new Map<string, number>();

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
      seed: 5000 + i,
      stageId: stage.id,
      combos: data.combos,
    });

    if (log.result.victory) wins++;
    totalCombos += log.events.filter((e) => e.type === 'COMBO').length;
    awakenCount += log.events.filter((e) => e.type === 'AWAKEN').length;

    const firstAction = log.events.find((e) => e.type === 'ACTION_START');
    if (firstAction && firstAction.sourceId) {
      const unit = log.units.find((u) => u.id === firstAction.sourceId);
      if (unit) firstActorCounts.set(unit.defId, (firstActorCounts.get(unit.defId) ?? 0) + 1);
    }

    for (const u of log.units) {
      const actions = log.events.filter((e) => e.type === 'ACTION_START' && e.sourceId === u.id).length;
      const stat = log.result.stats.find((s) => s.id === u.id);
      const rec = perUnit.get(u.defId);
      if (rec && stat) {
        rec.actions += actions;
        rec.damageDealt += stat.damageDealt;
        rec.damageTaken += stat.damageTaken;
        rec.kills += stat.kills;
        if (!stat.survived) rec.deaths += 1;
      }
    }
  }

  console.log(`\n=== ${stage.id} "${stage.name}" | Lv${level} | ${partyIds.join(',')} | ${trials}試行 ===`);
  console.log(`  勝率        : ${((wins / trials) * 100).toFixed(1)}%`);
  console.log(`  平均コンボ数: ${(totalCombos / trials).toFixed(2)}`);
  console.log(`  覚醒発動回数: ${awakenCount} / ${trials}戦`);
  console.log(`  初手を取った割合:`);
  for (const [defId, count] of [...firstActorCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${defId.padEnd(14)}: ${((count / trials) * 100).toFixed(1)}%`);
  }
  console.log(`  ユニット別 (${trials}戦累計 → 1戦あたり):`);
  for (const [defId, rec] of perUnit.entries()) {
    console.log(`    ${defId.padEnd(14)} 行動回数:${(rec.actions / trials).toFixed(2)}  与ダメ:${(rec.damageDealt / trials).toFixed(0)}  被ダメ:${(rec.damageTaken / trials).toFixed(0)}  撃破数:${(rec.kills / trials).toFixed(2)}  戦闘不能率:${((rec.deaths / trials) * 100).toFixed(1)}%`);
  }
}

main();
