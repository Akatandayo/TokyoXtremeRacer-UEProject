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
  AffinityTable, AiProfile, ChapterDef, CharacterDef, EnemyDef,
  ProgressionConfig, Skill, StageDef,
} from '@akatan/shared';

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
  affinity: AffinityTable;
  progression: ProgressionConfig;
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

function loadCollection<T extends { id?: unknown }>(
  dir: string,
  kind: string,
  wrapperKeys: string[],
  warnings: string[],
): Map<string, T> {
  const map = new Map<string, T>();
  for (const file of listJsonFiles(dir, warnings)) {
    const json = readJson(file, warnings);
    if (json === undefined) continue;
    indexById(normalizeToArray<T>(json, wrapperKeys), kind, file, map, warnings);
  }
  return map;
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

  const affinity = loadSystemFile<AffinityTable>(dataDir, 'affinity.json', {}, warnings);
  const progression = mergeProgression(
    loadSystemFile<Partial<ProgressionConfig>>(dataDir, 'progression.json', {}, warnings),
  );

  const data: GameData = {
    dataDir,
    loadedAt: new Date().toISOString(),
    characters,
    skills,
    enemies,
    aiProfiles,
    chapters,
    stages: buildStageIndex(chapters, warnings),
    affinity,
    progression,
    warnings,
  };

  validateReferences(data);

  if (characters.size === 0) warnings.push('キャラクターが 0 件です(data/characters/ 未作成?)');
  if (chapters.size === 0) warnings.push('チャプターが 0 件です(data/dungeons/ 未作成?)');

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
    warnings: data.warnings.length,
  };
}
