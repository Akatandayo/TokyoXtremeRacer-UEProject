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
const EQUIPMENT_SLOTS = ['WEAPON', 'ARMOR', 'ACCESSORY'];
const ITEM_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'];
const SPECIAL_TRIGGERS = ['ON_ATTACK', 'ON_HIT_TAKEN', 'ON_BATTLE_START', 'ON_KILL'];
const DROP_KINDS = ['GOLD', 'EQUIPMENT', 'MATERIAL', 'CHARACTER', 'SUMMON_TICKET'];
const REBIRTH_PATHS = ['ATTACK', 'SPEED', 'ENDURANCE', 'SPECIAL'];
const REBIRTH_EFFECT_KINDS = ['STAT_FLAT', 'STAT_PERCENT', 'GROWTH_PERCENT', 'SKILL_POWER', 'GAUGE_START', 'ULT_GAUGE_START'];
const REBIRTH_EFFECT_KINDS_NEEDING_STAT = ['STAT_FLAT', 'STAT_PERCENT', 'GROWTH_PERCENT'];
const COMBO_KINDS = ['PAIR', 'TRIO', 'PARTY', 'TAG'];
const COMBO_TRIGGER_TYPES = ['ON_SKILL_USE', 'ON_BATTLE_START', 'ON_HP_BELOW', 'ON_ALLY_DEFEATED'];
const PORTRAITS_DIR = join(ROOT, 'client', 'public', 'portraits');

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
  if (art.portrait !== undefined) {
    if (typeof art.portrait !== 'string' || art.portrait.length === 0) {
      err(where, `art.portrait は空でない文字列である必要があります: ${JSON.stringify(art.portrait)}`);
    } else {
      const file = join(PORTRAITS_DIR, `${art.portrait}.webp`);
      if (!existsSync(file)) {
        err(where, `art.portrait "${art.portrait}" の立ち絵ファイルが見つかりません: client/public/portraits/${art.portrait}.webp`);
      }
    }
  }
  for (const k of Object.keys(art)) {
    if (!['primary', 'secondary', 'accent', 'sigil', 'pattern', 'portrait'].includes(k)) {
      err(where, `art に未知のキー "${k}" があります`);
    }
  }
}

/** ItemSpecialEffect の検査 */
function checkSpecialEffect(where, sp) {
  if (typeof sp !== 'object' || sp === null) { err(where, 'ItemSpecialEffect がオブジェクトではありません'); return; }
  requireStr(where, sp, 'id');
  requireStr(where, sp, 'name');
  requireStr(where, sp, 'description');
  requireEnum(where, sp, 'trigger', SPECIAL_TRIGGERS);
  if (sp.chance !== undefined && (typeof sp.chance !== 'number' || sp.chance < 0 || sp.chance > 100)) {
    err(where, 'chance は 0〜100 の数値で指定してください');
  }
  if (sp.status !== undefined && !STATUS_TYPES.includes(sp.status)) {
    err(where, `status の値 ${JSON.stringify(sp.status)} は不正です`);
  }
  if (sp.duration !== undefined && typeof sp.duration !== 'number') err(where, 'duration が数値ではありません');
  if (sp.potency !== undefined && typeof sp.potency !== 'number') err(where, 'potency が数値ではありません');
  if (sp.bonusDamage !== undefined && typeof sp.bonusDamage !== 'number') err(where, 'bonusDamage が数値ではありません');
  const allowed = ['id', 'name', 'description', 'trigger', 'chance', 'status', 'duration', 'potency', 'bonusDamage'];
  for (const k of Object.keys(sp)) {
    if (!allowed.includes(k)) err(where, `ItemSpecialEffect に存在しないフィールド "${k}" があります`);
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
 * 4.5. 未実装キャラ (data/system/planned-characters.json)
 * ------------------------------------------------------------------
 * まだ data/characters/ に存在しないが、コンボ定義から参照されるキャラ。
 * コンボの members/actor/performer は「実キャラ or 未実装キャラ」のどちらかで良い。
 * ---------------------------------------------------------------- */
const plannedCharacters = new Map();
{
  const rel = 'data/system/planned-characters.json';
  const p = join(DATA, 'system', 'planned-characters.json');
  if (existsSync(p)) {
    const arr = loadJson(p);
    if (arr !== null) {
      if (!Array.isArray(arr)) {
        err(rel, 'PlannedCharacterDef[] の配列である必要があります');
      } else {
        arr.forEach((c, i) => {
          const where = `${rel}#${i}${c && c.id ? ` (${c.id})` : ''}`;
          if (typeof c !== 'object' || c === null) { err(where, '未実装キャラ定義がオブジェクトではありません'); return; }
          if (!requireStr(where, c, 'id')) return;
          if (characters.has(c.id)) {
            err(where, `id "${c.id}" は実装済みのキャラクターと衝突しています(実装済みなら planned-characters.json から削除してください)`);
          }
          if (plannedCharacters.has(c.id)) { err(where, `未実装キャラIDが重複しています: "${c.id}"`); return; }
          requireStr(where, c, 'name');
          if (c.note !== undefined && typeof c.note !== 'string') err(where, 'note が文字列ではありません');
          const allowed = ['id', 'name', 'note'];
          for (const k of Object.keys(c)) {
            if (!allowed.includes(k)) err(where, `PlannedCharacterDef に存在しないフィールド "${k}" があります`);
          }
          plannedCharacters.set(c.id, c);
        });
      }
    }
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
 * 5.5. 装備 / ハクスラ (data/items/**)
 * ---------------------------------------------------------------- */

// -- 5.5.1 ベースアイテム (data/items/bases/*.json) --
const itemBases = new Map();
for (const path of listJson('items/bases')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'ItemBaseDef[] の配列である必要があります'); continue; }

  arr.forEach((b, i) => {
    const where = `${rel}#${i}${b && b.id ? ` (${b.id})` : ''}`;
    if (typeof b !== 'object' || b === null) { err(where, 'ベースアイテムがオブジェクトではありません'); return; }
    if (!requireStr(where, b, 'id')) return;
    if (itemBases.has(b.id)) { err(where, `ベースアイテムIDが重複しています: "${b.id}"`); return; }
    requireStr(where, b, 'name');
    requireEnum(where, b, 'slot', EQUIPMENT_SLOTS);
    optionalEnum(where, b, 'minRarity', ITEM_RARITIES);
    requireEnum(where, b, 'mainStat', STAT_KEYS);
    requireNum(where, b, 'mainValue');
    if (b.mainPerLevel !== undefined && typeof b.mainPerLevel !== 'number') err(where, 'mainPerLevel が数値ではありません');
    if (b.tags !== undefined && !Array.isArray(b.tags)) err(where, '"tags" が配列ではありません');
    if (b.description !== undefined && typeof b.description !== 'string') err(where, 'description が文字列ではありません');
    const allowed = ['id', 'name', 'slot', 'minRarity', 'mainStat', 'mainValue', 'mainPerLevel', 'tags', 'description'];
    for (const k of Object.keys(b)) {
      if (!allowed.includes(k)) err(where, `ItemBaseDef に存在しないフィールド "${k}" があります`);
    }
    itemBases.set(b.id, b);
  });
}
for (const slot of EQUIPMENT_SLOTS) {
  const count = [...itemBases.values()].filter((b) => b.slot === slot).length;
  if (count < 4) warn('data/items/bases', `スロット "${slot}" のベースアイテムが ${count} 種しかありません(推奨: 4種以上)`);
}

// -- 5.5.2 アフィックス (data/items/affixes/*.json) --
const affixes = new Map();
for (const path of listJson('items/affixes')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'AffixDef[] の配列である必要があります'); continue; }

  arr.forEach((a, i) => {
    const where = `${rel}#${i}${a && a.id ? ` (${a.id})` : ''}`;
    if (typeof a !== 'object' || a === null) { err(where, 'アフィックスがオブジェクトではありません'); return; }
    if (!requireStr(where, a, 'id')) return;
    if (affixes.has(a.id)) { err(where, `アフィックスIDが重複しています: "${a.id}"`); return; }
    requireStr(where, a, 'name');
    requireEnum(where, a, 'kind', ['PREFIX', 'SUFFIX']);
    optionalEnum(where, a, 'minRarity', ITEM_RARITIES);

    if (!Array.isArray(a.stats) || a.stats.length === 0) {
      err(where, '"stats" が空、または配列ではありません');
    } else {
      a.stats.forEach((s, j) => {
        const sw = `${where}.stats[${j}]`;
        if (typeof s !== 'object' || s === null) { err(sw, 'AffixStatRange がオブジェクトではありません'); return; }
        requireEnum(sw, s, 'stat', STAT_KEYS);
        requireNum(sw, s, 'min');
        requireNum(sw, s, 'max');
        if (typeof s.min === 'number' && typeof s.max === 'number' && s.min > s.max) {
          err(sw, `min(${s.min}) が max(${s.max}) を超えています`);
        }
        if (s.percent !== undefined && typeof s.percent !== 'boolean') err(sw, 'percent が真偽値ではありません');
        const allowedS = ['stat', 'min', 'max', 'percent'];
        for (const k of Object.keys(s)) {
          if (!allowedS.includes(k)) err(sw, `AffixStatRange に存在しないフィールド "${k}" があります`);
        }
      });
    }

    if (a.special !== undefined) checkSpecialEffect(`${where}.special`, a.special);

    if (a.slots !== undefined) {
      if (!Array.isArray(a.slots)) {
        err(where, '"slots" が配列ではありません');
      } else {
        a.slots.forEach((s, j) => {
          if (!EQUIPMENT_SLOTS.includes(s)) err(where, `slots[${j}] の値 ${JSON.stringify(s)} は不正です`);
        });
      }
    }

    const allowed = ['id', 'name', 'kind', 'minRarity', 'stats', 'special', 'slots'];
    for (const k of Object.keys(a)) {
      if (!allowed.includes(k)) err(where, `AffixDef に存在しないフィールド "${k}" があります`);
    }
    affixes.set(a.id, a);
  });
}
const prefixCount = [...affixes.values()].filter((a) => a.kind === 'PREFIX').length;
const suffixCount = [...affixes.values()].filter((a) => a.kind === 'SUFFIX').length;
if (prefixCount < 10) warn('data/items/affixes', `PREFIX が ${prefixCount} 種しかありません(推奨: 10種以上)`);
if (suffixCount < 10) warn('data/items/affixes', `SUFFIX が ${suffixCount} 種しかありません(推奨: 10種以上)`);

// -- 5.5.3 素材 (data/items/materials.json) --
const materials = new Map();
for (const path of listJson('items')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'MaterialDef[] の配列である必要があります'); continue; }

  arr.forEach((m, i) => {
    const where = `${rel}#${i}${m && m.id ? ` (${m.id})` : ''}`;
    if (typeof m !== 'object' || m === null) { err(where, '素材がオブジェクトではありません'); return; }
    if (!requireStr(where, m, 'id')) return;
    if (materials.has(m.id)) { err(where, `素材IDが重複しています: "${m.id}"`); return; }
    requireStr(where, m, 'name');
    requireEnum(where, m, 'rarity', ITEM_RARITIES);
    requireStr(where, m, 'description');
    if (m.usage !== undefined && typeof m.usage !== 'string') err(where, 'usage が文字列ではありません');
    if (m.icon !== undefined && typeof m.icon !== 'string') err(where, 'icon が文字列ではありません');
    const allowed = ['id', 'name', 'rarity', 'description', 'usage', 'icon'];
    for (const k of Object.keys(m)) {
      if (!allowed.includes(k)) err(where, `MaterialDef に存在しないフィールド "${k}" があります`);
    }
    materials.set(m.id, m);
  });
}
if (materials.size < 8) warn('data/items/materials.json', `素材が ${materials.size} 種しかありません(推奨: 8種以上)`);

// -- 5.5.4 ドロップテーブル (data/items/droptables/*.json) --
const dropTables = new Map();
for (const path of listJson('items/droptables')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'DropTableDef[] の配列である必要があります'); continue; }

  arr.forEach((t, i) => {
    const where = `${rel}#${i}${t && t.id ? ` (${t.id})` : ''}`;
    if (typeof t !== 'object' || t === null) { err(where, 'ドロップテーブルがオブジェクトではありません'); return; }
    if (!requireStr(where, t, 'id')) return;
    if (dropTables.has(t.id)) { err(where, `ドロップテーブルIDが重複しています: "${t.id}"`); return; }
    requireNum(where, t, 'rolls');
    if (t.nothingWeight !== undefined && (typeof t.nothingWeight !== 'number' || t.nothingWeight < 0)) {
      err(where, 'nothingWeight が0以上の数値ではありません');
    }

    if (!Array.isArray(t.entries) || t.entries.length === 0) {
      err(where, '"entries" が空、または配列ではありません');
    } else {
      t.entries.forEach((e, j) => {
        const ew = `${where}.entries[${j}]`;
        if (typeof e !== 'object' || e === null) { err(ew, 'DropEntry がオブジェクトではありません'); return; }
        if (!requireEnum(ew, e, 'kind', DROP_KINDS)) return;
        if (typeof e.weight !== 'number' || e.weight <= 0) err(ew, 'weight が正の数値ではありません');
        if (e.min !== undefined && typeof e.min !== 'number') err(ew, 'min が数値ではありません');
        if (e.max !== undefined && typeof e.max !== 'number') err(ew, 'max が数値ではありません');
        if (typeof e.min === 'number' && typeof e.max === 'number' && e.min > e.max) {
          err(ew, `min(${e.min}) が max(${e.max}) を超えています`);
        }
        if (e.slot !== undefined) optionalEnum(ew, e, 'slot', EQUIPMENT_SLOTS);
        if (e.rarityWeights !== undefined) {
          if (typeof e.rarityWeights !== 'object' || e.rarityWeights === null) {
            err(ew, 'rarityWeights がオブジェクトではありません');
          } else {
            for (const [rk, rv] of Object.entries(e.rarityWeights)) {
              if (!ITEM_RARITIES.includes(rk)) err(ew, `rarityWeights のキー "${rk}" は不正です`);
              else if (typeof rv !== 'number' || rv < 0) err(ew, `rarityWeights.${rk} が0以上の数値ではありません`);
            }
          }
        }
        if ((e.kind === 'MATERIAL' || e.kind === 'SUMMON_TICKET')) {
          if (typeof e.id !== 'string' || e.id.length === 0) {
            err(ew, `kind="${e.kind}" には id (素材ID) が必要です`);
          } else if (!materials.has(e.id)) {
            err(ew, `参照する素材ID "${e.id}" は data/items/materials.json に存在しません`);
          }
        }
        if (e.kind === 'CHARACTER' && e.id !== undefined) {
          if (!characters.has(e.id)) err(ew, `参照するキャラクターID "${e.id}" は存在しません`);
        }
        const allowed = ['kind', 'id', 'weight', 'min', 'max', 'slot', 'rarityWeights'];
        for (const k of Object.keys(e)) {
          if (!allowed.includes(k)) err(ew, `DropEntry に存在しないフィールド "${k}" があります`);
        }
      });
    }

    const allowedT = ['id', 'rolls', 'nothingWeight', 'entries'];
    for (const k of Object.keys(t)) {
      if (!allowedT.includes(k)) err(where, `DropTableDef に存在しないフィールド "${k}" があります`);
    }
    dropTables.set(t.id, t);
  });
}

/* ------------------------------------------------------------------
 * 5.7. レイドボス (data/raid/bosses.json) (設計書§28〜§29)
 * ------------------------------------------------------------------
 * RaidBossDef は enemyId 経由で data/enemies/ のステータス/スキルを流用する
 * だけの薄いラッパーなので、ここでは以下だけを検査する:
 *   - enemyId が実在するか
 *   - totalHp が正の数値か (1回の挑戦では削りきれない想定の共有HPプール)
 *   - gimmicks[].hpBelow が 0〜100 か、降順で並んでいるか(推奨)
 *   - dropTable / attemptDropTable が実在するか
 * ---------------------------------------------------------------- */
const raidBosses = new Map();
for (const path of listJson('raid')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'RaidBossDef[] の配列である必要があります'); continue; }

  arr.forEach((b, i) => {
    const where = `${rel}#${i}${b && b.id ? ` (${b.id})` : ''}`;
    if (typeof b !== 'object' || b === null) { err(where, 'レイドボスがオブジェクトではありません'); return; }
    if (!requireStr(where, b, 'id')) return;
    if (raidBosses.has(b.id)) { err(where, `レイドボスIDが重複しています: "${b.id}"`); return; }
    requireStr(where, b, 'name');
    if (b.title !== undefined && typeof b.title !== 'string') err(where, 'title が文字列ではありません');
    requireStr(where, b, 'description');

    if (requireStr(where, b, 'enemyId') && !enemies.has(b.enemyId)) {
      err(where, `enemyId "${b.enemyId}" は data/enemies/ に存在しません`);
    }

    requireNum(where, b, 'level');
    if (typeof b.totalHp !== 'number' || b.totalHp <= 0) {
      err(where, 'totalHp が正の数値ではありません(1回の挑戦では削りきれない量にすること)');
    }

    if (b.gimmicks !== undefined) {
      if (!Array.isArray(b.gimmicks)) {
        err(where, '"gimmicks" が配列ではありません');
      } else {
        let prevHp = Infinity;
        b.gimmicks.forEach((g, j) => {
          const gw = `${where}.gimmicks[${j}]`;
          if (typeof g !== 'object' || g === null) { err(gw, 'RaidGimmick がオブジェクトではありません'); return; }
          if (typeof g.hpBelow !== 'number' || g.hpBelow < 0 || g.hpBelow > 100) {
            err(gw, 'hpBelow は 0〜100 の数値である必要があります');
          } else {
            if (g.hpBelow > prevHp) {
              warn(gw, `gimmicks は hpBelow の降順を推奨します(前: ${prevHp} / 今: ${g.hpBelow})。実装は降順で評価する前提です`);
            }
            prevHp = g.hpBelow;
          }
          requireStr(gw, g, 'name');
          requireStr(gw, g, 'description');
          if (g.grant !== undefined) {
            if (!Array.isArray(g.grant)) {
              err(gw, '"grant" が配列ではありません');
            } else {
              g.grant.forEach((gr, k) => {
                if (!STATUS_TYPES.includes(gr.status)) err(gw, `grant[${k}].status の値 ${JSON.stringify(gr.status)} は不正です`);
                if (typeof gr.duration !== 'number') err(gw, `grant[${k}].duration が数値ではありません`);
              });
            }
          }
          if (g.statBonus !== undefined) {
            for (const k of Object.keys(g.statBonus)) {
              if (!STAT_KEYS.includes(k)) err(gw, `statBonus に未知のキー "${k}" があります`);
            }
          }
          if (g.unlockSkills !== undefined) {
            if (!Array.isArray(g.unlockSkills)) {
              err(gw, '"unlockSkills" が配列ではありません');
            } else {
              g.unlockSkills.forEach((sid, k) => {
                if (!skills.has(sid)) err(gw, `unlockSkills[${k}] "${sid}" は data/skills/ に存在しません`);
              });
            }
          }
          const allowedG = ['hpBelow', 'name', 'description', 'grant', 'statBonus', 'unlockSkills', 'fx'];
          for (const k of Object.keys(g)) {
            if (!allowedG.includes(k)) err(gw, `RaidGimmick に存在しないフィールド "${k}" があります`);
          }
        });
      }
    }

    if (b.weakElements !== undefined) {
      if (!Array.isArray(b.weakElements)) {
        err(where, '"weakElements" が配列ではありません');
      } else {
        b.weakElements.forEach((el, j) => { if (!ELEMENTS.includes(el)) err(where, `weakElements[${j}] の値 ${JSON.stringify(el)} は不正です`); });
      }
    }
    if (b.immuneStatuses !== undefined) {
      if (!Array.isArray(b.immuneStatuses)) {
        err(where, '"immuneStatuses" が配列ではありません');
      } else {
        b.immuneStatuses.forEach((s, j) => { if (!STATUS_TYPES.includes(s)) err(where, `immuneStatuses[${j}] の値 ${JSON.stringify(s)} は不正です`); });
      }
    }

    if (b.dropTable !== undefined) {
      if (typeof b.dropTable !== 'string') err(where, 'dropTable が文字列ではありません');
      else if (!dropTables.has(b.dropTable)) err(where, `dropTable "${b.dropTable}" は data/items/droptables/ に存在しません`);
    }
    if (b.attemptDropTable !== undefined) {
      if (typeof b.attemptDropTable !== 'string') err(where, 'attemptDropTable が文字列ではありません');
      else if (!dropTables.has(b.attemptDropTable)) err(where, `attemptDropTable "${b.attemptDropTable}" は data/items/droptables/ に存在しません`);
    }

    checkArt(where, b.art, false);

    const allowedKeys = ['id', 'name', 'title', 'enemyId', 'level', 'totalHp', 'description',
      'gimmicks', 'weakElements', 'immuneStatuses', 'dropTable', 'attemptDropTable', 'art'];
    for (const k of Object.keys(b)) {
      if (!allowedKeys.includes(k)) err(where, `RaidBossDef に存在しないフィールド "${k}" があります`);
    }
    raidBosses.set(b.id, b);
  });
}

/* ------------------------------------------------------------------
 * 5.6. 転生 (data/system/rebirth.json / data/rebirth/nodes.json)
 * ------------------------------------------------------------------
 * 設計書§19 の「同じキャラでも転生によって異なる方向へ育成できる」を
 * 数値面で保証するため、通常のフィールド検査に加えて以下を必ず検査する:
 *   - requiresPathPoints が同系統の他ノードの総コストを超えていないか
 *     (超えていれば、その系統に全振りしても永久に届かないノードになる)
 *   - pointsPerRebirth × maxRebirth (総獲得ポイント) が、全ノードの総コスト以上
 *     になっていないか (以上だと全ノードを取り切れてしまい、§19の分岐が壊れる)
 * ---------------------------------------------------------------- */

// 素材が実際にドロップテーブルから入手できるか(=永久に転生できない事故を防ぐ)
const obtainableMaterialIds = new Set();
for (const t of dropTables.values()) {
  for (const e of t.entries || []) {
    if (e && e.kind === 'MATERIAL' && typeof e.id === 'string') obtainableMaterialIds.add(e.id);
  }
}

function checkRebirthMaterialCost(where, key, list) {
  if (list === undefined) return;
  if (!Array.isArray(list)) { err(where, `"${key}" が配列ではありません`); return; }
  list.forEach((c, i) => {
    const cw = `${where}.${key}[${i}]`;
    if (typeof c !== 'object' || c === null) { err(cw, 'オブジェクトではありません'); return; }
    if (!requireStr(cw, c, 'materialId')) return;
    if (!materials.has(c.materialId)) {
      err(cw, `materialId "${c.materialId}" は data/items/materials.json に存在しません`);
    } else if (!obtainableMaterialIds.has(c.materialId)) {
      err(cw, `materialId "${c.materialId}" はどのドロップテーブルからも入手できません(このままでは転生が永久に不可能になります)`);
    }
    if (typeof c.count !== 'number' || c.count <= 0) err(cw, 'count が正の数値ではありません');
    const allowed = ['materialId', 'count'];
    for (const k of Object.keys(c)) {
      if (!allowed.includes(k)) err(cw, `存在しないフィールド "${k}" があります`);
    }
  });
}

// -- 5.6.1 転生ノード (data/rebirth/nodes.json) --
const rebirthNodes = new Map();
const pathTotalCost = { ATTACK: 0, SPEED: 0, ENDURANCE: 0, SPECIAL: 0 };
{
  const rel = 'data/rebirth/nodes.json';
  const p = join(DATA, 'rebirth', 'nodes.json');
  if (!existsSync(p)) {
    err(rel, 'ファイルがありません');
  } else {
    const arr = loadJson(p);
    if (arr !== null) {
      if (!Array.isArray(arr)) {
        err(rel, 'RebirthNodeDef[] の配列である必要があります');
      } else {
        arr.forEach((n, i) => {
          const where = `${rel}#${i}${n && n.id ? ` (${n.id})` : ''}`;
          if (typeof n !== 'object' || n === null) { err(where, '転生ノードがオブジェクトではありません'); return; }
          if (!requireStr(where, n, 'id')) return;
          if (rebirthNodes.has(n.id)) { err(where, `転生ノードIDが重複しています: "${n.id}"`); return; }
          requireStr(where, n, 'name');
          requireStr(where, n, 'description');
          const pathOk = requireEnum(where, n, 'path', REBIRTH_PATHS);
          const costOk = requireNum(where, n, 'cost');
          if (costOk && n.cost <= 0) err(where, 'cost は正の数値である必要があります');
          const rankOk = requireNum(where, n, 'maxRank');
          if (rankOk && (n.maxRank <= 0 || !Number.isInteger(n.maxRank))) err(where, 'maxRank は正の整数である必要があります');

          if (!Array.isArray(n.effects) || n.effects.length === 0) {
            err(where, '"effects" が空、または配列ではありません');
          } else {
            n.effects.forEach((e, j) => {
              const ew = `${where}.effects[${j}]`;
              if (typeof e !== 'object' || e === null) { err(ew, 'RebirthEffect がオブジェクトではありません'); return; }
              if (!requireEnum(ew, e, 'kind', REBIRTH_EFFECT_KINDS)) return;
              if (REBIRTH_EFFECT_KINDS_NEEDING_STAT.includes(e.kind)) {
                if (!requireStr(ew, e, 'stat')) { /* already reported */ }
                else if (!STAT_KEYS.includes(e.stat)) err(ew, `stat の値 ${JSON.stringify(e.stat)} は StatKey として不正です`);
              } else if (e.stat !== undefined && !STAT_KEYS.includes(e.stat)) {
                err(ew, `stat の値 ${JSON.stringify(e.stat)} は StatKey として不正です`);
              }
              requireNum(ew, e, 'value');
              const allowed = ['kind', 'stat', 'value'];
              for (const k of Object.keys(e)) {
                if (!allowed.includes(k)) err(ew, `RebirthEffect に存在しないフィールド "${k}" があります`);
              }
            });
          }

          if (n.requiresPathPoints !== undefined && (typeof n.requiresPathPoints !== 'number' || n.requiresPathPoints < 0)) {
            err(where, 'requiresPathPoints が0以上の数値ではありません');
          }
          if (n.requiresRebirth !== undefined && (typeof n.requiresRebirth !== 'number' || n.requiresRebirth < 0)) {
            err(where, 'requiresRebirth が0以上の数値ではありません');
          }

          const allowedKeys = ['id', 'name', 'description', 'path', 'cost', 'maxRank', 'effects', 'requiresPathPoints', 'requiresRebirth'];
          for (const k of Object.keys(n)) {
            if (!allowedKeys.includes(k)) err(where, `RebirthNodeDef に存在しないフィールド "${k}" があります`);
          }

          if (pathOk && costOk && rankOk) {
            pathTotalCost[n.path] += n.cost * n.maxRank;
          }
          rebirthNodes.set(n.id, n);
        });
      }
    }
  }
}

// requiresPathPoints が「同系統の他ノードの総コスト」を超えていないか
// (超えていれば、その系統に全振りしても永久に取れないノードになる)
for (const n of rebirthNodes.values()) {
  if (n.requiresPathPoints === undefined || !REBIRTH_PATHS.includes(n.path)) continue;
  const ownCost = (typeof n.cost === 'number' && typeof n.maxRank === 'number') ? n.cost * n.maxRank : 0;
  const otherNodesTotal = pathTotalCost[n.path] - ownCost;
  if (n.requiresPathPoints > otherNodesTotal) {
    err(`data/rebirth/nodes.json (${n.id})`,
      `requiresPathPoints (${n.requiresPathPoints}) が同系統 "${n.path}" の他ノード総コスト (${otherNodesTotal}) を超えています。このノードは全振りしても永久に取得できません`);
  }
}

const rebirthNodesTotalCost = Object.values(pathTotalCost).reduce((a, b) => a + b, 0);

// -- 5.6.2 転生設定 (data/system/rebirth.json) --
{
  const rel = 'data/system/rebirth.json';
  const p = join(DATA, 'system', 'rebirth.json');
  if (!existsSync(p)) {
    err(rel, 'ファイルがありません');
  } else {
    const cfg = loadJson(p);
    if (cfg && typeof cfg === 'object') {
      const where = rel;
      const levelOk = requireNum(where, cfg, 'requiredLevel');
      requireNum(where, cfg, 'pointsPerRebirth');
      requireNum(where, cfg, 'growthBonusPercent');
      const maxRebirthOk = requireNum(where, cfg, 'maxRebirth');

      // requiredLevel は levelCap 以下であること (levelCap を超えると絶対に転生できない)
      const progPathForRebirth = join(DATA, 'system', 'progression.json');
      if (levelOk && existsSync(progPathForRebirth)) {
        const prog = loadJson(progPathForRebirth);
        if (prog && typeof prog.levelCap === 'number' && cfg.requiredLevel > prog.levelCap) {
          err(where, `requiredLevel (${cfg.requiredLevel}) が levelCap (${prog.levelCap}) を超えています。このままでは誰も転生できません`);
        }
      }

      checkRebirthMaterialCost(where, 'cost', cfg.cost);
      checkRebirthMaterialCost(where, 'resetCost', cfg.resetCost);

      // ポイント総量チェック: 全力で転生を積んでも全ノードは取り切れないこと(§19の分岐の前提)
      if (maxRebirthOk && typeof cfg.pointsPerRebirth === 'number') {
        const totalPoints = cfg.pointsPerRebirth * cfg.maxRebirth;
        if (rebirthNodesTotalCost > 0 && totalPoints >= rebirthNodesTotalCost) {
          err(where,
            `pointsPerRebirth × maxRebirth (${totalPoints}) が全転生ノードの総コスト (${rebirthNodesTotalCost}) 以上です。` +
            'このままでは最大転生時に全ノードを取り切れてしまい、設計書§19のビルド分岐が成立しません');
        }
        for (const [path, total] of Object.entries(pathTotalCost)) {
          if (total > 0 && totalPoints < total) {
            warn(where, `系統 "${path}" を単独で全振りしても総コスト (${total}) に総獲得ポイント (${totalPoints}) が届きません。1系統も完成できない設計です(意図的か確認してください)`);
          }
        }
      }

      const allowedKeys = ['requiredLevel', 'pointsPerRebirth', 'growthBonusPercent', 'maxRebirth', 'cost', 'resetCost'];
      for (const k of Object.keys(cfg)) {
        if (!allowedKeys.includes(k)) err(where, `RebirthConfig に存在しないフィールド "${k}" があります`);
      }
    }
  }
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
      if (st.rewards.dropTable !== undefined) {
        if (typeof st.rewards.dropTable !== 'string') {
          err(sw, 'rewards.dropTable が文字列ではありません');
        } else if (!dropTables.has(st.rewards.dropTable)) {
          err(sw, `rewards.dropTable "${st.rewards.dropTable}" は data/items/droptables/ に存在しません`);
        }
      } else {
        warn(sw, 'rewards.dropTable が未設定です(装備/素材/ガチャチケットがドロップしません)');
      }
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
 * 7.5. ガチャ (data/gacha/*.json)
 * ---------------------------------------------------------------- */
function checkGachaCost(cw, cost) {
  if (typeof cost !== 'object' || cost === null) { err(cw, 'コストがオブジェクトではありません'); return; }
  requireEnum(cw, cost, 'currency', ['GOLD', 'TICKET']);
  requireNum(cw, cost, 'amount');
  if (cost.currency === 'TICKET') {
    if (typeof cost.ticketId !== 'string' || cost.ticketId.length === 0) {
      err(cw, 'currency="TICKET" には ticketId が必要です');
    } else if (!materials.has(cost.ticketId)) {
      err(cw, `ticketId "${cost.ticketId}" は data/items/materials.json に存在しません`);
    }
  }
  const allowed = ['currency', 'amount', 'ticketId'];
  for (const k of Object.keys(cost)) {
    if (!allowed.includes(k)) err(cw, `コストに存在しないフィールド "${k}" があります`);
  }
}

const gachaBanners = new Map();
for (const path of listJson('gacha')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'GachaBannerDef[] の配列である必要があります'); continue; }

  arr.forEach((g, i) => {
    const where = `${rel}#${i}${g && g.id ? ` (${g.id})` : ''}`;
    if (typeof g !== 'object' || g === null) { err(where, 'ガチャバナーがオブジェクトではありません'); return; }
    if (!requireStr(where, g, 'id')) return;
    if (gachaBanners.has(g.id)) { err(where, `バナーIDが重複しています: "${g.id}"`); return; }
    requireStr(where, g, 'name');
    requireStr(where, g, 'description');

    if (typeof g.cost !== 'object' || g.cost === null) {
      err(where, '"cost" が設定されていません');
    } else {
      checkGachaCost(`${where}.cost`, g.cost);
    }
    if (g.cost10 !== undefined) checkGachaCost(`${where}.cost10`, g.cost10);

    if (typeof g.rates !== 'object' || g.rates === null || typeof g.rates.rarity !== 'object' || g.rates.rarity === null) {
      err(where, '"rates.rarity" が設定されていません');
    } else {
      let sum = 0;
      for (const [rk, rv] of Object.entries(g.rates.rarity)) {
        if (!RARITIES.includes(rk)) { err(where, `rates.rarity のキー "${rk}" は不正です`); continue; }
        if (typeof rv !== 'number' || rv < 0) { err(where, `rates.rarity.${rk} が0以上の数値ではありません`); continue; }
        sum += rv;
      }
      if (Math.abs(sum - 100) > 0.001) err(where, `rates.rarity の合計が100ではありません (合計: ${sum})`);
    }

    if (g.pool !== undefined) {
      if (!Array.isArray(g.pool)) {
        err(where, '"pool" が配列ではありません');
      } else {
        g.pool.forEach((id, j) => {
          if (typeof id !== 'string' || !characters.has(id)) err(where, `pool[${j}] のキャラクターID "${id}" は存在しません`);
        });
      }
    }

    if (g.pickup !== undefined) {
      if (!Array.isArray(g.pickup)) {
        err(where, '"pickup" が配列ではありません');
      } else {
        g.pickup.forEach((p, j) => {
          const pw = `${where}.pickup[${j}]`;
          if (typeof p !== 'object' || p === null) { err(pw, 'pickup要素がオブジェクトではありません'); return; }
          if (typeof p.defId !== 'string' || !characters.has(p.defId)) err(pw, `defId "${p.defId}" は存在しないキャラクターです`);
          if (typeof p.rate !== 'number' || p.rate < 0 || p.rate > 100) err(pw, 'rate は 0〜100 の数値で指定してください');
        });
      }
    }

    if (g.pity !== undefined) {
      if (typeof g.pity !== 'object' || g.pity === null) {
        err(where, 'pity がオブジェクトではありません');
      } else {
        requireNum(`${where}.pity`, g.pity, 'count');
        requireEnum(`${where}.pity`, g.pity, 'rarity', RARITIES);
      }
    }

    if (g.guarantee10 !== undefined) optionalEnum(where, g, 'guarantee10', RARITIES);

    if (g.equipment !== undefined) {
      if (typeof g.equipment !== 'object' || g.equipment === null) {
        err(where, 'equipment がオブジェクトではありません');
      } else {
        if (typeof g.equipment.dropTable !== 'string' || !dropTables.has(g.equipment.dropTable)) {
          err(where, `equipment.dropTable "${g.equipment.dropTable}" は data/items/droptables/ に存在しません`);
        }
        requireNum(`${where}.equipment`, g.equipment, 'itemLevel');
      }
    }

    if (g.art !== undefined) {
      if (typeof g.art !== 'object' || g.art === null) {
        err(where, 'art がオブジェクトではありません');
      } else {
        for (const k of ['primary', 'accent']) {
          if (typeof g.art[k] !== 'string' || !HEX.test(g.art[k])) err(where, `art.${k} が #RRGGBB 形式のhexカラーではありません`);
        }
      }
    }

    const allowed = ['id', 'name', 'description', 'cost', 'cost10', 'rates', 'pool', 'pickup', 'pity', 'guarantee10', 'equipment', 'art'];
    for (const k of Object.keys(g)) {
      if (!allowed.includes(k)) err(where, `GachaBannerDef に存在しないフィールド "${k}" があります`);
    }
    gachaBanners.set(g.id, g);
  });
}
if (gachaBanners.size < 3) warn('data/gacha', `ガチャバナーが ${gachaBanners.size} 件しかありません(推奨: 3件以上)`);

/* ------------------------------------------------------------------
 * 7.6. キャラクターコンボ (data/combos/*.json)
 * ------------------------------------------------------------------
 * members / actor / performer は「実キャラ」または「未実装キャラ
 * (data/system/planned-characters.json)」のどちらかであれば良い。
 * ---------------------------------------------------------------- */
const isRealOrPlannedChar = (id) => typeof id === 'string' && (characters.has(id) || plannedCharacters.has(id));

const combos = new Map();
for (const path of listJson('combos')) {
  const rel = relative(ROOT, path);
  const arr = loadJson(path);
  if (arr === null) continue;
  if (!Array.isArray(arr)) { err(rel, 'ComboDef[] の配列である必要があります'); continue; }

  arr.forEach((c, i) => {
    const where = `${rel}#${i}${c && c.id ? ` (${c.id})` : ''}`;
    if (typeof c !== 'object' || c === null) { err(where, 'コンボがオブジェクトではありません'); return; }
    if (!requireStr(where, c, 'id')) return;
    if (combos.has(c.id)) { err(where, `コンボIDが重複しています: "${c.id}"`); return; }
    requireStr(where, c, 'name');
    requireStr(where, c, 'description');
    requireEnum(where, c, 'kind', COMBO_KINDS);

    if (c.members !== undefined) {
      if (!Array.isArray(c.members) || c.members.length === 0) {
        err(where, '"members" が空、または配列ではありません');
      } else {
        c.members.forEach((m, j) => {
          if (!isRealOrPlannedChar(m)) {
            err(where, `members[${j}] "${m}" は実装済み/実装予定(planned-characters.json)のいずれのキャラクターにも存在しません`);
          }
        });
      }
    } else if (c.kind === 'PAIR' || c.kind === 'TRIO') {
      err(where, `kind="${c.kind}" には "members" が必要です`);
    }

    if (c.requireTag !== undefined) {
      if (typeof c.requireTag !== 'object' || c.requireTag === null
        || typeof c.requireTag.tag !== 'string' || typeof c.requireTag.count !== 'number') {
        err(where, 'requireTag は { tag, count } 形式である必要があります');
      }
    }
    if (c.requireAllElement !== undefined) optionalEnum(where, c, 'requireAllElement', ELEMENTS);

    if (typeof c.trigger !== 'object' || c.trigger === null) {
      err(where, '"trigger" が設定されていません');
    } else {
      const tw = `${where}.trigger`;
      requireEnum(tw, c.trigger, 'type', COMBO_TRIGGER_TYPES);
      if (c.trigger.actor !== undefined && !isRealOrPlannedChar(c.trigger.actor)) {
        err(tw, `actor "${c.trigger.actor}" は実装済み/実装予定のいずれのキャラクターにも存在しません`);
      }
      if (c.trigger.type === 'ON_SKILL_USE') {
        if (c.trigger.skill === undefined && c.trigger.skillTag === undefined) {
          err(tw, 'type="ON_SKILL_USE" には skill か skillTag のいずれかが必要です');
        }
        if (c.trigger.skill !== undefined && !skills.has(c.trigger.skill)) {
          err(tw, `skill "${c.trigger.skill}" は data/skills/ に存在しません`);
        }
      }
      if (c.trigger.type === 'ON_HP_BELOW' && typeof c.trigger.hpBelow !== 'number') {
        err(tw, 'type="ON_HP_BELOW" には hpBelow が必要です');
      }
      if (c.trigger.cooldown !== undefined && typeof c.trigger.cooldown !== 'number') err(tw, 'cooldown が数値ではありません');
      if (c.trigger.maxPerBattle !== undefined && typeof c.trigger.maxPerBattle !== 'number') err(tw, 'maxPerBattle が数値ではありません');
      if (c.trigger.maxPerBattle === undefined) {
        warn(tw, 'maxPerBattle が未設定です(無制限に発動します。意図した設計か確認してください)');
      }
    }

    if (!Array.isArray(c.effects) || c.effects.length === 0) {
      err(where, '"effects" が空、または配列ではありません');
    } else {
      c.effects.forEach((e, j) => {
        const ew = `${where}.effects[${j}]`;
        if (typeof e !== 'object' || e === null) { err(ew, 'ComboEffect がオブジェクトではありません'); return; }
        if (e.performer !== undefined && !isRealOrPlannedChar(e.performer)) {
          err(ew, `performer "${e.performer}" は実装済み/実装予定のいずれのキャラクターにも存在しません`);
        }
        if (e.skill !== undefined && !skills.has(e.skill)) err(ew, `skill "${e.skill}" は data/skills/ に存在しません`);
        if (e.skill === undefined && e.effect === undefined) err(ew, 'skill か effect のいずれかが必要です');
        if (e.effect !== undefined) {
          if (typeof e.effect !== 'object' || e.effect === null || !EFFECT_TYPES.includes(e.effect.type)) {
            err(ew, `effect.type の値 ${JSON.stringify(e.effect && e.effect.type)} は不正です`);
          }
          if (e.effect && e.effect.target !== undefined) checkTarget(ew, e.effect.target, 'effect.target');
        }
      });
    }
    combos.set(c.id, c);
  });
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
console.log(`  未実装キャラ    : ${plannedCharacters.size} 件`);
console.log(`  装備ベース      : ${itemBases.size} 種  (WEAPON:${[...itemBases.values()].filter((b) => b.slot === 'WEAPON').length} ` +
  `/ ARMOR:${[...itemBases.values()].filter((b) => b.slot === 'ARMOR').length} ` +
  `/ ACCESSORY:${[...itemBases.values()].filter((b) => b.slot === 'ACCESSORY').length})`);
console.log(`  アフィックス    : ${affixes.size} 種  (PREFIX:${prefixCount} / SUFFIX:${suffixCount})`);
console.log(`  素材            : ${materials.size} 種`);
console.log(`  ドロップテーブル: ${dropTables.size} 件`);
console.log(`  レイドボス      : ${raidBosses.size} 件`);
console.log(`  ガチャバナー    : ${gachaBanners.size} 件`);
console.log(`  コンボ          : ${combos.size} 件`);
console.log(`  転生ノード      : ${rebirthNodes.size} 件  (` +
  REBIRTH_PATHS.map((p) => `${p}:${[...rebirthNodes.values()].filter((n) => n.path === p).length}`).join(' / ') + ')');
console.log(`  システム設定    : affinity.json, progression.json`);
process.exit(0);
