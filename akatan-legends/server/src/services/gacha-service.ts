/**
 * ガチャ / 召喚(設計書§26〜§27)
 * ------------------------------------------------------------
 * サーバ権威(設計書§37): 抽選は必ずここで行う。クライアントから受け取るのは
 * `bannerId` と `count`(1 or 10)だけで、結果・シード・レアリティは一切信用しない。
 *
 * 抽選順序(1回のガチャあたり):
 *   1. コスト検証(残高不足なら NOT_ENOUGH_CURRENCY を投げ、何も変更せず終了)
 *   2. 天井カウンタを DB から取得
 *   3. 1回ごとに: 天井到達していれば確定レアリティ、そうでなければ rates.rarity で抽選
 *      -> 天井到達済みでない場合、当たったレアリティが pity.rarity 以上ならカウンタを0に戻す。
 *         天井未到達なら +1。
 *   4. レアリティ内で pool(省略時は全キャラ) から pickup 優遇込みで1体選ぶ
 *   5. 重複していれば CharacterDropResult.duplicate = true にして素材へ変換(drop-service と同じ規約)
 *   6. 10連のみ: guarantee10 を満たす排出が1件も無ければ、最後の1件を強制的に guarantee10 以上へ差し替える
 *   7. 装備バナー(banner.equipment)は上記のキャラ抽選をスキップし、装備を `count` 回生成する
 *   8. 支払い・付与・天井カウンタ更新をすべて1トランザクションで確定する
 */
import type {
  CharacterDropResult, DropEntry, GachaBannerDef, GachaExchangeResponse, GachaListResponse,
  GachaPullResponse, GachaPullResult, Rarity,
} from '@akatan/shared';
import { RARITIES } from '@akatan/shared';
import * as repo from '../db/repository.js';
import { createRng, type Rng } from '../battle/rng.js';
import type { GameData } from '../data/loader.js';
import { badRequest, notFound, notEnoughCurrency } from './app-error.js';
import { contextFromGameData, DEFAULT_ITEM_RARITY_WEIGHTS, generateEquipment } from './item-generator.js';
import { duplicateShardMaterialId } from './drop-service.js';
import { grantCharacter, getPlayerProfile, listCharacterViews } from './player-service.js';
import { buildInventoryResponse } from './equipment-service.js';
import { randomSeed } from './rng-util.js';

export const VALID_PULL_COUNTS = [1, 10] as const;

/** dropTable 内の EQUIPMENT エントリ群(スロットごとに分かれている想定)を重み付き抽選する */
function pickWeightedEquipmentEntry(rng: Rng, entries: DropEntry[]): DropEntry | undefined {
  if (entries.length === 0) return undefined;
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (total <= 0) return entries[0];
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= Math.max(0, e.weight);
    if (roll <= 0) return e;
  }
  return entries[entries.length - 1];
}

function rarityIdx(r: Rarity): number {
  return RARITIES.indexOf(r);
}

/* ============================================================
 * GET /api/gacha
 * ========================================================== */

export function getGachaList(playerId: string, data: GameData): GachaListResponse {
  const banners = [...data.gachaBanners.values()];
  const pityCounters = repo.listPityCounters(playerId);
  // マスタに存在するが天井カウンタ行がまだ無いバナーは0として補う
  for (const b of banners) if (!(b.id in pityCounters)) pityCounters[b.id] = 0;
  const inventory = buildInventoryResponse(playerId, data);
  return {
    banners,
    player: getPlayerProfile(playerId),
    pityCounters,
    tickets: inventory.tickets,
    exchanges: [...data.gachaExchanges.values()],
  };
}

/* ============================================================
 * コスト計算 / 検証
 * ========================================================== */

interface ResolvedCost {
  currency: 'GOLD' | 'TICKET';
  amount: number;
  ticketId?: string;
}

function resolveCost(banner: GachaBannerDef, count: number): ResolvedCost {
  if (count === 10 && banner.cost10) return banner.cost10;
  const unit = banner.cost;
  return { currency: unit.currency, amount: unit.amount * count, ticketId: unit.ticketId };
}

function assertAffordable(playerId: string, cost: ResolvedCost): void {
  if (cost.currency === 'GOLD') {
    const gold = getPlayerProfile(playerId).gold;
    if (gold < cost.amount) {
      throw notEnoughCurrency(`ゴールドが不足しています(必要: ${cost.amount} / 所持: ${gold})`, {
        currency: 'GOLD', required: cost.amount, owned: gold,
      });
    }
    return;
  }
  const ticketId = cost.ticketId ?? 'ticket_unknown';
  const owned = repo.getMaterialCount(playerId, ticketId);
  if (owned < cost.amount) {
    throw notEnoughCurrency(`召喚チケットが不足しています(必要: ${cost.amount} / 所持: ${owned})`, {
      currency: 'TICKET', ticketId, required: cost.amount, owned,
    });
  }
}

function pay(playerId: string, cost: ResolvedCost): void {
  if (cost.currency === 'GOLD') {
    repo.addGold(playerId, -cost.amount);
  } else {
    repo.addMaterial(playerId, cost.ticketId ?? 'ticket_unknown', -cost.amount);
  }
}

/* ============================================================
 * キャラクター抽選
 * ========================================================== */

function rollCharacterRarity(rng: Rng, rates: GachaBannerDef['rates']): Rarity {
  const table = rates?.rarity ?? {};
  const entries = RARITIES
    .map((r) => ({ rarity: r, weight: Math.max(0, table[r] ?? 0) }))
    .filter((e) => e.weight > 0);
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (total <= 0) return RARITIES[0];
  let roll = rng.next() * total;
  for (const e of entries) {
    roll -= e.weight;
    if (roll <= 0) return e.rarity;
  }
  return entries[entries.length - 1].rarity;
}

/** レアリティ内で pickup 優遇込みの重み付き抽選を行い、キャラ定義IDを1つ選ぶ */
function pickCharacterDefId(
  rng: Rng,
  data: GameData,
  banner: GachaBannerDef,
  rarity: Rarity,
): string | undefined {
  const poolIds = banner.pool && banner.pool.length > 0
    ? banner.pool
    // pool 未指定のバナーは全キャラが対象になるが、limited(レイド限定など)は除外する。
    // pool に ID を明示したバナーはそちらが優先されるので、限定キャラを意図的に
    // ピックアップしたい場合は pool へ書けばよい。
    : [...data.characters.values()].filter((c) => c.limited !== true).map((c) => c.id);
  const candidates = poolIds
    .map((id) => data.characters.get(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.rarity === rarity)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (candidates.length === 0) return undefined;

  // pickup.rate の解釈: 「このレアリティが当選した後、pickup対象へ落ちる確率(%)」。
  // 実データ例(banner_pickup_momiji_kc): rates.rarity.UR=6% × pickup.rate=70% -> このキャラを
  // 引ける確率は 4.2%/回 になる、典型的なピックアップガチャの設計に合わせている。
  const pickupEntries = (banner.pickup ?? []).filter((p) => candidates.some((c) => c.id === p.defId));
  if (pickupEntries.length > 0) {
    const totalPickupRate = Math.min(100, pickupEntries.reduce((s, p) => s + Math.max(0, p.rate), 0));
    if (totalPickupRate > 0 && rng.chance(totalPickupRate)) {
      // pickup対象群の中で rate の比率に応じて1体選ぶ(pickupが1体だけなら常にそれ)
      let roll = rng.next() * totalPickupRate;
      for (const p of pickupEntries) {
        roll -= Math.max(0, p.rate);
        if (roll <= 0) return p.defId;
      }
      return pickupEntries[pickupEntries.length - 1].defId;
    }
    // 非pickup側: pickup対象を除いた候補から均等抽選(pickup対象しか無いプールならそのまま候補全体から)
    const rest = candidates.filter((c) => !pickupEntries.some((p) => p.defId === c.id));
    return rng.pick(rest.length > 0 ? rest : candidates).id;
  }

  return rng.pick(candidates).id;
}

/** 重複キャラを素材へ変換する(drop-service.duplicateShardMaterialId と同じ規約を共有)。 */
function grantOrConvertCharacter(
  playerId: string,
  data: GameData,
  defId: string,
  materialDeltas: Map<string, number>,
): CharacterDropResult {
  const def = data.characters.get(defId);
  const displayName = def?.name ?? defId;
  const rarity: Rarity = def?.rarity ?? 'N';
  const alreadyOwned = def ? repo.listOwnedCharacters(playerId).some((o) => o.defId === defId) : true;

  if (def && !alreadyOwned) {
    const owned = grantCharacter(playerId, def);
    return { defId, name: displayName, rarity, duplicate: false, uid: owned.uid };
  }
  const shardId = duplicateShardMaterialId(rarity);
  materialDeltas.set(shardId, (materialDeltas.get(shardId) ?? 0) + 1);
  if (!data.materials.has(shardId)) {
    console.warn(`[gacha] 重複キャラ変換用の素材 '${shardId}' が未定義です(データ担当への依頼事項)。カウントだけ加算します: ${defId}`);
  }
  return { defId, name: displayName, rarity, duplicate: true, converted: { id: shardId, count: 1 } };
}

/* ============================================================
 * 1回分の抽選(キャラバナー)
 * ========================================================== */

interface PullContext {
  playerId: string;
  rng: Rng;
  data: GameData;
  banner: GachaBannerDef;
  materialDeltas: Map<string, number>;
  /** このリクエスト内で天井が確定するたびに参照する現在カウンタ(DBへは最後にまとめて書く) */
  pity: { counter: number };
}

function pullCharacterOnce(ctx: PullContext): GachaPullResult {
  const { playerId, rng, data, banner, pity } = ctx;
  let rarity: Rarity;
  let byPity = false;

  if (banner.pity && pity.counter >= banner.pity.count) {
    rarity = banner.pity.rarity;
    byPity = true;
  } else {
    rarity = rollCharacterRarity(rng, banner.rates);
  }

  if (banner.pity) {
    if (rarityIdx(rarity) >= rarityIdx(banner.pity.rarity)) pity.counter = 0;
    else pity.counter += 1;
  }

  const defId = pickCharacterDefId(rng, data, banner, rarity);
  if (!defId) {
    console.warn(`[gacha] banner '${banner.id}': rarity=${rarity} の候補キャラがいません(pool/データ未整備)`);
    return { rarity, byPity };
  }
  const character = grantOrConvertCharacter(playerId, data, defId, ctx.materialDeltas);
  return { character, rarity, byPity };
}

/* ============================================================
 * POST /api/gacha/pull
 * ========================================================== */

export function pullGacha(
  playerId: string,
  data: GameData,
  bannerId: unknown,
  countRaw: unknown,
): GachaPullResponse {
  if (typeof bannerId !== 'string' || bannerId.length === 0) {
    throw badRequest('bannerId は必須の文字列です');
  }
  const banner = data.gachaBanners.get(bannerId);
  if (!banner) throw notFound(`ガチャバナーが見つかりません: ${bannerId}`);

  const count = typeof countRaw === 'number' ? Math.floor(countRaw) : NaN;
  if (!VALID_PULL_COUNTS.includes(count as 1 | 10)) {
    throw badRequest('count は 1 または 10 のみ受け付けます');
  }

  const cost = resolveCost(banner, count);
  // 1. 残高確認(引く前に必ず確認する。支払いと付与は後段のトランザクションでまとめて行う)
  assertAffordable(playerId, cost);

  const rng = createRng(randomSeed());
  const materialDeltas = new Map<string, number>();
  const results: GachaPullResult[] = [];

  if (banner.equipment) {
    // 装備バナー: `banner.rates` / `banner.pity` / `banner.guarantee10` は
    // (`GachaBannerDef.rates.rarity` の値域が Rarity=N〜URで、装備の ItemRarity とは
    // 別の型のため)**意図的に一切参照しない**。実データ `banner_equipment` にも
    // `rates.rarity` が型を満たすためだけに埋まっているが、レアリティ傾向は
    // `equipment.dropTable`(dt_gacha_equipment)側の EQUIPMENT エントリの
    // `rarityWeights` が実際の抽選に使われる。
    // 抽選そのものは、指定ドロップテーブルの EQUIPMENT エントリ群を重み付き抽選して
    // スロット/レアリティ傾向を決め、itemLevel はバナー設定を使う。天井の概念は
    // 現状の型(GachaPity.rarity が Rarity 固定)では表現できないため未実装
    // (下記「統括への型変更要望」参照)。
    const genCtx = contextFromGameData(data);
    const table = data.dropTables.get(banner.equipment.dropTable);
    const equipmentEntries = (table?.entries ?? []).filter((e) => e.kind === 'EQUIPMENT');
    for (let i = 0; i < count; i += 1) {
      const entry = pickWeightedEquipmentEntry(rng, equipmentEntries);
      const item = generateEquipment(genCtx, {
        itemLevel: banner.equipment.itemLevel,
        seed: randomSeed(),
        slot: entry?.slot,
        rarityWeights: entry?.rarityWeights ?? DEFAULT_ITEM_RARITY_WEIGHTS,
      });
      if (item) results.push({ equipment: item, rarity: item.rarity });
      else console.warn(`[gacha] banner '${banner.id}': 装備を生成できませんでした(装備ベース未作成の可能性)`);
    }
  } else {
    const pity = { counter: repo.getPityCounter(playerId, banner.id) };
    for (let i = 0; i < count; i += 1) {
      results.push(pullCharacterOnce({ playerId, rng, data, banner, materialDeltas, pity }));
    }

    // guarantee10: 10連の中に最低保証レアリティ以上が1件も無ければ最後の1件を強制的に差し替える
    if (count === 10 && banner.guarantee10) {
      const minIdx = rarityIdx(banner.guarantee10);
      const satisfied = results.some((r) => r.character && rarityIdx(r.character.rarity) >= minIdx);
      if (!satisfied) {
        const forcedDefId = pickCharacterDefId(rng, data, banner, banner.guarantee10);
        if (forcedDefId) {
          const last = results.length - 1;
          const character = grantOrConvertCharacter(playerId, data, forcedDefId, materialDeltas);
          results[last] = { character, rarity: banner.guarantee10, byPity: false };
        }
      }
    }

    // 天井カウンタは最後にまとめてDBへ書く
    repo.inTransaction(() => {
      pay(playerId, cost);
      for (const [id, delta] of materialDeltas) repo.addMaterial(playerId, id, delta);
      repo.setPityCounter(playerId, banner.id, pity.counter);
    });

    return finishPullResponse(playerId, data, results, banner.id);
  }

  // 装備バナー: 支払い + 装備付与をまとめる
  repo.inTransaction(() => {
    pay(playerId, cost);
    for (const r of results) {
      if (r.equipment) repo.insertEquipment(playerId, r.equipment);
    }
  });

  return finishPullResponse(playerId, data, results, banner.id);
}

/* ============================================================
 * POST /api/gacha/exchange
 * ------------------------------------------------------------
 * チケット交換(設計書§37: サーバ権威)。クライアントは `exchangeId` と
 * 「何回分交換したいか」(`times`)という意図だけを送る。消費/付与枚数は
 * 必ずここで `GachaTicketExchangeDef`(data/gacha-exchange/rates.json)から
 * 再計算して確定させ、所持数不足は pullGacha と同じ NOT_ENOUGH_CURRENCY で拒否する。
 * ========================================================== */

export function exchangeGachaTickets(
  playerId: string,
  data: GameData,
  exchangeIdRaw: unknown,
  timesRaw: unknown,
): GachaExchangeResponse {
  if (typeof exchangeIdRaw !== 'string' || exchangeIdRaw.length === 0) {
    throw badRequest('exchangeId は必須の文字列です');
  }
  const exchange = data.gachaExchanges.get(exchangeIdRaw);
  if (!exchange) throw notFound(`交換レートが見つかりません: ${exchangeIdRaw}`);

  let times = 1;
  if (timesRaw !== undefined) {
    if (typeof timesRaw !== 'number' || !Number.isInteger(timesRaw) || timesRaw < 1) {
      throw badRequest('times は1以上の整数で指定してください');
    }
    times = timesRaw;
  }

  const needed = exchange.fromCount * times;
  const owned = repo.getMaterialCount(playerId, exchange.fromTicketId);
  if (owned < needed) {
    throw notEnoughCurrency(
      `交換に必要なチケットが不足しています(必要: ${needed} / 所持: ${owned})`,
      { currency: 'TICKET', ticketId: exchange.fromTicketId, required: needed, owned },
    );
  }

  const gained = exchange.toCount * times;
  repo.inTransaction(() => {
    repo.addMaterial(playerId, exchange.fromTicketId, -needed);
    repo.addMaterial(playerId, exchange.toTicketId, gained);
  });

  const inventory = buildInventoryResponse(playerId, data);
  return {
    exchangeId: exchange.id,
    times,
    consumed: { id: exchange.fromTicketId, count: needed },
    gained: { id: exchange.toTicketId, count: gained },
    tickets: inventory.tickets,
    player: getPlayerProfile(playerId),
  };
}

function finishPullResponse(
  playerId: string,
  data: GameData,
  results: GachaPullResult[],
  bannerId: string,
): GachaPullResponse {
  return {
    results,
    player: getPlayerProfile(playerId),
    characters: listCharacterViews(playerId, data),
    inventory: buildInventoryResponse(playerId, data),
    pityCounter: repo.getPityCounter(playerId, bannerId),
  };
}
