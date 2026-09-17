/**
 * 戦闘エンジンの公開エントリ。
 * API層 (server/src/routes, services) はここからだけ import する。
 * 内部モジュール(engine/damage/status/ai/rng)の構成は今後変えうるため、境界をここに固定する。
 */
export { runBattle } from './engine.js';

// 補助的に公開するもの (API層のデバッグ/検証や、将来の戦力シミュレータ用)
export { createRng } from './rng.js';
export type { Rng } from './rng.js';
export { computeDamage, computeHeal, mitigation, affinityMultiplier } from './damage.js';
export type { DamageResult } from './damage.js';
export { STATUS_LABEL } from './status.js';
export type { CombatantInput, BattleContext, RunBattle } from './contract.js';
