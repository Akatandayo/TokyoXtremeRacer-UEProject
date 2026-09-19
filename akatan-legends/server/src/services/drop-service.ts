/**
 * ドロップ抽選(設計書§24)
 * ------------------------------------------------------------
 * サーバ権威(設計書§37): `StageDef.rewards.dropTable` を必ずサーバ側で引き、
 * 何が出たかをクライアントに一切問い合わせない。**勝利時のみ**呼び出すこと。
 *
 * 処理:
 *   1. DropTableDef.entries + nothingWeight を1つのプールとして `rolls` 回、重み付き抽選する。
 *   2. 当選した DropEntry の kind ごとに GOLD / EQUIPMENT / MATERIAL / SUMMON_TICKET / CHARACTER を処理する。
 *      CHARACTER は `entry.id` が指定されていればそのキャラ、省略時は
 *      「実装済み全キャラからランダムに1体」を抽選する(実データ `dt_ch1_common` 等がこの形)。
 *   3. CHARACTER は未所持なら付与、既所持なら「重複が完全なハズレにならない」方針(設計書§27)
 *      に従って素材へ変換する。変換先の素材IDは実データ `data/items/materials.json` の規約
 *      (`mat_dup_fragment_low` = N〜SR, `mat_dup_fragment_high` = SSR〜UR)に合わせている。
 *      該当素材が無ければ警告して GOLD 変換にフォールバックする(DUPLICATE_FALLBACK_GOLD)。
 *   4. すべてのDB書き込みは1トランザクションにまとめる。
 */
import type {
  CharacterDropResult, DropEntry, DropResult, EquipmentInstance, MaterialStack, Rarity,
} from '@akatan/shared';
import * as repo from '../db/repository.js';
import { createRng, type Rng } from '../battle/rng.js';
import type { GameData } from '../data/loader.js';
import { contextFromGameData, generateEquipment } from './item-generator.js';
import { grantCharacter } from './player-service.js';
import { randomSeed } from './rng-util.js';

/** 重複キャラ変換の素材IDが未定義だった場合の GOLD フォールバック値(レアリティ順) */
const DUPLICATE_FALLBACK_GOLD: Record<Rarity, number> = {
  N: 20,
  R: 50,
  SR: 150,
  SSR: 500,
  UR: 2000,
};

/**
 * 重複キャラを変換する素材ID。
 * 実データ (`data/items/materials.json`) の規約に合わせた2段階変換:
 *   N/R/SR   -> mat_dup_fragment_low  (「探索者の欠片・並」)
 *   SSR/UR   -> mat_dup_fragment_high (「探索者の欠片・特」)
 */
export function duplicateShardMaterialId(rarity: Rarity): string {
  return rarity === 'SSR' || rarity === 'UR' ? 'mat_dup_fragment_high' : 'mat_dup_fragment_low';
}

interface WeightedChoice<T> {
  weight: number;
  value: T | null; // null = 「何も出ない」
}

function weightedPick(rng: Rng, choices: WeightedChoice<DropEntry>[]): DropEntry | null {
  const total = choices.reduce((sum, c) => sum + Math.max(0, c.weight), 0);
  if (total <= 0) return null;
  let roll = rng.next() * total;
  for (const c of choices) {
    roll -= Math.max(0, c.weight);
    if (roll <= 0) return c.value;
  }
  return choices[choices.length - 1]?.value ?? null;
}

/**
 * ドロップテーブルを引いて DropResult を確定し、同一トランザクションで
 * プレイヤーの所持品(ゴールド/装備/素材/キャラ)へ反映する。
 * `dropTableId` がマスタに無い場合は空の DropResult を返す(データ未作成でも戦闘を止めない)。
 */
export function resolveDrops(
  playerId: string,
  data: GameData,
  dropTableId: string | undefined,
  itemLevel: number,
): DropResult {
  const empty: DropResult = { gold: 0, equipment: [], materials: [], characters: [], tickets: [] };
  if (!dropTableId) return empty;
  const table = data.dropTables.get(dropTableId);
  if (!table) {
    console.warn(`[drop] ドロップテーブルが見つかりません: ${dropTableId}(未作成の可能性)`);
    return empty;
  }

  const rng = createRng(randomSeed());
  const rolls = Math.max(0, Math.floor(table.rolls || 0));
  const genCtx = contextFromGameData(data);

  const goldGained: number[] = [];
  const equipmentGained: EquipmentInstance[] = [];
  const materialDeltas = new Map<string, number>();
  const ticketDeltas = new Map<string, number>();
  const characterResults: CharacterDropResult[] = [];

  // guaranteed のエントリは重み抽選の対象から外し、必ず1回処理する。
  // 「レイドを倒したら限定キャラが確定で手に入る」のような、運に左右させたくない
  // 報酬のための仕組み(weight は無視される)。
  const guaranteed = (table.entries ?? []).filter((e) => e.guaranteed === true);
  const weighted = (table.entries ?? []).filter((e) => e.guaranteed !== true);

  const choices: WeightedChoice<DropEntry>[] = [
    { weight: table.nothingWeight ?? 0, value: null },
    ...weighted.map((e) => ({ weight: e.weight, value: e })),
  ];

  // 確定枠 -> 抽選枠 の順に処理する
  const picks: DropEntry[] = [...guaranteed];
  for (let i = 0; i < rolls; i += 1) {
    const entry = weightedPick(rng, choices);
    if (entry) picks.push(entry);
  }

  for (const entry of picks) {
    const count = rollCount(rng, entry);

    switch (entry.kind) {
      case 'GOLD':
        goldGained.push(count);
        break;

      case 'EQUIPMENT': {
        for (let n = 0; n < count; n += 1) {
          const item = generateEquipment(genCtx, {
            itemLevel,
            seed: randomSeed(),
            slot: entry.slot,
            rarityWeights: entry.rarityWeights,
          });
          if (item) equipmentGained.push(item);
          else console.warn(`[drop] EQUIPMENT を生成できませんでした(装備ベース未作成の可能性): table=${table.id}`);
        }
        break;
      }

      case 'MATERIAL': {
        if (!entry.id) break;
        materialDeltas.set(entry.id, (materialDeltas.get(entry.id) ?? 0) + count);
        break;
      }

      case 'SUMMON_TICKET': {
        if (!entry.id) break;
        ticketDeltas.set(entry.id, (ticketDeltas.get(entry.id) ?? 0) + count);
        break;
      }

      case 'CHARACTER': {
        for (let n = 0; n < count; n += 1) {
          const defId = entry.id ?? pickRandomCharacterId(rng, data);
          if (!defId) {
            console.warn(`[drop] CHARACTER: 抽選対象キャラが1体もいません(data/characters/ 未作成?): table=${table.id}`);
            continue;
          }
          characterResults.push(resolveCharacterDrop(playerId, data, defId, materialDeltas, goldGained));
        }
        break;
      }

      default:
        break;
    }
  }

  const gold = goldGained.reduce((a, b) => a + b, 0);
  const materials: MaterialStack[] = [...materialDeltas.entries()].map(([id, cnt]) => ({ id, count: cnt }));
  const tickets: MaterialStack[] = [...ticketDeltas.entries()].map(([id, cnt]) => ({ id, count: cnt }));

  // 反映は1トランザクションにまとめる(途中失敗で所持品が半端に残らないように)
  repo.inTransaction(() => {
    if (gold !== 0) repo.addGold(playerId, gold);
    for (const item of equipmentGained) repo.insertEquipment(playerId, item);
    for (const m of materials) repo.addMaterial(playerId, m.id, m.count);
    for (const t of tickets) repo.addMaterial(playerId, t.id, t.count);
    // characterResults はすでに resolveCharacterDrop 内でキャラ付与/素材変換のDB書き込みを終えている
  });

  return { gold, equipment: equipmentGained, materials, characters: characterResults, tickets };
}

/**
 * entry.id 省略時(「誰か」枠)に実装済み全キャラからランダムに1体選ぶ。
 * 決定論のため id 昇順ソート後に pick。
 *
 * `limited: true` のキャラは除外する。レイド限定・イベント限定のキャラが
 * 通常ダンジョンの「誰か」枠から漏れて出てしまうのを防ぐため
 * (ID を明示指定したエントリはこの関数を通らないので、限定入手経路は従来どおり機能する)。
 */
function pickRandomCharacterId(rng: Rng, data: GameData): string | undefined {
  const ids = [...data.characters.values()]
    .filter((def) => def.limited !== true)
    .map((def) => def.id)
    .sort();
  if (ids.length === 0) return undefined;
  return rng.pick(ids);
}

function rollCount(rng: Rng, entry: DropEntry): number {
  const min = Math.max(0, Math.floor(entry.min ?? 1));
  const max = Math.max(min, Math.floor(entry.max ?? min));
  if (max <= min) return min;
  return rng.int(min, max);
}

/**
 * CHARACTER ドロップを解決する。
 * 未所持なら即座に DB へ付与する(トランザクション外だが、このファイルの呼び出し元が
 * 直後に repo.inTransaction でまとめて呼ぶため実害はない。将来 DB を差し替える際は
 * ここも repo.inTransaction 内に統合すること)。
 * 既所持なら素材へ変換する(素材未定義なら GOLD フォールバックし、goldGained に積む)。
 */
function resolveCharacterDrop(
  playerId: string,
  data: GameData,
  defId: string,
  materialDeltas: Map<string, number>,
  goldGained: number[],
): CharacterDropResult {
  const def = data.characters.get(defId) ?? null;
  const planned = data.plannedCharacters.get(defId);
  const displayName = def?.name ?? planned?.name ?? defId;
  const rarity: Rarity = def?.rarity ?? 'N';

  const alreadyOwned = def ? repo.listOwnedCharacters(playerId).some((o) => o.defId === defId) : true;

  if (def && !alreadyOwned) {
    const owned = grantCharacter(playerId, def);
    return { defId, name: displayName, rarity, duplicate: false, uid: owned.uid };
  }

  // 重複(または未実装キャラの参照/マスタ不明)は素材へ変換する
  const shardId = duplicateShardMaterialId(rarity);
  if (data.materials.has(shardId)) {
    materialDeltas.set(shardId, (materialDeltas.get(shardId) ?? 0) + 1);
    return { defId, name: displayName, rarity, duplicate: true, converted: { id: shardId, count: 1 } };
  }

  console.warn(
    `[drop] 重複キャラ変換用の素材 '${shardId}' が data/items/materials.json に未定義です。GOLDへフォールバックします: ${defId}`,
  );
  const goldValue = DUPLICATE_FALLBACK_GOLD[rarity] ?? 20;
  goldGained.push(goldValue);
  return {
    defId,
    name: displayName,
    rarity,
    duplicate: true,
    converted: { id: 'GOLD', count: goldValue },
  };
}
