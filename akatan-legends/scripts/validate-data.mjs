#!/usr/bin/env node
/**
 * あかたんLegends データバリデータ (依存ゼロ)
 *
 *   node scripts/validate-data.mjs
 *
 * data/ 以下の全JSONを読み込み、shared/src/types.ts の型と整合しているか、
 * 相互参照(スキルID/AIプロファイルID/敵ID)が壊れていないかを検査する。
 * 問題があれば日本語で全件列挙して exit 1、無ければ件数サマリを出して exit 0。
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');

/* ------------------------------------------------------------------
 * 型定義に対応する列挙 (shared/src/types.ts と一致させること)
 * ---------------------------------------------------------------- */
const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'];
const ELEMENTS = ['FIRE', 'WATER', 'EARTH', 'WIND', 'LIGHT', 'DARK', 'VOID'];
const ROLES = ['TANK', 'ATTACKER', 'SUPPORT', 'HEALER', 'CONTROL', 'SPECIALIST'];
const STATUS_TYPES = [
  'POISON', 'BURN', 'FREEZE', 'STUN', 'SILENCE', 'BLEED', 'SLOW', 'DEF_DOWN', 'ATK_DOWN',
  'ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT',
];
const STAT_KEYS = ['hp', 'attack', 'defense', 'speed', 'critical', 'criticalDamage', 'resistance', 'healing'];
const SKILL_KINDS = ['NORMAL', 'ACTIVE', 'ULTIMATE', 'PASSIVE'];
const TARGET_SIDES = ['ENEMY', 'ALLY', 'SELF'];
const TARGET_PATTERNS = ['SINGLE', 'ALL', 'RANDOM', 'LOWEST_HP', 'HIGHEST_ATK', 'FRONT', 'SELF'];
const EFFECT_TYPES = ['DAMAGE', 'HEAL', 'STATUS', 'CLEANSE', 'GAUGE', 'ULT_GAUGE'];
const AI_CONDITIONS = [
  'ALWAYS', 'ALLY_HP_BELOW', 'SELF_HP_BELOW', 'ENEMY_HP_BELOW', 'ENEMY_COUNT_ATLEAST',
  'ENEMY_HAS_BUFF', 'ALLY_HAS_DEBUFF', 'ULT_READY', 'TURN_ATLEAST',
];
const ART_PATTERNS = ['grid', 'wave', 'burst', 'circuit', 'petal', 'void'];
const VISIBILITIES = ['PUBLIC', 'FRIENDS', 'PRIVATE'];

/* ------------------------------------------------------------------
 * エラー収集
 * ---------------------------------------------------------------- */
const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`[${where}] ${msg}`);
const warn = (where, msg) => warnings.push(`[${where}] ${msg}`);

/* ------------------------------------------------------------------
 * 読み込みユーティリティ
 * ---------------------------------------------------------------- */
function listJson(dir) {
  const abs = join(DATA, dir);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [];
  return readdirSync(abs).filter((f) => f.endsWith('.json')).sort().map((f) => join(abs, f));
}

function loadJson(path) {
  const rel = relative(ROOT, path);
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    err(rel, `ファイルを読み込めません: ${e.message}`);
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    err(rel, `JSONとして解析できません: ${e.message}`);
    return null;
  }
}

/* ------------------------------------------------------------------
 * 汎用チェック
 * ---------------------------------------------------------------- */
function requireStr(where, obj, key) {
  if (typeof obj[key] !== 'string' || obj[key].length === 0) {
    err(where, `必須フィールド "${key}" が無い、または文字列ではありません`);
    return false;
  }
  return true;
}

function requireNum(where, obj, key) {
  if (typeof obj[key] !== 'number' || Number.isNaN(obj[key])) {
    err(where, `必須フィールド "${key}" が無い、または数値ではありません`);
    return false;
  }
  return true;
}

function requireEnum(where, obj, key, allowed) {
  if (!allowed.includes(obj[key])) {
    err(where, `"${key}" の値 ${JSON.stringify(obj[key])} は不正です (許可: ${allowed.join(', ')})`);
    return false;
  }
  return true;
}

function optionalEnum(where, obj, key, allowed) {
  if (obj[key] === undefined) return true;
  return requireEnum(where, obj, key, allowed);
}

function requireStats(where, stats) {
  if (typeof stats !== 'object' || stats === null) {
    err(where, '"baseStats" がオブジェクトではありません');
    return;
  }
  for (const k of STAT_KEYS) {
    if (typeof stats[k] !== 'number' || Number.isNaN(stats[k])) {
      err(where, `baseStats.${k} が無い、または数値ではありません`);
    }
  }
  for (const k of Object.keys(stats)) {
    if (!STAT_KEYS.includes(k)) err(where, `baseStats に未知のキー "${k}" があります`);
  }
}

function requireGrowth(where, growth) {
  if (typeof growth !== 'object' || growth === null) {
    err(where, '"growth" がオブジェクトではありません');
    return;
  }
  for (const [k, v] of Object.entries(growth)) {
    if (!STAT_KEYS.includes(k)) err(where, `growth に未知のキー "${k}" があります`);
    else if (typeof v !== 'number' || Number.isNaN(v)) err(where, `growth.${k} が数値ではありません`);
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
function checkArt(where, art, required) {
  if (art === undefined) {
    if (required) err(where, '"art" (CharacterArt) が設定されていません');
    return;
  }
  for (const k of ['primary', 'secondary', 'accent']) {
    if (typeof art[k] !== 'string' || !HEX.test(art[k])) {
      err(where, `art.${k} が #RRGGBB 形式のhexカラーではありません: ${JSON.stringify(art[k])}`);
    }
  }
  if (typeof art.sigil !== 'string' || art.sigil.length === 0 || [...art.sigil].length > 2) {
    err(where, `art.sigil は1〜2文字の記号/漢字にしてください: ${JSON.stringify(art.sigil)}`);
  }
  optionalEnum(where, art, 'pattern', ART_PATTERNS);
  for (const k of Object.keys(art)) {
    if (!['primary', 'secondary', 'accent', 'sigil', 'pattern'].includes(k)) {
      err(where, `art に未知のキー "${k}" があります`);
    }
  }
}

function checkTarget(where, t, label) {
  if (typeof t !== 'object' || t === null) {
    err(where, `${label} が不正です (SkillTarget オブジェクトが必要)`);
    return;
  }
  requireEnum(where, t, 'side', TARGET_SIDES);
  requireEnum(where, t, 'pattern', TARGET_PATTERNS);
  if (t.count !== undefined && (typeof t.count !== 'number' || t.count < 1)) {
    err(where, `${label}.count が正の数値ではありません`);
  }
}

/* ------------------------------------------------------------------
 * 1. スキル
 * ---------------------------------------------------------------- */
const skills = new Map();   // id -> skill
const skillFile = new Map(); // id -> file

for (const path of listJson('skills')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'Skill[] の配列である必要があります'); continue; }

  arr.forEach((s, i) => {
    const where = `${rel}#${i}${s && s.id ? ` (${s.id})` : ''}`;
    if (typeof s !== 'object' || s === null) { err(where, 'スキルがオブジェクトではありません'); return; }
    if (!requireStr(where, s, 'id')) return;
    if (skills.has(s.id)) {
      err(where, `スキルIDが重複しています: "${s.id}" (既出: ${skillFile.get(s.id)})`);
      return;
    }
    requireStr(where, s, 'name');
    requireStr(where, s, 'description');
    requireEnum(where, s, 'kind', SKILL_KINDS);
    requireNum(where, s, 'cooldown');
    if (s.kind === 'NORMAL' && s.cooldown !== 0) err(where, 'NORMAL スキルの cooldown は 0 である必要があります');
    if (s.kind === 'ULTIMATE' && s.ultCost === undefined) err(where, 'ULTIMATE スキルには ultCost が必要です');
    if (typeof s.fx !== 'string' || s.fx.length === 0) err(where, '演出キー "fx" が設定されていません');
    checkTarget(where, s.target, 'target');

    if (!Array.isArray(s.effects) || s.effects.length === 0) {
      err(where, '"effects" が空、または配列ではありません');
    } else {
      s.effects.forEach((e, j) => {
        const ew = `${where}.effects[${j}]`;
        if (!requireEnum(ew, e, 'type', EFFECT_TYPES)) return;
        if (e.type === 'STATUS') {
          if (!STATUS_TYPES.includes(e.status)) err(ew, `status の値 ${JSON.stringify(e.status)} は不正です`);
          if (typeof e.duration !== 'number') err(ew, 'STATUS 効果には duration が必要です');
        }
        if ((e.type === 'DAMAGE' || e.type === 'HEAL') && typeof e.power !== 'number') {
          err(ew, `${e.type} 効果には power が必要です`);
        }
        if ((e.type === 'GAUGE' || e.type === 'ULT_GAUGE') && typeof e.amount !== 'number') {
          err(ew, `${e.type} 効果には amount が必要です`);
        }
        if (e.scaling !== undefined && !STAT_KEYS.includes(e.scaling)) err(ew, `scaling の値 ${JSON.stringify(e.scaling)} は不正です`);
        if (e.element !== undefined && !ELEMENTS.includes(e.element)) err(ew, `element の値 ${JSON.stringify(e.element)} は不正です`);
        if (e.chance !== undefined && (e.chance < 0 || e.chance > 100)) err(ew, 'chance は 0〜100 で指定してください');
        if (e.target !== undefined) checkTarget(ew, e.target, 'target');
      });
    }
    if (s.tags !== undefined && !Array.isArray(s.tags)) err(where, '"tags" が配列ではありません');
    skills.set(s.id, s);
    skillFile.set(s.id, rel);
  });
}

/* ------------------------------------------------------------------
 * 2. AIプロファイル
 * ---------------------------------------------------------------- */
const aiProfiles = new Map();

for (const path of listJson('ai')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'AiProfile[] の配列である必要があります'); continue; }

  arr.forEach((p, i) => {
    const where = `${rel}#${i}${p && p.id ? ` (${p.id})` : ''}`;
    if (typeof p !== 'object' || p === null) { err(where, 'AIプロファイルがオブジェクトではありません'); return; }
    if (!requireStr(where, p, 'id')) return;
    if (aiProfiles.has(p.id)) { err(where, `AIプロファイルIDが重複しています: "${p.id}"`); return; }
    requireStr(where, p, 'name');

    if (!Array.isArray(p.rules) || p.rules.length === 0) {
      err(where, '"rules" が空、または配列ではありません');
      aiProfiles.set(p.id, p);
      return;
    }

    let prev = -Infinity;
    p.rules.forEach((r, j) => {
      const rw = `${where}.rules[${j}]`;
      requireNum(rw, r, 'priority');
      requireStr(rw, r, 'skill');
      if (typeof r.condition !== 'object' || r.condition === null) {
        err(rw, '"condition" がオブジェクトではありません');
      } else {
        requireEnum(rw, r.condition, 'type', AI_CONDITIONS);
        const needsValue = ['ALLY_HP_BELOW', 'SELF_HP_BELOW', 'ENEMY_HP_BELOW', 'ENEMY_COUNT_ATLEAST', 'TURN_ATLEAST'];
        if (needsValue.includes(r.condition.type) && typeof r.condition.value !== 'number') {
          err(rw, `condition.type="${r.condition.type}" には value (閾値) が必要です`);
        }
      }
      if (typeof r.priority === 'number') {
        if (r.priority < prev) err(rw, `rules は priority 昇順で並べてください (前: ${prev} / 今: ${r.priority})`);
        prev = r.priority;
      }
    });

    const last = p.rules[p.rules.length - 1];
    if (!last || !last.condition || last.condition.type !== 'ALWAYS' || last.skill !== 'NORMAL') {
      err(where, "末尾に condition.type='ALWAYS' かつ skill='NORMAL' のフォールバックルールが必要です");
    }
    aiProfiles.set(p.id, p);
  });
}

/* ------------------------------------------------------------------
 * 3. ユニット(キャラ/敵)共通のスキル・AI参照チェック
 * ---------------------------------------------------------------- */
const usedAi = new Set();

function checkUnitSkills(where, unit, kindLabel) {
  /** そのユニットが使えるスキルID集合 */
  const owned = new Set();

  const ref = (id, label, expectKinds) => {
    if (typeof id !== 'string' || id.length === 0) {
      err(where, `${label} が未設定です`);
      return;
    }
    const s = skills.get(id);
    if (!s) {
      err(where, `${label} が参照するスキルID "${id}" は data/skills/ に存在しません`);
      return;
    }
    if (expectKinds && !expectKinds.includes(s.kind)) {
      err(where, `${label} "${id}" の kind は ${s.kind} です (期待: ${expectKinds.join('/')})`);
    }
    owned.add(id);
  };

  ref(unit.normalAttack, 'normalAttack', ['NORMAL']);

  if (!Array.isArray(unit.skills)) {
    err(where, '"skills" が配列ではありません');
  } else {
    const seen = new Set();
    unit.skills.forEach((id, i) => {
      if (seen.has(id)) err(where, `skills[${i}] "${id}" が重複しています`);
      seen.add(id);
      ref(id, `skills[${i}]`, ['ACTIVE', 'PASSIVE']);
    });
  }

  if (unit.ultimate !== undefined) ref(unit.ultimate, 'ultimate', ['ULTIMATE']);
  else if (kindLabel === 'キャラ') err(where, 'キャラクターには ultimate が必須です');

  if (unit.passives !== undefined) {
    if (!Array.isArray(unit.passives)) err(where, '"passives" が配列ではありません');
    else unit.passives.forEach((id, i) => ref(id, `passives[${i}]`, ['PASSIVE']));
  }

  // 覚醒によるスキル置換先も「所持スキル」に含める
  if (unit.awakening && unit.awakening.skillReplace) {
    for (const [from, to] of Object.entries(unit.awakening.skillReplace)) {
      if (!skills.has(from)) err(where, `awakening.skillReplace の置換元 "${from}" が存在しません`);
      else if (!owned.has(from)) err(where, `awakening.skillReplace の置換元 "${from}" をこのユニットは所持していません`);
      if (!skills.has(to)) err(where, `awakening.skillReplace の置換先 "${to}" が存在しません`);
      else owned.add(to);
    }
  }

  // defaultAi
  if (!requireStr(where, unit, 'defaultAi')) return owned;
  const profile = aiProfiles.get(unit.defaultAi);
  if (!profile) {
    err(where, `defaultAi "${unit.defaultAi}" は data/ai/profiles.json に存在しません`);
    return owned;
  }
  usedAi.add(unit.defaultAi);

  if (Array.isArray(profile.rules)) {
    profile.rules.forEach((r, j) => {
      if (r.skill === 'NORMAL') return;
      if (!skills.has(r.skill)) {
        err(where, `AIプロファイル "${profile.id}".rules[${j}] が参照するスキルID "${r.skill}" は存在しません`);
      } else if (!owned.has(r.skill)) {
        err(where, `AIプロファイル "${profile.id}".rules[${j}] のスキル "${r.skill}" を ${kindLabel} "${unit.id}" は所持していません`);
      }
    });
  }
  return owned;
}

function checkAwakening(where, aw) {
  if (aw === undefined) { err(where, '"awakening" が設定されていません (全キャラ必須)'); return; }
  requireStr(where, aw, 'id');
  requireStr(where, aw, 'name');
  requireStr(where, aw, 'description');
  if (typeof aw.condition !== 'object' || aw.condition === null) {
    err(where, 'awakening.condition がオブジェクトではありません');
  } else {
    const keys = ['hpBelow', 'skillUsed', 'allyDefeated', 'enemyDefeated', 'turnAtLeast', 'withAlly'];
    const present = Object.keys(aw.condition);
    if (present.length === 0) err(where, 'awakening.condition が空です');
    for (const k of present) {
      if (!keys.includes(k)) err(where, `awakening.condition に未知のキー "${k}" があります`);
    }
    if (aw.condition.skillUsed !== undefined) {
      const su = aw.condition.skillUsed;
      if (typeof su !== 'object' || su === null || typeof su.skill !== 'string' || typeof su.count !== 'number') {
        err(where, 'awakening.condition.skillUsed は { skill, count } 形式である必要があります');
      } else if (!skills.has(su.skill)) {
        err(where, `awakening.condition.skillUsed.skill "${su.skill}" は存在しません`);
      }
    }
  }
  if (aw.statBonus !== undefined) {
    for (const k of Object.keys(aw.statBonus)) {
      if (!STAT_KEYS.includes(k)) err(where, `awakening.statBonus に未知のキー "${k}" があります`);
    }
  }
  if (aw.grant !== undefined) {
    if (!Array.isArray(aw.grant)) err(where, 'awakening.grant が配列ではありません');
    else aw.grant.forEach((g, i) => {
      if (!STATUS_TYPES.includes(g.status)) err(where, `awakening.grant[${i}].status の値 ${JSON.stringify(g.status)} は不正です`);
      if (typeof g.duration !== 'number') err(where, `awakening.grant[${i}].duration が数値ではありません`);
    });
  }
}

/* ------------------------------------------------------------------
 * 4. キャラクター
 * ---------------------------------------------------------------- */
const characters = new Map();

for (const path of listJson('characters')) {
  const rel = relative(ROOT, path);
  const c = loadJson(path);
  if (c === null) continue;
  if (Array.isArray(c)) { err(rel, 'キャラクターは 1ファイル1体 (CharacterDef オブジェクト) です'); continue; }
  const where = rel;
  if (!requireStr(where, c, 'id')) continue;
  if (characters.has(c.id)) { err(where, `キャラクターIDが重複しています: "${c.id}"`); continue; }

  requireStr(where, c, 'name');
  requireStr(where, c, 'description');
  requireEnum(where, c, 'rarity', RARITIES);
  requireEnum(where, c, 'element', ELEMENTS);

  if (!Array.isArray(c.roles) || c.roles.length === 0) {
    err(where, '"roles" が空、または配列ではありません');
  } else {
    c.roles.forEach((r, i) => { if (!ROLES.includes(r)) err(where, `roles[${i}] の値 ${JSON.stringify(r)} は不正です`); });
  }

  requireStats(where, c.baseStats);
  requireGrowth(where, c.growth);
  checkArt(where, c.art, true);
  checkAwakening(where, c.awakening);
  checkUnitSkills(where, c, 'キャラ');

  if (c.trpg === undefined) {
    err(where, '"trpg" (TrpgMeta) が設定されていません');
  } else {
    optionalEnum(where, c.trpg, 'visibility', VISIBILITIES);
    if (c.trpg.visibility === undefined) warn(where, 'trpg.visibility が未設定です (既定は PRIVATE 想定)');
  }

  const allowedKeys = ['id', 'name', 'title', 'rarity', 'element', 'roles', 'baseStats', 'growth',
    'normalAttack', 'skills', 'ultimate', 'passives', 'awakening', 'combos', 'defaultAi',
    'description', 'tags', 'trpg', 'art'];
  for (const k of Object.keys(c)) {
    if (!allowedKeys.includes(k)) err(where, `CharacterDef に存在しないフィールド "${k}" があります`);
  }

  characters.set(c.id, c);
}

// 覚醒条件 withAlly が実在キャラか
for (const [id, c] of characters) {
  const wa = c.awakening && c.awakening.condition && c.awakening.condition.withAlly;
  if (wa && !characters.has(wa)) {
    err(`data/characters/${id}.json`, `awakening.condition.withAlly "${wa}" というキャラクターは存在しません`);
  }
}

/* ------------------------------------------------------------------
 * 5. 敵
 * ---------------------------------------------------------------- */
const enemies = new Map();

for (const path of listJson('enemies')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'EnemyDef[] の配列である必要があります'); continue; }

  arr.forEach((e, i) => {
    const where = `${rel}#${i}${e && e.id ? ` (${e.id})` : ''}`;
    if (typeof e !== 'object' || e === null) { err(where, '敵がオブジェクトではありません'); return; }
    if (!requireStr(where, e, 'id')) return;
    if (enemies.has(e.id)) { err(where, `敵IDが重複しています: "${e.id}"`); return; }
    if (characters.has(e.id)) err(where, `敵ID "${e.id}" がキャラクターIDと衝突しています`);

    requireStr(where, e, 'name');
    requireEnum(where, e, 'element', ELEMENTS);
    if (!Array.isArray(e.roles) || e.roles.length === 0) {
      err(where, '"roles" が空、または配列ではありません');
    } else {
      e.roles.forEach((r, j) => { if (!ROLES.includes(r)) err(where, `roles[${j}] の値 ${JSON.stringify(r)} は不正です`); });
    }
    requireStats(where, e.baseStats);
    requireGrowth(where, e.growth);
    checkArt(where, e.art, true);
    checkUnitSkills(where, e, '敵');

    if (e.boss === true && !e.ultimate) err(where, 'ボス敵には ultimate (必殺技) が必要です');

    const allowedKeys = ['id', 'name', 'element', 'roles', 'baseStats', 'growth', 'normalAttack',
      'skills', 'ultimate', 'defaultAi', 'boss', 'description', 'art', 'tags'];
    for (const k of Object.keys(e)) {
      if (!allowedKeys.includes(k)) err(where, `EnemyDef に存在しないフィールド "${k}" があります`);
    }
    enemies.set(e.id, e);
  });
}

/* ------------------------------------------------------------------
 * 6. ダンジョン
 * ---------------------------------------------------------------- */
const chapters = new Map();
const stageIds = new Map();
let stageCount = 0;

for (const path of listJson('dungeons')) {
  const rel = relative(ROOT, path);
  const ch = loadJson(path);
  if (ch === null) continue;
  if (Array.isArray(ch)) { err(rel, 'ダンジョンは 1ファイル1章 (ChapterDef オブジェクト) です'); continue; }
  const where = rel;
  if (!requireStr(where, ch, 'id')) continue;
  if (chapters.has(ch.id)) { err(where, `チャプターIDが重複しています: "${ch.id}"`); continue; }
  requireStr(where, ch, 'name');

  if (!Array.isArray(ch.stages) || ch.stages.length === 0) {
    err(where, '"stages" が空、または配列ではありません');
    chapters.set(ch.id, ch);
    continue;
  }

  ch.stages.forEach((st, i) => {
    const sw = `${where}.stages[${i}]${st && st.id ? ` (${st.id})` : ''}`;
    if (!requireStr(sw, st, 'id')) return;
    if (stageIds.has(st.id)) err(sw, `ステージIDが重複しています: "${st.id}" (既出: ${stageIds.get(st.id)})`);
    stageIds.set(st.id, rel);
    stageCount++;
    requireStr(sw, st, 'name');

    if (!Array.isArray(st.enemies) || st.enemies.length === 0) {
      err(sw, '"enemies" が空、または配列ではありません');
    } else {
      st.enemies.forEach((p, j) => {
        if (typeof p !== 'object' || p === null) { err(sw, `enemies[${j}] がオブジェクトではありません`); return; }
        if (typeof p.enemyId !== 'string') { err(sw, `enemies[${j}].enemyId が文字列ではありません`); return; }
        if (!enemies.has(p.enemyId)) err(sw, `enemies[${j}] が参照する敵ID "${p.enemyId}" は data/enemies/ に存在しません`);
        if (typeof p.level !== 'number' || p.level < 1) err(sw, `enemies[${j}].level が1以上の数値ではありません`);
        if (p.position !== undefined && typeof p.position !== 'number') err(sw, `enemies[${j}].position が数値ではありません`);
      });
    }

    if (typeof st.rewards !== 'object' || st.rewards === null) {
      err(sw, '"rewards" が設定されていません');
    } else {
      requireNum(sw, st.rewards, 'exp');
      requireNum(sw, st.rewards, 'gold');
    }

    if (st.boss === true) {
      const hasBoss = Array.isArray(st.enemies) && st.enemies.some((p) => enemies.get(p.enemyId) && enemies.get(p.enemyId).boss);
      if (!hasBoss) err(sw, 'boss:true のステージに boss:true の敵が配置されていません');
    }
  });

  chapters.set(ch.id, ch);
}

/* ------------------------------------------------------------------
 * 7. システム設定
 * ---------------------------------------------------------------- */
const affinityPath = join(DATA, 'system', 'affinity.json');
const progressionPath = join(DATA, 'system', 'progression.json');

if (!existsSync(affinityPath)) err('data/system/affinity.json', 'ファイルがありません');
else {
  const aff = loadJson(affinityPath);
  if (aff && typeof aff === 'object') {
    for (const [atk, row] of Object.entries(aff)) {
      if (!ELEMENTS.includes(atk)) { err('data/system/affinity.json', `攻撃側の属性 "${atk}" は不正です`); continue; }
      if (typeof row !== 'object' || row === null) { err('data/system/affinity.json', `"${atk}" の値がオブジェクトではありません`); continue; }
      for (const [def, mul] of Object.entries(row)) {
        if (!ELEMENTS.includes(def)) err('data/system/affinity.json', `${atk} 行の防御側属性 "${def}" は不正です`);
        else if (typeof mul !== 'number' || mul <= 0) err('data/system/affinity.json', `${atk}->${def} の倍率が正の数値ではありません`);
        else if (mul < 0.5 || mul > 1.6) err('data/system/affinity.json', `${atk}->${def} の倍率 ${mul} が想定範囲(0.5〜1.6)外です。相性だけで勝敗が決まらないよう抑えてください`);
      }
    }
    for (const el of ELEMENTS) {
      if (aff[el] === undefined) warn('data/system/affinity.json', `属性 "${el}" の行がありません (全て等倍として扱われます)`);
    }
  }
}

if (!existsSync(progressionPath)) err('data/system/progression.json', 'ファイルがありません');
else {
  const p = loadJson(progressionPath);
  if (p && typeof p === 'object') {
    const where = 'data/system/progression.json';
    requireNum(where, p, 'levelCap');
    if (typeof p.expCurve !== 'object' || p.expCurve === null) err(where, '"expCurve" がオブジェクトではありません');
    else { requireNum(where, p.expCurve, 'base'); requireNum(where, p.expCurve, 'exponent'); }
    if (typeof p.battle !== 'object' || p.battle === null) err(where, '"battle" がオブジェクトではありません');
    else {
      for (const k of ['gaugeRate', 'gaugeMax', 'ultGainOnAction', 'ultGainOnHit', 'ultMax', 'defenseConstant', 'maxTicks', 'damageVariance']) {
        requireNum(`${where}.battle`, p.battle, k);
      }
    }
  }
}

/* ------------------------------------------------------------------
 * 8. 未使用/横断チェック
 * ---------------------------------------------------------------- */
for (const id of aiProfiles.keys()) {
  if (!usedAi.has(id)) warn('data/ai/profiles.json', `AIプロファイル "${id}" はどのユニットからも参照されていません`);
}

const usedSkills = new Set();
for (const u of [...characters.values(), ...enemies.values()]) {
  usedSkills.add(u.normalAttack);
  (u.skills || []).forEach((s) => usedSkills.add(s));
  if (u.ultimate) usedSkills.add(u.ultimate);
  (u.passives || []).forEach((s) => usedSkills.add(s));
  if (u.awakening && u.awakening.skillReplace) Object.values(u.awakening.skillReplace).forEach((s) => usedSkills.add(s));
}
for (const id of skills.keys()) {
  if (!usedSkills.has(id)) warn('data/skills', `スキル "${id}" はどのユニットからも参照されていません`);
}

/* ------------------------------------------------------------------
 * 出力
 * ---------------------------------------------------------------- */
if (warnings.length > 0) {
  console.log('--- 警告 (' + warnings.length + '件) ---');
  for (const w of warnings) console.log('  ⚠ ' + w);
  console.log('');
}

if (errors.length > 0) {
  console.error('=== データ検証エラー: ' + errors.length + '件 ===');
  for (const e of errors) console.error('  ✗ ' + e);
  console.error('');
  console.error('上記をすべて修正してから再実行してください。');
  process.exit(1);
}

const rarityCount = {};
for (const c of characters.values()) rarityCount[c.rarity] = (rarityCount[c.rarity] || 0) + 1;
const bossCount = [...enemies.values()].filter((e) => e.boss).length;

console.log('=== データ検証 OK ===');
console.log(`  スキル          : ${skills.size} 件`);
console.log(`  キャラクター    : ${characters.size} 体  (` +
  RARITIES.map((r) => `${r}:${rarityCount[r] || 0}`).join(' / ') + ')');
console.log(`  敵              : ${enemies.size} 体  (うちボス ${bossCount} 体)`);
console.log(`  AIプロファイル  : ${aiProfiles.size} 件`);
console.log(`  チャプター      : ${chapters.size} 章 / ステージ ${stageCount} 個`);
console.log(`  システム設定    : affinity.json, progression.json`);
process.exit(0);
