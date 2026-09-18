/**
 * マスターデータローダ
 * ------------------------------------------------------------
 * リポジトリの `data/` 以下の JSON を起動時に読み込み、メモリにキャッシュする。
 *
 * 設計方針:
 *  - **寛容なパース**: 1ファイル1オブジェクトでも配列でも受け付ける。
 *    `{ "items": [...] }` / `{ "characters": [...] }` のようなラッパも受ける。
 *  - **落ちない**: ファイルが無い / 空 / JSON壊れ / ID重複 / 参照切れ は
 *    すべて警告ログにとどめ、サーバ起動を妨げない。
 *    (データ担当が並行作業中で data/ が未完成でも API が 500 を返さないため)
 *  - 参照整合性チェック(スキル/AI/敵の存在確認)は起動時に一度だけ行い、
 *    結果を `warnings` に蓄積する。/api/health から件数を確認できる。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AffinityTable, AffixDef, AiProfile, ChapterDef, CharacterDef, ComboDef, DropTableDef,
  EnemyDef, GachaBannerDef, ItemBaseDef, MaterialDef, PlannedCharacterDef,
  ProgressionConfig, Skill, StageDef,
} from '@akatan/shared';
import { EQUIPMENT_SLOTS, ITEM_RARITIES } from '@akatan/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** data/ が見つからない場合に使う既定値(サーバを起動可能に保つため) */
export const DEFAULT_PROGRESSION: ProgressionConfig = {
  levelCap: 60,
  expCurve: { base: 100, exponent: 1.5 },
  battle: {
    gaugeRate: 1,
    gaugeMax: 100,
    ultGainOnAction: 20,
    ultGainOnHit: 10,
    ultMax: 100,
    defenseConstant: 100,
    maxTicks: 2000,
    damageVariance: 0.05,
  },
};

export interface GameData {
  /** 実際に読みに行ったディレクトリ */
  dataDir: string;
  loadedAt: string;
  characters: Map<string, CharacterDef>;
  skills: Map<string, Skill>;
  enemies: Map<string, EnemyDef>;
  aiProfiles: Map<string, AiProfile>;
  chapters: Map<string, ChapterDef>;
  /** stageId -> { stage, chapterId } の平坦インデックス */
  stages: Map<string, { stage: StageDef; chapterId: string }>;
  /** キャラクターコンボ定義 (data/combos/*.json)。空でも戦闘は動く。 */
  combos: Map<string, ComboDef>;
  affinity: AffinityTable;
  progression: ProgressionConfig;
  /* ---- Phase 3/5 (ハクスラ・ガチャ): データが空でも起動できる ---- */
  /** 装備ベース定義 (data/items/bases/*.json) */
  itemBases: Map<string, ItemBaseDef>;
  /** 装備 Prefix/Suffix 定義 (data/items/affixes/*.json) */
  affixes: Map<string, AffixDef>;
  /** 素材定義 (data/items/materials.json)。ガチャチケットもここに含まれる(下記 ticketMaterialIds 参照) */
  materials: Map<string, MaterialDef>;
  /** ドロップテーブル定義 (data/items/droptables/*.json) */
  dropTables: Map<string, DropTableDef>;
  /** ガチャバナー定義 (data/gacha/banners.json) */
  gachaBanners: Map<string, GachaBannerDef>;
  /** 未実装キャラのプレースホルダ定義 (data/system/planned-characters.json) */
  plannedCharacters: Map<string, PlannedCharacterDef>;
  /**
   * 「チケット」として扱う素材ID。
   * MaterialDef 自体には種別フィールドが無いため、`gachaBanners` の
   * `cost(10).ticketId` と `dropTables` の `SUMMON_TICKET` エントリから
   * 実際に参照されている素材IDを収集して判定する(データ駆動、コード変更不要)。
   * `InventoryResponse.materials` / `.tickets` の振り分けに使う。
   */
  ticketMaterialIds: Set<string>;
  /** 起動時に検出した不整合(落とさずここに溜める) */
  warnings: string[];
}

/* ============================================================
 * 低レベルユーティリティ
 * ========================================================== */

function resolveDataDir(): string {
  const fromEnv = process.env.AKATAN_DATA_DIR;
  if (fromEnv) return path.resolve(fromEnv);
  // server/src/data/loader.ts -> リポジトリルート/data
  const candidates = [
    path.resolve(__dirname, '../../../data'),
    path.resolve(process.cwd(), 'data'),
    path.resolve(process.cwd(), '../data'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isDirectory()) return c;
  }
  return candidates[0];
}

function listJsonFiles(dir: string, warnings: string[]): string[] {
  if (!fs.existsSync(dir)) {
    warnings.push(`データディレクトリが存在しません: ${dir}`);
    return [];
  }
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    warnings.push(`ディレクトリを読めません: ${dir} (${String(err)})`);
    return [];
  }
  const files: string[] = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      // サブディレクトリも再帰的に拾う(データ担当がカテゴリ分けしても動くように)
      files.push(...listJsonFiles(full, warnings));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.json')) {
      files.push(full);
    }
  }
  return files.sort();
}

function readJson(file: string, warnings: string[]): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    warnings.push(`読み込み失敗: ${file} (${String(err)})`);
    return undefined;
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    warnings.push(`空ファイル: ${file}`);
    return undefined;
  }
  try {
    // BOM 付き JSON も許容する
    return JSON.parse(trimmed.replace(/^﻿/, ''));
  } catch (err) {
    warnings.push(`JSONパース失敗: ${file} (${String(err)})`);
    return undefined;
  }
}

/**
 * 単一オブジェクト / 配列 / ラッパオブジェクトのいずれでも配列に正規化する。
 * 例) `[a,b]` / `a` / `{ "items":[a,b] }` / `{ "skills":[a,b] }` すべて OK。
 */
function normalizeToArray<T>(value: unknown, wrapperKeys: string[]): T[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of [...wrapperKeys, 'items', 'data', 'list', 'entries']) {
      const inner = obj[key];
      if (Array.isArray(inner)) return inner as T[];
    }
    return [obj as T];
  }
  return [];
}

/** id を持つ要素を Map に詰める。重複は警告を出して後勝ちにしない(先勝ち) */
function indexById<T extends { id?: unknown }>(
  items: T[],
  kind: string,
  file: string,
  target: Map<string, T>,
  warnings: string[],
): void {
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      warnings.push(`${kind}: オブジェクトでない要素を無視しました (${file})`);
      continue;
    }
    const id = (item as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) {
      warnings.push(`${kind}: id が無い要素を無視しました (${file})`);
      continue;
    }
    if (target.has(id)) {
      warnings.push(`${kind}: ID重複 '${id}' (${file}) — 先に読んだ定義を優先します`);
      continue;
    }
    target.set(id, item);
  }
}

function loadFromFiles<T extends { id?: unknown }>(
  files: string[],
  kind: string,
  wrapperKeys: string[],
  warnings: string[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const file of files) {
    const json = readJson(file, warnings);
    if (json === undefined) continue;
    indexById(normalizeToArray<T>(json, wrapperKeys), kind, file, map, warnings);
  }
  return map;
}

function loadCollection<T extends { id?: unknown }>(
  dir: string,
  kind: string,
  wrapperKeys: string[],
  warnings: string[],
): Map<string, T> {
  return loadFromFiles<T>(listJsonFiles(dir, warnings), kind, wrapperKeys, warnings);
}

/**
 * 1ファイル(単体JSON) or ディレクトリ(配下の複数JSON) のどちらでも受け付ける。
 * 「data/items/materials.json」のような単一ファイル運用と、データ担当が後から
 * カテゴリ分けで「data/items/materials/*.json」ディレクトリ運用に変えた場合の
 * 両方を落とさず拾うための寛容ヘルパ(既存方針の踏襲)。
 * 見つからなくても空配列を返すだけで警告は積まない(未作成はよくある状態のため)。
 */
function collectJsonSources(dataDir: string, relFile: string, relDir: string, warnings: string[]): string[] {
  const sources = new Set<string>();
  const filePath = path.join(dataDir, relFile);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    sources.add(filePath);
  }
  const dirPath = path.join(dataDir, relDir);
  if (fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory()) {
    for (const f of listJsonFiles(dirPath, warnings)) sources.add(f);
  }
  return [...sources].sort();
}

/* ============================================================
 * 参照整合性チェック(警告のみ・落とさない)
 * ========================================================== */

function validateReferences(data: GameData): void {
  const w = data.warnings;
  const hasSkill = (id: string) => data.skills.has(id);

  for (const ch of data.characters.values()) {
    if (ch.normalAttack && !hasSkill(ch.normalAttack)) {
      w.push(`character '${ch.id}': normalAttack '${ch.normalAttack}' が skills に見つかりません`);
    }
    if (ch.ultimate && !hasSkill(ch.ultimate)) {
      w.push(`character '${ch.id}': ultimate '${ch.ultimate}' が skills に見つかりません`);
    }
    for (const s of ch.skills ?? []) {
      if (!hasSkill(s)) w.push(`character '${ch.id}': skill '${s}' が見つかりません`);
    }
    for (const s of ch.passives ?? []) {
      if (!hasSkill(s)) w.push(`character '${ch.id}': passive '${s}' が見つかりません`);
    }
    if (ch.defaultAi && !data.aiProfiles.has(ch.defaultAi)) {
      w.push(`character '${ch.id}': defaultAi '${ch.defaultAi}' が見つかりません`);
    }
  }

  for (const en of data.enemies.values()) {
    if (en.normalAttack && !hasSkill(en.normalAttack)) {
      w.push(`enemy '${en.id}': normalAttack '${en.normalAttack}' が見つかりません`);
    }
    if (en.ultimate && !hasSkill(en.ultimate)) {
      w.push(`enemy '${en.id}': ultimate '${en.ultimate}' が見つかりません`);
    }
    for (const s of en.skills ?? []) {
      if (!hasSkill(s)) w.push(`enemy '${en.id}': skill '${s}' が見つかりません`);
    }
    if (en.defaultAi && !data.aiProfiles.has(en.defaultAi)) {
      w.push(`enemy '${en.id}': defaultAi '${en.defaultAi}' が見つかりません`);
    }
  }

  for (const ai of data.aiProfiles.values()) {
    for (const rule of ai.rules ?? []) {
      if (rule.skill && rule.skill !== 'NORMAL' && !hasSkill(rule.skill)) {
        w.push(`aiProfile '${ai.id}': rule skill '${rule.skill}' が見つかりません`);
      }
    }
  }

  for (const chapter of data.chapters.values()) {
    for (const stage of chapter.stages ?? []) {
      for (const p of stage.enemies ?? []) {
        if (!data.enemies.has(p.enemyId)) {
          w.push(`stage '${stage.id}': enemy '${p.enemyId}' が見つかりません`);
        }
      }
      if (stage.unlockAfter && !data.stages.has(stage.unlockAfter)) {
        w.push(`stage '${stage.id}': unlockAfter '${stage.unlockAfter}' が見つかりません(開放条件が永久に満たせません)`);
      }
    }
  }

  // コンボ (P0-2): 参照切れは警告のみ・落とさない。
  for (const combo of data.combos.values()) {
    for (const memberId of combo.members ?? []) {
      if (!data.characters.has(memberId)) {
        w.push(`combo '${combo.id}': member '${memberId}' が characters に見つかりません`);
      }
    }
    if (combo.trigger?.actor && !data.characters.has(combo.trigger.actor)) {
      w.push(`combo '${combo.id}': trigger.actor '${combo.trigger.actor}' が characters に見つかりません`);
    }
    if (combo.trigger?.skill && !hasSkill(combo.trigger.skill)) {
      w.push(`combo '${combo.id}': trigger.skill '${combo.trigger.skill}' が skills に見つかりません`);
    }
    for (const effect of combo.effects ?? []) {
      if (effect.performer && !data.characters.has(effect.performer)) {
        w.push(`combo '${combo.id}': effect.performer '${effect.performer}' が characters に見つかりません`);
      }
      if (effect.skill && !hasSkill(effect.skill)) {
        w.push(`combo '${combo.id}': effect.skill '${effect.skill}' が skills に見つかりません`);
      }
    }
  }

  // Phase 3/5 (ハクスラ・ガチャ): 参照切れは警告のみ・落とさない。
  const rarityIndex = (r: string) => ITEM_RARITIES.indexOf(r as (typeof ITEM_RARITIES)[number]);

  for (const affix of data.affixes.values()) {
    if (affix.minRarity && rarityIndex(affix.minRarity) < 0) {
      w.push(`affix '${affix.id}': minRarity '${affix.minRarity}' が不正な ItemRarity です`);
    }
    for (const slot of affix.slots ?? []) {
      if (!EQUIPMENT_SLOTS.includes(slot)) {
        w.push(`affix '${affix.id}': slots に不正な EquipmentSlot '${slot}' があります`);
      }
    }
  }
  for (const base of data.itemBases.values()) {
    if (!EQUIPMENT_SLOTS.includes(base.slot)) {
      w.push(`itemBase '${base.id}': slot '${base.slot}' が不正な EquipmentSlot です`);
    }
  }
  for (const table of data.dropTables.values()) {
    for (const entry of table.entries ?? []) {
      if (entry.kind === 'MATERIAL' || entry.kind === 'SUMMON_TICKET') {
        if (entry.id && !data.materials.has(entry.id)) {
          w.push(`dropTable '${table.id}': ${entry.kind} '${entry.id}' が materials に見つかりません`);
        }
      } else if (entry.kind === 'CHARACTER') {
        if (entry.id && !data.characters.has(entry.id) && !data.plannedCharacters.has(entry.id)) {
          w.push(`dropTable '${table.id}': CHARACTER '${entry.id}' が characters / plannedCharacters に見つかりません`);
        }
      } else if (entry.kind === 'EQUIPMENT') {
        if (entry.slot && !EQUIPMENT_SLOTS.includes(entry.slot)) {
          w.push(`dropTable '${table.id}': EQUIPMENT エントリの slot '${entry.slot}' が不正です`);
        }
      }
    }
  }
  for (const banner of data.gachaBanners.values()) {
    for (const defId of banner.pool ?? []) {
      if (!data.characters.has(defId)) {
        w.push(`gachaBanner '${banner.id}': pool '${defId}' が characters に見つかりません`);
      }
    }
    for (const pu of banner.pickup ?? []) {
      if (!data.characters.has(pu.defId)) {
        w.push(`gachaBanner '${banner.id}': pickup '${pu.defId}' が characters に見つかりません`);
      }
    }
    if (banner.equipment?.dropTable && !data.dropTables.has(banner.equipment.dropTable)) {
      w.push(`gachaBanner '${banner.id}': equipment.dropTable '${banner.equipment.dropTable}' が dropTables に見つかりません`);
    }
    for (const cost of [banner.cost, banner.cost10]) {
      if (cost?.currency === 'TICKET' && cost.ticketId && !data.materials.has(cost.ticketId)) {
        w.push(`gachaBanner '${banner.id}': cost.ticketId '${cost.ticketId}' が materials に見つかりません`);
      }
    }
  }

  // P1-3 移行期チェック: playerSelectable を誰も持っていない間は全AI許可で運用する。
  // (server/src/routes/characters.ts の PUT /api/characters/:uid/ai が同じ判定を行う)
  if (data.aiProfiles.size > 0) {
    const anyFlagged = [...data.aiProfiles.values()].some((p) => typeof p.playerSelectable === 'boolean');
    if (!anyFlagged) {
      w.push(
        'aiProfiles: playerSelectable を持つプロファイルが1件もありません。' +
        '移行期として全プロファイルをプレイヤー選択可能扱いにしています(データ担当が付与完了したら自動的に敵/ボス用AIが弾かれます)。',
      );
    }
  }
}

/* ============================================================
 * ロード本体
 * ========================================================== */

function buildStageIndex(
  chapters: Map<string, ChapterDef>,
  warnings: string[],
): Map<string, { stage: StageDef; chapterId: string }> {
  const stages = new Map<string, { stage: StageDef; chapterId: string }>();
  for (const chapter of chapters.values()) {
    if (!Array.isArray(chapter.stages)) {
      warnings.push(`chapter '${chapter.id}': stages が配列ではありません`);
      continue;
    }
    for (const stage of chapter.stages) {
      if (!stage || typeof stage.id !== 'string') {
        warnings.push(`chapter '${chapter.id}': id の無いステージを無視しました`);
        continue;
      }
      if (stages.has(stage.id)) {
        warnings.push(`stage: ID重複 '${stage.id}' — 先に読んだ定義を優先します`);
        continue;
      }
      stages.set(stage.id, { stage, chapterId: chapter.id });
    }
  }
  return stages;
}

function loadSystemFile<T>(
  dataDir: string,
  fileName: string,
  fallback: T,
  warnings: string[],
): T {
  const file = path.join(dataDir, 'system', fileName);
  if (!fs.existsSync(file)) {
    warnings.push(`system/${fileName} が無いため既定値を使用します`);
    return fallback;
  }
  const json = readJson(file, warnings);
  if (json === undefined || typeof json !== 'object' || json === null) {
    warnings.push(`system/${fileName} が不正なため既定値を使用します`);
    return fallback;
  }
  return json as T;
}

/** progression.json の欠損キーを既定値で補完する(部分定義を許容) */
function mergeProgression(loaded: Partial<ProgressionConfig>): ProgressionConfig {
  return {
    levelCap: typeof loaded.levelCap === 'number' && loaded.levelCap > 0
      ? loaded.levelCap
      : DEFAULT_PROGRESSION.levelCap,
    expCurve: { ...DEFAULT_PROGRESSION.expCurve, ...(loaded.expCurve ?? {}) },
    battle: { ...DEFAULT_PROGRESSION.battle, ...(loaded.battle ?? {}) },
  };
}

export function loadGameData(): GameData {
  const warnings: string[] = [];
  const dataDir = resolveDataDir();

  const skills = loadCollection<Skill>(path.join(dataDir, 'skills'), 'skill', ['skills'], warnings);
  const characters = loadCollection<CharacterDef>(
    path.join(dataDir, 'characters'), 'character', ['characters'], warnings,
  );
  const enemies = loadCollection<EnemyDef>(path.join(dataDir, 'enemies'), 'enemy', ['enemies'], warnings);
  const aiProfiles = loadCollection<AiProfile>(
    path.join(dataDir, 'ai'), 'aiProfile', ['ai', 'aiProfiles', 'profiles'], warnings,
  );
  const chapters = loadCollection<ChapterDef>(
    path.join(dataDir, 'dungeons'), 'chapter', ['chapters', 'dungeons'], warnings,
  );
  // P0-2: data/combos/*.json (単体 ComboDef / 配列 のいずれも受け付ける)
  const combos = loadCollection<ComboDef>(
    path.join(dataDir, 'combos'), 'combo', ['combos'], warnings,
  );

  const affinity = loadSystemFile<AffinityTable>(dataDir, 'affinity.json', {}, warnings);
  const progression = mergeProgression(
    loadSystemFile<Partial<ProgressionConfig>>(dataDir, 'progression.json', {}, warnings),
  );

  // Phase 3 (ハクスラ): data/items/**
  const itemBases = loadFromFiles<ItemBaseDef>(
    collectJsonSources(dataDir, 'items/bases.json', 'items/bases', warnings),
    'itemBase', ['bases', 'items'], warnings,
  );
  const affixes = loadFromFiles<AffixDef>(
    collectJsonSources(dataDir, 'items/affixes.json', 'items/affixes', warnings),
    'affix', ['affixes', 'items'], warnings,
  );
  const materials = loadFromFiles<MaterialDef>(
    collectJsonSources(dataDir, 'items/materials.json', 'items/materials', warnings),
    'material', ['materials', 'items'], warnings,
  );
  const dropTables = loadFromFiles<DropTableDef>(
    collectJsonSources(dataDir, 'items/droptables.json', 'items/droptables', warnings),
    'dropTable', ['dropTables', 'tables', 'items'], warnings,
  );
  // Phase 5 (ガチャ): data/gacha/banners.json
  const gachaBanners = loadFromFiles<GachaBannerDef>(
    collectJsonSources(dataDir, 'gacha/banners.json', 'gacha', warnings),
    'gachaBanner', ['banners', 'gacha'], warnings,
  );
  const plannedCharacters = loadFromFiles<PlannedCharacterDef>(
    collectJsonSources(dataDir, 'system/planned-characters.json', 'system/planned-characters', warnings),
    'plannedCharacter', ['plannedCharacters', 'characters'], warnings,
  );

  // ticketMaterialIds はデータロード後にバナー/ドロップテーブルの参照から逆引きする
  const ticketMaterialIds = new Set<string>();
  for (const banner of gachaBanners.values()) {
    for (const cost of [banner.cost, banner.cost10]) {
      if (cost?.currency === 'TICKET' && cost.ticketId) ticketMaterialIds.add(cost.ticketId);
    }
  }
  for (const table of dropTables.values()) {
    for (const entry of table.entries ?? []) {
      if (entry.kind === 'SUMMON_TICKET' && entry.id) ticketMaterialIds.add(entry.id);
    }
  }

  const data: GameData = {
    dataDir,
    loadedAt: new Date().toISOString(),
    characters,
    skills,
    enemies,
    aiProfiles,
    chapters,
    stages: buildStageIndex(chapters, warnings),
    combos,
    affinity,
    progression,
    itemBases,
    affixes,
    materials,
    dropTables,
    gachaBanners,
    plannedCharacters,
    ticketMaterialIds,
    warnings,
  };

  validateReferences(data);

  if (characters.size === 0) warnings.push('キャラクターが 0 件です(data/characters/ 未作成?)');
  if (chapters.size === 0) warnings.push('チャプターが 0 件です(data/dungeons/ 未作成?)');
  if (itemBases.size === 0) warnings.push('装備ベースが 0 件です(data/items/bases/ 未作成? ハクスラは無効化されます)');
  if (gachaBanners.size === 0) warnings.push('ガチャバナーが 0 件です(data/gacha/banners.json 未作成? ガチャは無効化されます)');

  return data;
}

/* ============================================================
 * シングルトンキャッシュ
 * ========================================================== */

let cache: GameData | null = null;

/** 起動時に一度呼ぶ。以降は getGameData() でキャッシュを参照する。 */
export function initGameData(): GameData {
  cache = loadGameData();
  return cache;
}

/** ロード済みマスタを取得(未ロードなら遅延ロード) */
export function getGameData(): GameData {
  if (!cache) cache = loadGameData();
  return cache;
}

/** data/ を再読込する(開発用。データ担当の更新を反映させたい時に使う) */
export function reloadGameData(): GameData {
  cache = loadGameData();
  return cache;
}

/** ログ出力用のサマリ */
export function summarizeGameData(data: GameData): Record<string, number | string> {
  return {
    dataDir: data.dataDir,
    characters: data.characters.size,
    skills: data.skills.size,
    enemies: data.enemies.size,
    aiProfiles: data.aiProfiles.size,
    chapters: data.chapters.size,
    stages: data.stages.size,
    combos: data.combos.size,
    itemBases: data.itemBases.size,
    affixes: data.affixes.size,
    materials: data.materials.size,
    dropTables: data.dropTables.size,
    gachaBanners: data.gachaBanners.size,
    plannedCharacters: data.plannedCharacters.size,
    warnings: data.warnings.length,
  };
}
