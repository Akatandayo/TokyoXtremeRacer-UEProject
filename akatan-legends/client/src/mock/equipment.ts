/**
 * デモモード用の装備(ハクスラ)生成器。
 *
 * サーバ本実装の「ベース + Prefix + Suffix + ランダムオプション + 特殊効果」
 * (shared/src/types.ts の EquipmentInstance / ItemBaseDef / AffixDef) を、
 * 演出レビュー用に簡略化して再現する。バランス数値に意味は無い。
 */
import type {
  EquipmentInstance, EquipmentSlot, ItemRarity, ItemSpecialEffect, StatKey, MaterialStack,
  DropResult, CharacterDropResult, StageDef,
} from '@akatan/shared';
import { MOCK_CHARACTER_MAP, MOCK_MATERIALS } from './master';
import { mockState } from './player';

let uidSeq = 1;
function nextUid(prefix: string): string {
  uidSeq += 1;
  return `${prefix}_${Date.now().toString(36)}${uidSeq.toString(36)}`;
}

/* ---------------- ベース装備 ---------------- */
interface MockBase {
  id: string;
  name: string;
  slot: EquipmentSlot;
  mainStat: StatKey;
  mainValue: number;
  percent?: boolean;
}

const BASES: MockBase[] = [
  { id: 'base_katana', name: '古びた刀', slot: 'WEAPON', mainStat: 'attack', mainValue: 34 },
  { id: 'base_rifle', name: '狙撃銃', slot: 'WEAPON', mainStat: 'critical', mainValue: 3.2 },
  { id: 'base_staff', name: '祈祷の杖', slot: 'WEAPON', mainStat: 'healing', mainValue: 14, percent: true },
  { id: 'base_armor', name: '装甲コート', slot: 'ARMOR', mainStat: 'defense', mainValue: 30 },
  { id: 'base_robe', name: '神職の法衣', slot: 'ARMOR', mainStat: 'hp', mainValue: 180 },
  { id: 'base_guard', name: '対衝撃プレート', slot: 'ARMOR', mainStat: 'resistance', mainValue: 8 },
  { id: 'base_amulet', name: '護符', slot: 'ACCESSORY', mainStat: 'resistance', mainValue: 9 },
  { id: 'base_ring', name: '刻印指輪', slot: 'ACCESSORY', mainStat: 'speed', mainValue: 7 },
  { id: 'base_charm', name: 'お守り', slot: 'ACCESSORY', mainStat: 'criticalDamage', mainValue: 12 },
];

interface MockAffix {
  name: string;
  kind: 'PREFIX' | 'SUFFIX';
  stat: StatKey;
  percent?: boolean;
  base: number;
}

const PREFIXES: MockAffix[] = [
  { name: '灼熱の', kind: 'PREFIX', stat: 'attack', base: 16 },
  { name: '堅牢な', kind: 'PREFIX', stat: 'defense', base: 14 },
  { name: '疾風の', kind: 'PREFIX', stat: 'speed', base: 5 },
  { name: '会心の', kind: 'PREFIX', stat: 'critical', base: 3 },
  { name: '再生の', kind: 'PREFIX', stat: 'healing', base: 10, percent: true },
  { name: '虚ろな', kind: 'PREFIX', stat: 'resistance', base: 8 },
];

const SUFFIXES: MockAffix[] = [
  { name: '・守り', kind: 'SUFFIX', stat: 'defense', base: 6, percent: true },
  { name: '・怒り', kind: 'SUFFIX', stat: 'attack', base: 5, percent: true },
  { name: '・迅速', kind: 'SUFFIX', stat: 'speed', base: 4, percent: true },
  { name: '・祝福', kind: 'SUFFIX', stat: 'hp', base: 6, percent: true },
  { name: '・破滅', kind: 'SUFFIX', stat: 'criticalDamage', base: 18 },
  { name: '・記憶', kind: 'SUFFIX', stat: 'resistance', base: 5, percent: true },
];

const SPECIALS: ItemSpecialEffect[] = [
  { id: 'sp_burn', name: '灼熱付与', description: '攻撃時30%で火傷(2ターン)を付与する。', trigger: 'ON_ATTACK', chance: 30, status: 'BURN', duration: 2, potency: 6 },
  { id: 'sp_counter_shield', name: '反射障壁', description: '被弾時20%で自身にシールド(1ターン)を張る。', trigger: 'ON_HIT_TAKEN', chance: 20, status: 'SHIELD', duration: 1, potency: 15 },
  { id: 'sp_execute', name: '止めの一撃', description: '敵を撃破した時、必殺ゲージが大きく増える。', trigger: 'ON_KILL' },
  { id: 'sp_alpha_strike', name: '先制の刃', description: '戦闘開始時、自身の行動ゲージが40%進む。', trigger: 'ON_BATTLE_START' },
  { id: 'sp_bonus_dmg', name: '追加斬撃', description: '攻撃時、追加で攻撃力30%分のダメージを与える。', trigger: 'ON_ATTACK', bonusDamage: 0.3 },
];

const RARITY_ORDER_LIST: ItemRarity[] = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];

/**
 * 売却額(モック専用の簡易テーブル)。`sellEquipment` / `sellEquipmentBulk` の
 * 両方から使う(第6ラウンドの一括売却追加時に、単発売却と同じ式へ揃えた)。
 * バランス数値に意味はない(演出レビュー用)。
 */
const MOCK_SELL_MULT: Record<ItemRarity, number> = {
  COMMON: 12, UNCOMMON: 24, RARE: 48, EPIC: 96, LEGENDARY: 220, MYTHIC: 520,
};

export function mockSellPrice(item: EquipmentInstance): number {
  return Math.round((MOCK_SELL_MULT[item.rarity] ?? 12) * (1 + item.itemLevel * 0.06));
}

/** レアリティごとの倍率とアフィックス数 */
function rarityProfile(r: ItemRarity): { mult: number; affixes: number; special: boolean } {
  switch (r) {
    case 'COMMON': return { mult: 1.0, affixes: 0, special: false };
    case 'UNCOMMON': return { mult: 1.25, affixes: 1, special: false };
    case 'RARE': return { mult: 1.55, affixes: 2, special: false };
    case 'EPIC': return { mult: 1.95, affixes: 2, special: true };
    case 'LEGENDARY': return { mult: 2.5, affixes: 2, special: true };
    case 'MYTHIC': return { mult: 3.3, affixes: 2, special: true };
    default: return { mult: 1, affixes: 0, special: false };
  }
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/** 決定論不要(演出レビュー専用)。itemLevel はドロップ元の敵レベル相当。 */
export function generateEquipment(rarity: ItemRarity, itemLevel: number, forceSlot?: EquipmentSlot): EquipmentInstance {
  const pool = forceSlot ? BASES.filter((b) => b.slot === forceSlot) : BASES;
  const base = pick(pool);
  const profile = rarityProfile(rarity);
  const lvFactor = 1 + itemLevel * 0.045;

  const stats: Partial<Record<StatKey, number>> = {};
  const statsPercent: Partial<Record<StatKey, number>> = {};

  const addStat = (stat: StatKey, value: number, percent?: boolean) => {
    const rounded = stat === 'critical' || stat === 'speed' ? Math.round(value * 10) / 10 : Math.round(value);
    if (percent) statsPercent[stat] = Math.round(((statsPercent[stat] ?? 0) + rounded) * 10) / 10;
    else stats[stat] = (stats[stat] ?? 0) + rounded;
  };

  addStat(base.mainStat, base.mainValue * profile.mult * lvFactor, base.percent);

  let prefix: MockAffix | undefined;
  let suffix: MockAffix | undefined;
  if (profile.affixes >= 1) {
    prefix = pick(PREFIXES);
    addStat(prefix.stat, prefix.base * profile.mult * (0.7 + Math.random() * 0.6), prefix.percent);
  }
  if (profile.affixes >= 2) {
    suffix = pick(SUFFIXES);
    addStat(suffix.stat, suffix.base * profile.mult * (0.7 + Math.random() * 0.6), suffix.percent);
  }
  const special = profile.special && Math.random() < 0.7 ? pick(SPECIALS) : undefined;

  const name = `${prefix ? prefix.name : ''}${base.name}${suffix ? suffix.name : ''}`;

  return {
    uid: nextUid('eq'),
    baseId: base.id,
    slot: base.slot,
    rarity,
    name,
    itemLevel,
    prefixId: prefix?.name,
    suffixId: suffix?.name,
    stats,
    statsPercent: Object.keys(statsPercent).length > 0 ? statsPercent : undefined,
    special,
    enhanceLevel: 0,
    obtainedAt: new Date().toISOString(),
  };
}

/** ドロップ抽選: レベル帯とボスかどうかで質を変える(演出レビュー用の簡易テーブル) */
export function rollRarityForDrop(stageLevel: number, boss: boolean): ItemRarity {
  const luck = Math.random() + (boss ? 0.28 : 0) + Math.min(0.22, stageLevel / 400);
  if (luck > 1.62) return 'MYTHIC';
  if (luck > 1.32) return 'LEGENDARY';
  if (luck > 0.98) return 'EPIC';
  if (luck > 0.62) return 'RARE';
  if (luck > 0.28) return 'UNCOMMON';
  return 'COMMON';
}

function stageLevelOf(stage: StageDef): number {
  const levels = stage.enemies.map((e) => e.level);
  return levels.length > 0 ? Math.max(...levels) : 1;
}

/** 戦闘勝利時のドロップ生成(モック専用。サーバの dropTable 抽選とは無関係)。 */
export function rollMockDrops(stage: StageDef, victory: boolean): DropResult | null {
  if (!victory) return null;
  const lvl = stageLevelOf(stage);
  const boss = !!stage.boss;

  const equipment: EquipmentInstance[] = [];
  const equipRolls = boss ? 2 : Math.random() < 0.55 ? 1 : 0;
  for (let i = 0; i < equipRolls; i++) {
    equipment.push(generateEquipment(rollRarityForDrop(lvl, boss), lvl));
  }

  const materials: MaterialStack[] = [];
  const matRolls = 1 + Math.floor(Math.random() * (boss ? 3 : 2));
  for (let i = 0; i < matRolls; i++) {
    const m = pick(MOCK_MATERIALS.filter((x) => x.id !== 'mat_dup_n' && x.id !== 'mat_dup_ssr'));
    const count = 1 + Math.floor(Math.random() * (boss ? 4 : 2));
    const existing = materials.find((x) => x.id === m.id);
    if (existing) existing.count += count;
    else materials.push({ id: m.id, count });
  }

  const tickets: MaterialStack[] = [];
  if (Math.random() < (boss ? 0.4 : 0.08)) {
    tickets.push({ id: 'ticket_standard', count: 1 });
  }

  const characters: CharacterDropResult[] = [];
  if (Math.random() < (boss ? 0.05 : 0.012)) {
    const pool = ['ch_rin', 'ch_zero', 'ch_yuu', 'ch_tetsu'];
    const defId = pick(pool);
    const def = MOCK_CHARACTER_MAP.get(defId);
    if (def) {
      const already = mockState.owned.some((o) => o.defId === defId);
      if (already) {
        const matId = def.rarity === 'SSR' || def.rarity === 'UR' ? 'mat_dup_ssr' : 'mat_dup_n';
        const matDef = MOCK_MATERIALS.find((m) => m.id === matId)!;
        const count = def.rarity === 'SSR' || def.rarity === 'UR' ? 3 : 8;
        characters.push({ defId, name: def.name, rarity: def.rarity, duplicate: true, converted: { id: matId, count } });
        const stack = materials.find((x) => x.id === matId);
        if (stack) stack.count += count;
        else materials.push({ id: matId, count });
        void matDef;
      } else {
        const uid = nextUid('own');
        mockState.owned.push({
          uid, defId, level: 1, exp: 0, rebirth: 0,
          obtainedAt: new Date().toISOString(),
        });
        characters.push({ defId, name: def.name, rarity: def.rarity, duplicate: false, uid });
      }
    }
  }

  const gold = boss ? Math.round(80 + Math.random() * 220) : Math.random() < 0.3 ? Math.round(20 + Math.random() * 60) : 0;

  if (equipment.length === 0 && materials.length === 0 && tickets.length === 0 && characters.length === 0 && gold === 0) {
    return { gold: 0, equipment: [], materials: [], characters: [], tickets: [] };
  }

  for (const eq of equipment) mockState.inventory.equipment.push(eq);
  for (const m of materials) addMaterial(mockState.inventory.materials, m.id, m.count);
  for (const t of tickets) addMaterial(mockState.inventory.tickets, t.id, t.count);

  return { gold, equipment, materials, characters, tickets };
}

export function addMaterial(list: MaterialStack[], id: string, count: number): void {
  const existing = list.find((x) => x.id === id);
  if (existing) existing.count += count;
  else list.push({ id, count });
}

export function removeMaterial(list: MaterialStack[], id: string, count: number): void {
  const existing = list.find((x) => x.id === id);
  if (!existing) return;
  existing.count = Math.max(0, existing.count - count);
}

/** 初期所持装備(デモ用) */
export function buildStarterInventory(): { equipment: EquipmentInstance[]; materials: MaterialStack[]; tickets: MaterialStack[] } {
  const equipment: EquipmentInstance[] = [];
  const rarities: ItemRarity[] = ['UNCOMMON', 'RARE', 'RARE', 'EPIC', 'COMMON', 'LEGENDARY', 'RARE', 'UNCOMMON'];
  for (let i = 0; i < rarities.length; i++) {
    equipment.push(generateEquipment(rarities[i]!, 6 + i * 2));
  }
  const materials: MaterialStack[] = [
    { id: 'mat_scrap', count: 24 }, { id: 'mat_circuit', count: 11 },
    { id: 'mat_ember_core', count: 4 }, { id: 'mat_void_shard', count: 2 },
    // P4-1: 転生の実行(3個要求)と振り直し(1個要求)を両方デモで確認できるだけの数を持たせる
    { id: 'mat_rebirth_echo', count: 6 }, { id: 'mat_rebirth_seal', count: 2 },
  ];
  const tickets: MaterialStack[] = [
    { id: 'ticket_standard', count: 5 }, { id: 'ticket_momiji_kc', count: 1 },
  ];
  return { equipment, materials, tickets };
}

export { RARITY_ORDER_LIST };
