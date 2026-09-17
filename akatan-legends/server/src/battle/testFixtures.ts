/**
 * テスト専用フィクスチャ (本番コードからは import しないこと)
 * ------------------------------------------------------------
 * data/ は別担当が作成中なので、戦闘エンジンのテストは自前のキャラ/スキル定義だけで完結させる。
 * ファイル名が *.test.ts ではないのでテストランナーには拾われない。
 */
import type {
  AffinityTable, AiProfile, Awakening, ProgressionConfig, Skill, Stats,
} from '@akatan/shared';
import type { BattleContext, CombatantInput } from './contract.js';

export const baseStats: Stats = {
  hp: 1000, attack: 200, defense: 100, speed: 100,
  critical: 0, criticalDamage: 150, resistance: 0, healing: 100,
};

export const SKILLS: Skill[] = [
  {
    id: 'atk_normal', name: '斬撃', kind: 'NORMAL', description: '通常攻撃', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'DAMAGE', power: 1.0 }], fx: 'slash',
  },
  {
    id: 'poison_strike', name: '毒牙', kind: 'ACTIVE', description: '毒を与える', cooldown: 1,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [
      { type: 'DAMAGE', power: 0.8 },
      { type: 'STATUS', status: 'POISON', duration: 3, potency: 5, chance: 100 },
    ], fx: 'venom',
  },
  {
    id: 'stun_bolt', name: '雷撃', kind: 'ACTIVE', description: 'スタンさせる', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'STATUS', status: 'STUN', duration: 2, chance: 100 }], fx: 'bolt',
  },
  {
    id: 'silence_song', name: '沈黙の歌', kind: 'ACTIVE', description: '沈黙させる', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'STATUS', status: 'SILENCE', duration: 3, chance: 100 }],
  },
  {
    id: 'heal_small', name: '治癒の光', kind: 'ACTIVE', description: '味方を回復', cooldown: 2,
    target: { side: 'ALLY', pattern: 'LOWEST_HP' },
    effects: [{ type: 'HEAL', power: 1.5 }], fx: 'heal',
  },
  {
    id: 'guard_up', name: '守勢', kind: 'ACTIVE', description: '自分の防御を上げる', cooldown: 3,
    target: { side: 'SELF', pattern: 'SELF' },
    effects: [{ type: 'STATUS', status: 'DEF_UP', duration: 3, potency: 50 }],
  },
  {
    id: 'big_ult', name: '終焉の刃', kind: 'ULTIMATE', description: '敵全体に大ダメージ', cooldown: 0,
    ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' },
    effects: [{ type: 'DAMAGE', power: 2.0 }], fx: 'ult',
  },
  {
    id: 'awk_normal', name: '断罪斬', kind: 'NORMAL', description: '覚醒後の通常攻撃', cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'DAMAGE', power: 1.6 }],
  },
];

export const AI_PROFILES: AiProfile[] = [
  { id: 'ai_basic', name: '基本', rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'NORMAL' }] },
  {
    id: 'ai_healer', name: '治癒',
    rules: [
      { priority: 1, condition: { type: 'ALLY_HP_BELOW', value: 50 }, skill: 'heal_small' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
  {
    id: 'ai_poison', name: '毒',
    rules: [
      { priority: 1, condition: { type: 'ALWAYS' }, skill: 'poison_strike' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
  {
    id: 'ai_stun', name: '麻痺',
    rules: [
      { priority: 1, condition: { type: 'ALWAYS' }, skill: 'stun_bolt' },
    ],
  },
  {
    id: 'ai_silence', name: '沈黙',
    rules: [{ priority: 1, condition: { type: 'ALWAYS' }, skill: 'silence_song' }],
  },
  {
    id: 'ai_ult', name: '必殺優先',
    rules: [
      { priority: 1, condition: { type: 'ULT_READY' }, skill: 'big_ult' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
  {
    id: 'ai_guard', name: '守勢',
    rules: [
      { priority: 1, condition: { type: 'SELF_HP_BELOW', value: 80 }, skill: 'guard_up' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
];

export const AFFINITY: AffinityTable = {
  FIRE: { WIND: 1.5, WATER: 0.5 },
  WATER: { FIRE: 1.5, EARTH: 0.5 },
};

export const CONFIG: ProgressionConfig['battle'] = {
  gaugeRate: 0.1,      // speed100 => 10/tick => 10ティックで1行動
  gaugeMax: 100,
  ultGainOnAction: 25,
  ultGainOnHit: 10,
  ultMax: 100,
  defenseConstant: 300,
  maxTicks: 5000,
  damageVariance: 0.05,
};

export function skillMap(extra: Skill[] = []): Map<string, Skill> {
  return new Map([...SKILLS, ...extra].map((s) => [s.id, s]));
}
export function aiMap(extra: AiProfile[] = []): Map<string, AiProfile> {
  return new Map([...AI_PROFILES, ...extra].map((p) => [p.id, p]));
}

export function makeContext(over: Partial<BattleContext> = {}): BattleContext {
  return {
    skills: skillMap(),
    aiProfiles: aiMap(),
    affinity: AFFINITY,
    config: { ...CONFIG },
    seed: 12345,
    ...over,
  };
}

let autoSlot = 0;
export function unit(over: Partial<CombatantInput> & { id: string }): CombatantInput {
  const side = over.side ?? 'ALLY';
  return {
    side,
    slot: over.slot ?? autoSlot++,
    name: over.name ?? over.id,
    defId: over.defId ?? over.id,
    element: over.element ?? 'VOID',
    roles: over.roles ?? ['ATTACKER'],
    level: over.level ?? 1,
    stats: { ...baseStats, ...(over.stats ?? {}) },
    normalAttack: over.normalAttack ?? 'atk_normal',
    skills: over.skills ?? [],
    ultimate: over.ultimate,
    passives: over.passives,
    aiProfile: over.aiProfile ?? 'ai_basic',
    awakening: over.awakening,
    art: over.art,
    rarity: over.rarity,
    ...over,
  };
}

export const AWAKENING_TURN1: Awakening = {
  id: 'awk_test', name: '覚醒・試', description: 'テスト用覚醒',
  condition: { turnAtLeast: 1 },
  statBonus: { attack: 50 },
  skillReplace: { atk_normal: 'awk_normal' },
  grant: [{ status: 'ATK_UP', duration: 5, potency: 20 }],
  fx: 'awaken',
};
