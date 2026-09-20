/**
 * キャラクター作成ツール (CHARACTER FORGE) のビルド。
 * ------------------------------------------------------------
 * `tools/character-forge/index.html` に、実データから抽出したスキーマと
 * 既存データ(既存キャラ/スキル/AI/コンボ/立ち絵)を埋め込んで
 * `dist-standalone/character-forge.html` を出力する。
 *
 * 選択肢を手で書き写さず必ず実ソースから取るのは、ゲーム本体に列挙子が
 * 増えたときにツールだけ古いまま残るのを防ぐため。抽出に失敗したら
 * 黙って続けず、その場でビルドを失敗させる。
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'data');
const OUT_DIR = join(ROOT, 'dist-standalone');

/** shared/src/types.ts から `export const NAME = [...] as const;` を取り出す */
function extractConstArray(src, name) {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`shared/src/types.ts から ${name} を抽出できませんでした`);
  const items = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (items.length === 0) throw new Error(`${name} が空です`);
  return items;
}

/** `export type Name = 'A' | 'B'` / 複数行のユニオン型を取り出す */
function extractUnion(src, name) {
  const re = new RegExp(`export type ${name}\\s*=([\\s\\S]*?);`, 'm');
  const m = re.exec(src);
  if (!m) throw new Error(`shared/src/types.ts から型 ${name} を抽出できませんでした`);
  const items = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
  if (items.length === 0) throw new Error(`型 ${name} から値を抽出できませんでした`);
  return items;
}

function readJsonDir(rel) {
  const dir = join(DATA, rel);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const f of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const parsed = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const rows = Array.isArray(parsed) ? parsed : (parsed.skills ?? parsed.profiles ?? parsed.combos ?? [parsed]);
    for (const r of rows) out.push(r);
  }
  return out;
}

const types = readFileSync(join(ROOT, 'shared', 'src', 'types.ts'), 'utf8');

const schema = {
  rarities: extractConstArray(types, 'RARITIES'),
  elements: extractConstArray(types, 'ELEMENTS'),
  roles: extractConstArray(types, 'ROLES'),
  statusTypes: extractConstArray(types, 'STATUS_TYPES'),
  statKeys: ['hp', 'attack', 'defense', 'speed', 'critical', 'criticalDamage', 'resistance', 'healing'],
  skillKinds: extractUnion(types, 'SkillKind'),
  targetSides: extractUnion(types, 'TargetSide'),
  targetPatterns: extractUnion(types, 'TargetPattern'),
  effectTypes: extractUnion(types, 'SkillEffectType'),
  aiConditions: extractUnion(types, 'AiConditionType'),
  // validate-data.mjs 側にしか無い列挙はそちらから取る
  artPatterns: null,
  visibilities: null,
};

const validator = readFileSync(join(ROOT, 'scripts', 'validate-data.mjs'), 'utf8');
for (const [key, name] of [['artPatterns', 'ART_PATTERNS'], ['visibilities', 'VISIBILITIES']]) {
  const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(validator);
  if (!m) throw new Error(`validate-data.mjs から ${name} を抽出できませんでした`);
  schema[key] = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const characters = [];
for (const f of readdirSync(join(DATA, 'characters')).filter((f) => f.endsWith('.json')).sort()) {
  characters.push(JSON.parse(readFileSync(join(DATA, 'characters', f), 'utf8')));
}
const skills = readJsonDir('skills');
const aiProfiles = readJsonDir('ai');
const combos = readJsonDir('combos');
const banners = readJsonDir('gacha').filter((b) => !b.equipment).map((b) => ({
  id: b.id, name: b.name,
  hasPool: Array.isArray(b.pool),
  currency: b.cost?.currency ?? 'GOLD',
  ticketId: b.cost?.ticketId ?? null,
}));

const portraitsDir = join(ROOT, 'client', 'public', 'portraits');
const portraits = existsSync(portraitsDir)
  ? readdirSync(portraitsDir).filter((f) => f.endsWith('.webp')).map((f) => f.replace(/\.webp$/, '')).sort()
  : [];

const payload = {
  schema,
  characters,
  skills: skills.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
  aiProfiles: aiProfiles.map((a) => ({
    id: a.id, name: a.name, playerSelectable: a.playerSelectable !== false,
    skills: (a.rules ?? []).map((r) => r.skill),
  })),
  combos: combos.map((c) => ({ id: c.id, name: c.name })),
  banners,
  portraits,
  fxKeys: [...new Set(skills.map((s) => s.fx).filter(Boolean))].sort(),
  builtAt: new Date().toISOString().slice(0, 10),
};

let html = readFileSync(join(ROOT, 'tools', 'character-forge', 'index.html'), 'utf8');

// app.js を埋め込んで1ファイルにする(file:// で開けるようにするため)
const appJs = readFileSync(join(ROOT, 'tools', 'character-forge', 'app.js'), 'utf8');
const scriptTag = '<script src="app.js"></script>';
if (!html.includes(scriptTag)) throw new Error('index.html に app.js の読み込みが見つかりません');
// app.js 内に `</script>` の並びがあると、HTMLパーサがそこでスクリプトを
// 閉じてしまう(コメントの中にあっても同じ)。JSとしては `<\/script>` と
// 書いても意味が変わらないので、埋め込むときに機械的に潰す。
// 実際にコメント内の `</script>` でツールが起動しなくなる事故を起こしている。
const safeJs = appJs.replace(/<\/script/gi, '<\\/script');
html = html.replace(scriptTag, () => `<script>\n${safeJs}\n</script>`);
const marker = '/*__FORGE_DATA__*/null';
if (!html.includes(marker)) throw new Error(`index.html に ${marker} が見つかりません`);
// </script> がJSON内にあるとHTMLが壊れるのでエスケープする
const json = JSON.stringify(payload).replace(/<\//g, '<\\/');
html = html.replace(marker, json);

mkdirSync(OUT_DIR, { recursive: true });
const out = join(OUT_DIR, 'character-forge.html');
writeFileSync(out, html, 'utf8');

console.log('CHARACTER FORGE をビルドしました');
console.log(`  バナー ${banners.length} 件`);
console.log(`  既存キャラ ${characters.length} / スキル ${skills.length} / AI ${aiProfiles.length} / コンボ ${combos.length} / 立ち絵 ${portraits.length}`);
console.log(`  列挙子: 属性${schema.elements.length} ロール${schema.roles.length} 状態異常${schema.statusTypes.length} 効果${schema.effectTypes.length} AI条件${schema.aiConditions.length}`);
console.log(`  ${out}  (${Math.round(Buffer.byteLength(html) / 1024)} KB)`);
