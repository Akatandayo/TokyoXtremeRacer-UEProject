/** デモモード用のプレイヤー状態 */
import type {
  CharacterView, CharacterDef, OwnedCharacter, PlayerProfile, Party, Stats, Skill,
  EquipmentInstance, InventoryResponse, StatKey, ItemRarity,
} from '@akatan/shared';
import { MOCK_CHARACTERS, MOCK_SKILL_MAP } from './master';
import { buildStarterInventory, generateEquipment, RARITY_ORDER_LIST } from './equipment';

/**
 * 負荷検証用: `?mock=1&stress=N` を付けると、装備の所持数を N 件まで水増しする。
 * 「装備が多く余り過ぎてラグの原因になる」という報告の再現・計測専用のデバッグ用途
 * (通常のデモ体験には一切影響しない。既定は 0 = 何もしない)。
 */
function readStressEquipCount(): number {
  try {
    if (typeof window === 'undefined') return 0;
    const q = new URLSearchParams(window.location.search).get('stress');
    if (!q) return 0;
    const n = parseInt(q, 10);
    return Number.isFinite(n) && n > 0 ? Math.min(n, 5000) : 0;
  } catch {
    return 0;
  }
}

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

/** 装備の flat/percent ステータスをキャラの計算済みステータスへ加算する。 */
export function applyEquipmentStats(base: Stats, equipped: EquipmentInstance[]): Stats {
  if (equipped.length === 0) return base;
  const out: Stats = { ...base };
  for (const eq of equipped) {
    for (const [k, v] of Object.entries(eq.stats)) {
      const key = k as StatKey;
      out[key] = (out[key] ?? 0) + (v ?? 0);
    }
  }
  for (const eq of equipped) {
    if (!eq.statsPercent) continue;
    for (const [k, pct] of Object.entries(eq.statsPercent)) {
      const key = k as StatKey;
      out[key] = Math.round((out[key] ?? 0) * (1 + (pct ?? 0) / 100));
    }
  }
  out.critical = Math.round(out.critical * 10) / 10;
  out.speed = Math.round(out.speed * 10) / 10;
  return out;
}

/** 指定キャラが現在装着している装備インスタンスを uid から解決する */
export function equippedItemsOf(owned: OwnedCharacter): EquipmentInstance[] {
  const slots = owned.equipment;
  if (!slots) return [];
  const uids = Object.values(slots).filter((u): u is string => !!u);
  return uids
    .map((uid) => mockState.inventory.equipment.find((e) => e.uid === uid))
    .filter((e): e is EquipmentInstance => !!e);
}

export function buildView(def: CharacterDef, owned: OwnedCharacter): CharacterView {
  const rawStats = computeStats(def, owned.level, owned.rebirth);
  const stats = applyEquipmentStats(rawStats, equippedItemsOf(owned));
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
const OWNED_SEED: {
  defId: string; level: number; rebirth: number; ai?: string; expRemain?: number;
  /** P4-1: 転生ポイントの割り振り状況(デモ用)。ノードID -> 取得ランク */
  rebirthNodes?: Record<string, number>;
  /** P4-1: 未使用の転生ポイント */
  rebirthPointsAvailable?: number;
}[] = [
  // 転生1回目済み・攻撃型に大きく投資し、未使用ポイントも残す(§19のビルド分岐 + 「振り忘れ」を確認できる)
  {
    defId: 'ch_akane', level: 24, rebirth: 1, expRemain: 60,
    rebirthNodes: { rn_atk_1: 3, rn_atk_2: 1 },
    rebirthPointsAvailable: 7,
  },
  // 転生条件(デモではLv20)を満たしているが未転生。転生画面で「今すぐ転生できる」ケースを確認できる
  { defId: 'ch_shiki', level: 21, rebirth: 0 },
  { defId: 'ch_inori', level: 20, rebirth: 0, expRemain: 110 },
  // 以下はデモの転生必要レベル(20)未満。「レベルが足りない」ロック表示を確認できる
  { defId: 'ch_noa', level: 18, rebirth: 0, ai: 'ai_support' },
  { defId: 'ch_tetsu', level: 19, rebirth: 0, ai: 'ai_defensive', expRemain: 95 },
  { defId: 'ch_rin', level: 15, rebirth: 0 },
  { defId: 'ch_zero', level: 12, rebirth: 0 },
  { defId: 'ch_yuu', level: 8, rebirth: 0, expRemain: 30 },
  // P5-3: レイド関連の確認用(「引き合う引力」ペアコンボ + 新UR「電子 独(幽波紋)」の見た目)。
  // デフォルト編成には含めない(パーティを組んだ時だけコンボが成立することを確認できるように)。
  { defId: 'ch_momiji_kc', level: 22, rebirth: 0 },
  { defId: 'ch_hitori_stand', level: 20, rebirth: 0 },
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
    rebirthNodes: s.rebirthNodes,
    rebirthPointsAvailable: s.rebirthPointsAvailable,
    obtainedAt: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
  }));
}

const starterInventory = buildStarterInventory();
const starterOwned = makeOwned();

// 負荷検証用の水増し(?stress=N)。通常時は readStressEquipCount() が 0 を返すので何もしない。
const stressCount = readStressEquipCount();
if (stressCount > 0) {
  for (let i = 0; i < stressCount; i++) {
    const rarity = RARITY_ORDER_LIST[i % RARITY_ORDER_LIST.length]!;
    starterInventory.equipment.push(generateEquipment(rarity as ItemRarity, 1 + (i % 60)));
  }
}
// デモ用: 灯守あかね(own_001)の武器/防具枠に初期装備を割り当てておく。
// (装着中の比較UI・売却不可表示を初回描画から確認できるようにするため)
if (starterInventory.equipment[0] && starterInventory.equipment[1]) {
  const weapon = starterInventory.equipment.find((e) => e.slot === 'WEAPON');
  const armor = starterInventory.equipment.find((e) => e.slot === 'ARMOR');
  const akane = starterOwned.find((o) => o.defId === 'ch_akane');
  if (akane && weapon && armor) {
    akane.equipment = { WEAPON: weapon.uid, ARMOR: armor.uid };
    weapon.equippedBy = akane.uid;
    armor.equippedBy = akane.uid;
  }
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
  owned: starterOwned,
  party: {
    id: 'party_main',
    name: 'メイン編成',
    members: ['own_001', 'own_002', 'own_003', 'own_005', 'own_004'],
  } as Party,
  inventory: starterInventory as InventoryResponse,
  /** ガチャの天井カウンタ(バナーID -> 現在の連続はずれ回数) */
  gachaPity: {} as Record<string, number>,
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
