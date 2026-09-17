/** デモモード用のプレイヤー状態 */
import type {
  CharacterView, CharacterDef, OwnedCharacter, PlayerProfile, Party, Stats, Skill,
} from '@akatan/shared';
import { MOCK_CHARACTERS, MOCK_SKILL_MAP } from './master';

export function expToNext(level: number): number {
  return Math.round(100 * Math.pow(level, 1.6));
}

export function computeStats(def: CharacterDef, level: number, rebirth = 0): Stats {
  const lv = level - 1;
  const rb = 1 + rebirth * 0.08;
  const g = def.growth;
  const b = def.baseStats;
  const f = (base: number, grow?: number) => Math.round((base + (grow ?? 0) * lv) * rb);
  return {
    hp: f(b.hp, g.hp),
    attack: f(b.attack, g.attack),
    defense: f(b.defense, g.defense),
    speed: f(b.speed, g.speed),
    critical: Math.round((b.critical + (g.critical ?? 0) * lv) * 10) / 10,
    criticalDamage: b.criticalDamage + (g.criticalDamage ?? 0) * lv,
    resistance: b.resistance + (g.resistance ?? 0) * lv,
    healing: b.healing + (g.healing ?? 0) * lv,
  };
}

export function buildView(def: CharacterDef, owned: OwnedCharacter): CharacterView {
  const stats = computeStats(def, owned.level, owned.rebirth);
  const pick = (id: string): Skill =>
    MOCK_SKILL_MAP.get(id) ?? {
      id, name: id, kind: 'ACTIVE', description: '(未定義スキル)', cooldown: 0,
      target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [],
    };
  return {
    owned,
    def,
    stats,
    expToNext: Math.max(0, expToNext(owned.level) - owned.exp),
    skills: def.skills.map(pick),
    normalAttack: pick(def.normalAttack),
    ultimate: pick(def.ultimate),
  };
}

/** expRemain: 次のレベルまでの残りEXP(デモでレベルアップ演出を確実に見せるため) */
const OWNED_SEED: { defId: string; level: number; rebirth: number; ai?: string; expRemain?: number }[] = [
  { defId: 'ch_akane', level: 24, rebirth: 1, expRemain: 60 },
  { defId: 'ch_shiki', level: 21, rebirth: 0 },
  { defId: 'ch_inori', level: 20, rebirth: 0, expRemain: 110 },
  { defId: 'ch_noa', level: 18, rebirth: 0, ai: 'ai_support' },
  { defId: 'ch_tetsu', level: 19, rebirth: 0, ai: 'ai_defensive', expRemain: 95 },
  { defId: 'ch_rin', level: 15, rebirth: 0 },
  { defId: 'ch_zero', level: 12, rebirth: 0 },
  { defId: 'ch_yuu', level: 8, rebirth: 0, expRemain: 30 },
];

function makeOwned(): OwnedCharacter[] {
  return OWNED_SEED.map((s, i) => ({
    uid: `own_${String(i + 1).padStart(3, '0')}`,
    defId: s.defId,
    level: s.level,
    exp: s.expRemain !== undefined
      ? Math.max(0, expToNext(s.level) - s.expRemain)
      : Math.round(expToNext(s.level) * 0.42),
    rebirth: s.rebirth,
    aiProfile: s.ai,
    obtainedAt: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
  }));
}

/** デモ用の可変ステート(モックAPIが読み書きする) */
export const mockState = {
  player: {
    id: 'demo_player',
    name: 'デモ探索者',
    gold: 48200,
    stamina: 120,
    createdAt: new Date(Date.UTC(2026, 6, 20)).toISOString(),
    clearedStages: ['ch1-1', 'ch1-2', 'ch1-3'],
  } as PlayerProfile,
  owned: makeOwned(),
  party: {
    id: 'party_main',
    name: 'メイン編成',
    members: ['own_001', 'own_002', 'own_003', 'own_005', 'own_004'],
  } as Party,
};

export function mockCharacterViews(): CharacterView[] {
  const defs = new Map(MOCK_CHARACTERS.map((d) => [d.id, d]));
  return mockState.owned
    .map((o) => {
      const def = defs.get(o.defId);
      return def ? buildView(def, o) : null;
    })
    .filter((v): v is CharacterView => v !== null);
}
