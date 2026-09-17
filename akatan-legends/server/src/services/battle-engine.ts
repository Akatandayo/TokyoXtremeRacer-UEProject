/**
 * 戦闘エンジンの読み込み
 * ------------------------------------------------------------
 * 戦闘エンジンは別担当が `server/src/battle/index.ts` から `runBattle` を
 * `RunBattle` 署名 (battle/contract.ts) で export する。
 *
 * 並行開発中は当該ファイルがまだ存在しないことがあるため、
 *   - 動的 import で読み込み(存在しなければ例外を握りつぶす)
 *   - 未実装の間はこのファイル内の **暫定フォールバックエンジン** を使う
 * ことで API 側の開発と疎通確認を止めない。
 * 本物が生えたら自動的にそちらが使われる(このファイルの変更は不要)。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  BattleEvent, BattleLog, BattleUnit, BattleUnitSnapshot, BattleUnitStat,
} from '@akatan/shared';
import type { CombatantInput, RunBattle } from '../battle/contract.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cached: RunBattle | null = null;
let usingFallback = false;

/** 本物の戦闘エンジンが読み込めているか(health で公開する) */
export function isUsingFallbackEngine(): boolean {
  return usingFallback;
}

function battleModuleExists(): boolean {
  const dir = path.resolve(__dirname, '../battle');
  return ['index.ts', 'index.js', 'index.mts'].some((f) => fs.existsSync(path.join(dir, f)));
}

/**
 * 戦闘エンジンを読み込む。起動時に一度呼ぶ。
 * 注意: 静的 import にすると battle/index.ts 未作成時に型エラー & 起動失敗になるため、
 *       specifier を変数にして動的 import している(TS の静的解決を意図的に回避)。
 */
export async function loadBattleEngine(): Promise<RunBattle> {
  if (cached) return cached;

  if (battleModuleExists()) {
    const specifier = '../battle/index.js';
    try {
      const mod = (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
      const fn = mod.runBattle ?? mod.default;
      if (typeof fn === 'function') {
        cached = fn as RunBattle;
        usingFallback = false;
        return cached;
      }
      console.warn('[battle] server/src/battle/index.ts に runBattle が見つかりません。フォールバックを使用します。');
    } catch (err) {
      console.warn('[battle] 戦闘エンジンの読み込みに失敗しました。フォールバックを使用します:', err);
    }
  } else {
    console.warn('[battle] server/src/battle/index.ts が未作成です。暫定フォールバックエンジンを使用します。');
  }

  cached = fallbackRunBattle;
  usingFallback = true;
  return cached;
}

/** 読み込み済みエンジンを取得(未ロードならフォールバック) */
export function getBattleEngine(): RunBattle {
  if (!cached) {
    usingFallback = true;
    cached = fallbackRunBattle;
  }
  return cached;
}

/* ============================================================
 * 暫定フォールバックエンジン
 * ============================================================
 * 本物が来るまでの繋ぎ。通常攻撃のみ・状態異常なしの単純な行動ゲージ戦闘。
 * BattleLog の形だけは契約通りに埋めるので、クライアントの再生確認には使える。
 * ※ バランス調整の参考にはしないこと。
 */

/** 決定論的な線形合同法乱数(同じシードなら同じログ) */
function createRng(seed: number): () => number {
  let state = (Math.floor(seed) >>> 0) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function toUnit(input: CombatantInput): BattleUnit {
  const maxHp = Math.max(1, Math.round(input.stats.hp));
  return {
    id: input.id,
    side: input.side,
    slot: input.slot,
    name: input.name,
    defId: input.defId,
    element: input.element,
    roles: input.roles,
    level: input.level,
    stats: input.stats,
    hp: maxHp,
    maxHp,
    gauge: 0,
    ultGauge: 0,
    statuses: [],
    alive: true,
    awakened: false,
    art: input.art,
    rarity: input.rarity,
  };
}

function snapshot(units: BattleUnit[]): BattleUnitSnapshot[] {
  return units.map((u) => ({
    id: u.id,
    hp: u.hp,
    gauge: Math.round(u.gauge),
    ultGauge: Math.round(u.ultGauge),
    alive: u.alive,
    awakened: u.awakened,
    statuses: u.statuses.map((s) => ({ ...s })),
  }));
}

export const fallbackRunBattle: RunBattle = (allies, enemies, ctx): BattleLog => {
  const inputs = [...allies, ...enemies];
  const units = inputs.map(toUnit);
  const normalAttackOf = new Map(inputs.map((i) => [i.id, i.normalAttack]));
  const rng = createRng(ctx.seed);
  const cfg = ctx.config;
  const events: BattleEvent[] = [];
  let seq = 0;
  let tick = 0;
  let turns = 0;

  const stats = new Map<string, BattleUnitStat>(
    units.map((u) => [u.id, {
      id: u.id, name: u.name, side: u.side,
      damageDealt: 0, damageTaken: 0, healing: 0, kills: 0, survived: true,
    }]),
  );

  const push = (e: Omit<BattleEvent, 'seq' | 'tick'>): void => {
    seq += 1;
    events.push({ seq, tick, ...e, snapshot: snapshot(units) });
  };

  push({ type: 'BATTLE_START', text: '戦闘開始' });

  const aliveOf = (side: 'ALLY' | 'ENEMY'): BattleUnit[] =>
    units.filter((u) => u.side === side && u.alive);

  const maxTicks = Math.max(10, cfg.maxTicks);
  while (tick < maxTicks && aliveOf('ALLY').length > 0 && aliveOf('ENEMY').length > 0) {
    tick += 1;
    for (const u of units) {
      if (!u.alive) continue;
      u.gauge += Math.max(1, u.stats.speed) * cfg.gaugeRate;
      if (u.gauge < cfg.gaugeMax) continue;
      u.gauge -= cfg.gaugeMax;
      turns += 1;

      const foes = aliveOf(u.side === 'ALLY' ? 'ENEMY' : 'ALLY');
      if (foes.length === 0) break;
      const target = foes[Math.floor(rng() * foes.length) % foes.length];

      const skillId = normalAttackOf.get(u.id);
      const skillName = skillId ? ctx.skills.get(skillId)?.name : undefined;
      push({ type: 'ACTION_START', sourceId: u.id });
      push({ type: 'SKILL_USE', sourceId: u.id, targetId: target.id, skillId, skillName, text: skillName ?? '通常攻撃' });

      const atk = Math.max(1, u.stats.attack);
      const def = Math.max(0, target.stats.defense);
      const variance = 1 + (rng() * 2 - 1) * cfg.damageVariance;
      const critical = rng() * 100 < u.stats.critical;
      const critMul = critical ? Math.max(100, u.stats.criticalDamage) / 100 : 1;
      const raw = (atk * atk) / (atk + def + cfg.defenseConstant) * variance * critMul;
      const damage = Math.max(1, Math.round(raw));

      target.hp = Math.max(0, target.hp - damage);
      const s = stats.get(u.id)!;
      const ts = stats.get(target.id)!;
      s.damageDealt += damage;
      ts.damageTaken += damage;
      u.ultGauge = Math.min(cfg.ultMax, u.ultGauge + cfg.ultGainOnAction);
      target.ultGauge = Math.min(cfg.ultMax, target.ultGauge + cfg.ultGainOnHit);

      push({ type: 'DAMAGE', sourceId: u.id, targetId: target.id, value: damage, critical, affinity: 1 });

      if (target.hp === 0) {
        target.alive = false;
        ts.survived = false;
        s.kills += 1;
        push({ type: 'DEFEAT', targetId: target.id });
      }
      push({ type: 'ACTION_END', sourceId: u.id });

      if (aliveOf('ALLY').length === 0 || aliveOf('ENEMY').length === 0) break;
    }
  }

  const victory = aliveOf('ENEMY').length === 0 && aliveOf('ALLY').length > 0;
  push({ type: 'BATTLE_END', text: victory ? '勝利' : '敗北' });

  return {
    id: `btl_${ctx.seed.toString(36)}`,
    seed: ctx.seed,
    stageId: ctx.stageId,
    // P0-3: createdAt はAPI層(呼び出し元)から渡された ctx.now を使う。
    // エンジン内で Date.now() を呼ぶと決定論(同シード同ログ)が壊れるため。
    createdAt: ctx.now || new Date().toISOString(),
    units: inputs.map(toUnit),
    events,
    result: {
      victory,
      ticks: tick,
      turns,
      stats: [...stats.values()],
    },
  };
};
