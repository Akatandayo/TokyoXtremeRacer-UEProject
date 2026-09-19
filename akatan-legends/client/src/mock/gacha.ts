/**
 * デモモード用のガチャ(召喚)シミュレータ。
 *
 * 抽選は本来 100% サーバ権威(設計書§37)だが、モックモードはサーバが無いため
 * ここで代役を務める。演出レビュー用であり、排出率の数値自体に意味は無い。
 */
import type {
  GachaBannerDef, GachaExchangeResponse, GachaPullResult, GachaTicketExchangeDef,
  Rarity, ItemRarity, CharacterDropResult,
} from '@akatan/shared';
import { RARITY_ORDER } from '../utils/labels';
import { ApiClientError } from '../api/client';
import { MOCK_CHARACTER_MAP } from './master';
import { mockState } from './player';
import { generateEquipment, addMaterial } from './equipment';

let uidSeq = 1;
function nextOwnedUid(): string {
  uidSeq += 1;
  return `own_g${Date.now().toString(36)}${uidSeq.toString(36)}`;
}

/* ---------------- バナー定義 ----------------
 * 孤月紅葉(幽波紋) (ch_momiji_kc / UR) のピックアップバナーを含む。
 * ユーザー本人の探索者の立ち絵付きガチャ演出を ?mock=1 だけで確認できるようにするため。
 */
const CHAR_POOL_MAIN = [
  'ch_akane', 'ch_shiki', 'ch_inori', 'ch_noa', 'ch_tetsu',
  'ch_rin', 'ch_zero', 'ch_yuu', 'ch_momiji_kc',
];

export const MOCK_BANNERS: GachaBannerDef[] = [
  {
    id: 'gc_standard',
    name: '常設召喚',
    description: '全探索者(装備を除く)が対象の常設バナー。天井は60連でSSR以上を確定させる。',
    cost: { currency: 'GOLD', amount: 150 },
    cost10: { currency: 'GOLD', amount: 1350 },
    rates: { rarity: { N: 40, R: 34.5, SR: 17, SSR: 7, UR: 1.5 } },
    pool: CHAR_POOL_MAIN,
    pity: { count: 60, rarity: 'SSR' },
    guarantee10: 'R',
    art: { primary: '#35e6ff', accent: '#9b6bff' },
  },
  {
    id: 'gc_momiji_kc',
    name: '召喚: 孤月 紅葉(幽波紋)',
    description: 'UR「孤月 紅葉(幽波紋)」のピックアップ召喚。UR排出のうち70%が対象。天井50連でUR確定。',
    cost: { currency: 'GOLD', amount: 300 },
    cost10: { currency: 'GOLD', amount: 2700 },
    rates: { rarity: { N: 35, R: 33.5, SR: 19, SSR: 9.5, UR: 3 } },
    pool: CHAR_POOL_MAIN,
    pickup: [{ defId: 'ch_momiji_kc', rate: 70 }],
    pity: { count: 50, rarity: 'UR' },
    guarantee10: 'SR',
    art: { primary: '#c94fff', accent: '#7dffe6' },
  },
  {
    id: 'gc_equipment',
    name: '装備調達: 標準戦域',
    description: '武器/防具/装飾品をランダムに1個入手する。装備バナーの「N〜UR」は排出の格を示し、実際の装備レアリティ(コモン〜ミシック)は別途このページ内で表示する。',
    cost: { currency: 'GOLD', amount: 120 },
    cost10: { currency: 'GOLD', amount: 1080 },
    rates: { rarity: { N: 28, R: 36, SR: 22, SSR: 11, UR: 3 } },
    equipment: { dropTable: 'eq_table_std', itemLevel: 24 },
    pity: { count: 40, rarity: 'UR' },
    guarantee10: 'SR',
    art: { primary: '#ffc542', accent: '#ff5ad4' },
  },
];

export const MOCK_BANNER_MAP = new Map(MOCK_BANNERS.map((b) => [b.id, b]));

/**
 * デモモード用のチケット交換レート。実データ(data/gacha-exchange/rates.json)と
 * 同じ 3:1 のレートを、デモの起動時所持チケット(`buildStarterInventory` の
 * `ticket_standard` ×5 / `ticket_momiji_kc` ×1)で確認できるようにしている。
 */
export const MOCK_TICKET_EXCHANGES: GachaTicketExchangeDef[] = [
  {
    id: 'mock_exchange_standard_to_momiji',
    fromTicketId: 'ticket_standard',
    toTicketId: 'ticket_momiji_kc',
    fromCount: 3,
    toCount: 1,
    description: '常設召喚チケット3枚を、ピックアップ召喚チケット1枚に交換する(デモ用レート)。',
  },
];
export const MOCK_TICKET_EXCHANGE_MAP = new Map(MOCK_TICKET_EXCHANGES.map((e) => [e.id, e]));

export function exchangeMockTickets(exchangeId: string, times: number): GachaExchangeResponse {
  const exchange = MOCK_TICKET_EXCHANGE_MAP.get(exchangeId);
  if (!exchange) throw new ApiClientError('NOT_FOUND', `交換レートが見つかりません: ${exchangeId}`);
  const n = Number.isInteger(times) && times >= 1 ? times : 1;
  const needed = exchange.fromCount * n;
  const stack = mockState.inventory.tickets.find((t) => t.id === exchange.fromTicketId);
  const owned = stack?.count ?? 0;
  if (owned < needed) {
    throw new ApiClientError(
      'NOT_ENOUGH_CURRENCY',
      `交換に必要なチケットが不足しています(必要: ${needed} / 所持: ${owned})`,
    );
  }
  const gained = exchange.toCount * n;
  addMaterial(mockState.inventory.tickets, exchange.fromTicketId, -needed);
  addMaterial(mockState.inventory.tickets, exchange.toTicketId, gained);
  return {
    exchangeId: exchange.id,
    times: n,
    consumed: { id: exchange.fromTicketId, count: needed },
    gained: { id: exchange.toTicketId, count: gained },
    tickets: mockState.inventory.tickets.map((t) => ({ ...t })),
    player: { ...mockState.player },
  };
}

function rollGradeRarity(banner: GachaBannerDef): Rarity {
  const entries = Object.entries(banner.rates.rarity ?? {}) as [Rarity, number][];
  const total = entries.reduce((s, [, v]) => s + (v ?? 0), 0) || 1;
  let r = Math.random() * total;
  for (const [k, v] of entries) {
    if (r < (v ?? 0)) return k;
    r -= v ?? 0;
  }
  return entries[entries.length - 1]?.[0] ?? 'N';
}

function pickPickup(banner: GachaBannerDef, grade: Rarity): string | null {
  const candidates = (banner.pickup ?? []).filter((p) => MOCK_CHARACTER_MAP.get(p.defId)?.rarity === grade);
  for (const c of candidates) {
    if (Math.random() * 100 < c.rate) return c.defId;
  }
  return null;
}

function mapGradeToItemRarity(grade: Rarity): ItemRarity {
  const roll = Math.random();
  switch (grade) {
    case 'N': return 'COMMON';
    case 'R': return 'UNCOMMON';
    case 'SR': return 'RARE';
    case 'SSR': return roll < 0.28 ? 'LEGENDARY' : 'EPIC';
    case 'UR': return roll < 0.32 ? 'MYTHIC' : 'LEGENDARY';
    default: return 'COMMON';
  }
}

function pullOneCharacter(banner: GachaBannerDef, grade: Rarity, byPity: boolean): GachaPullResult {
  const pool = banner.pool ?? CHAR_POOL_MAIN;
  const ofGrade = pool.filter((id) => MOCK_CHARACTER_MAP.get(id)?.rarity === grade);
  const pickupHit = pickPickup(banner, grade);
  const defId = pickupHit ?? ofGrade[Math.floor(Math.random() * ofGrade.length)] ?? pool[0]!;
  const def = MOCK_CHARACTER_MAP.get(defId);
  if (!def) return { rarity: grade, byPity };

  const already = mockState.owned.some((o) => o.defId === defId);
  let character: CharacterDropResult;
  if (already) {
    const matId = grade === 'SSR' || grade === 'UR' ? 'mat_dup_ssr' : 'mat_dup_n';
    const count = grade === 'UR' ? 5 : grade === 'SSR' ? 3 : grade === 'SR' ? 2 : 1;
    addMaterial(mockState.inventory.materials, matId, count);
    character = { defId, name: def.name, rarity: def.rarity, duplicate: true, converted: { id: matId, count } };
  } else {
    const uid = nextOwnedUid();
    mockState.owned.push({ uid, defId, level: 1, exp: 0, rebirth: 0, obtainedAt: new Date().toISOString() });
    character = { defId, name: def.name, rarity: def.rarity, duplicate: false, uid };
  }
  return { character, rarity: def.rarity, byPity };
}

function pullOneEquipment(banner: GachaBannerDef, grade: Rarity, byPity: boolean): GachaPullResult {
  const itemRarity = mapGradeToItemRarity(grade);
  const eq = generateEquipment(itemRarity, banner.equipment?.itemLevel ?? 20);
  mockState.inventory.equipment.push(eq);
  return { equipment: eq, rarity: itemRarity, byPity };
}

export interface MockGachaPullOutcome {
  results: GachaPullResult[];
  pityCounter: number;
}

export function pullBanner(bannerId: string, count: number): MockGachaPullOutcome {
  const banner = MOCK_BANNER_MAP.get(bannerId);
  if (!banner) throw new ApiClientError('NOT_FOUND', `バナーが見つかりません: ${bannerId}`);
  if (count !== 1 && count !== 10) throw new ApiClientError('BAD_REQUEST', 'count は 1 または 10 を指定してください。');

  const useTen = count === 10 && !!banner.cost10;
  const cost = useTen ? banner.cost10! : banner.cost;
  const totalAmount = useTen ? cost.amount : cost.amount * count;

  if (cost.currency === 'GOLD') {
    if (mockState.player.gold < totalAmount) {
      throw new ApiClientError('NOT_ENOUGH_CURRENCY', `GOLDが足りません(必要 ${totalAmount} / 所持 ${mockState.player.gold})。`);
    }
    mockState.player = { ...mockState.player, gold: mockState.player.gold - totalAmount };
  } else {
    const ticketId = cost.ticketId ?? 'ticket_standard';
    const stack = mockState.inventory.tickets.find((t) => t.id === ticketId);
    if (!stack || stack.count < totalAmount) {
      throw new ApiClientError('NOT_ENOUGH_CURRENCY', `チケットが足りません(必要 ${totalAmount} / 所持 ${stack?.count ?? 0})。`);
    }
    stack.count -= totalAmount;
  }

  const results: GachaPullResult[] = [];
  let metGuarantee = false;

  for (let i = 0; i < count; i++) {
    let forcePity = false;
    if (banner.pity) {
      const cur = (mockState.gachaPity[bannerId] ?? 0) + 1;
      forcePity = cur >= banner.pity.count;
      mockState.gachaPity[bannerId] = forcePity ? 0 : cur;
    }
    let grade: Rarity = forcePity ? banner.pity!.rarity : rollGradeRarity(banner);

    const isLastOfTen = count === 10 && i === count - 1;
    if (isLastOfTen && banner.guarantee10 && !metGuarantee) {
      if (RARITY_ORDER[grade] < RARITY_ORDER[banner.guarantee10]) grade = banner.guarantee10;
    }
    if (banner.pity && RARITY_ORDER[grade] >= RARITY_ORDER[banner.pity.rarity]) {
      mockState.gachaPity[bannerId] = 0;
    }
    if (banner.guarantee10 && RARITY_ORDER[grade] >= RARITY_ORDER[banner.guarantee10]) {
      metGuarantee = true;
    }

    const result = banner.equipment
      ? pullOneEquipment(banner, grade, forcePity)
      : pullOneCharacter(banner, grade, forcePity);
    results.push(result);
  }

  return { results, pityCounter: mockState.gachaPity[bannerId] ?? 0 };
}
