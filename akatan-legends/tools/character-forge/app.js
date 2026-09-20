/* あかたんLegends CHARACTER FORGE — 画面ロジック
 * ------------------------------------------------------------
 * 検証は scripts/validate-data.mjs と同じ規則をここに写している。
 * 「ツールでOKなのに validate-data で落ちる」が一番つらいので、
 * 規則を足すときは必ず両方に入れること。
 */
(() => {
const S = FORGE.schema;
const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, kids = []) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};
const opt = (v, label) => el('option', { value: v }, label ?? v);

const STAT_LABEL = {
  hp: 'HP', attack: '攻撃', defense: '防御', speed: '速度',
  critical: 'クリ率%', criticalDamage: 'クリダメ%', resistance: '耐性%', healing: '回復力%',
};
const ELEMENT_LABEL = { FIRE:'炎', WATER:'水', EARTH:'地', WIND:'風', LIGHT:'光', DARK:'闇', VOID:'虚無' };
const ROLE_LABEL = { TANK:'タンク', ATTACKER:'アタッカー', SUPPORT:'サポート', HEALER:'ヒーラー', CONTROL:'コントロール', SPECIALIST:'スペシャリスト' };
const COND_LABEL = {
  hpBelow:'自分のHPが◯%以下', turnAtLeast:'◯ターン目以降',
  allyDefeated:'味方が◯人やられた', enemyDefeated:'敵を◯体倒した',
};
const AI_COND_LABEL = {
  ALWAYS:'いつでも', ALLY_HP_BELOW:'味方のHPが◯%以下', SELF_HP_BELOW:'自分のHPが◯%以下',
  ENEMY_HP_BELOW:'敵のHPが◯%以下', ENEMY_COUNT_ATLEAST:'敵が◯体以上',
  ENEMY_HAS_BUFF:'敵がバフを持っている', ALLY_HAS_DEBUFF:'味方がデバフを受けている',
  ULT_READY:'必殺ゲージが溜まった', TURN_ATLEAST:'◯ターン目以降',
};
const AI_COND_NEEDS_VALUE = new Set(['ALLY_HP_BELOW','SELF_HP_BELOW','ENEMY_HP_BELOW','ENEMY_COUNT_ATLEAST','TURN_ATLEAST']);
const EFFECT_LABEL = { DAMAGE:'ダメージ', HEAL:'回復', STATUS:'状態付与', CLEANSE:'状態解除', GAUGE:'行動ゲージ', ULT_GAUGE:'必殺ゲージ' };
const PATTERN_LABEL = { SINGLE:'単体', ALL:'全体', RANDOM:'ランダム', LOWEST_HP:'HPが一番低い', HIGHEST_ATK:'攻撃力が一番高い', FRONT:'前衛', SELF:'自分' };
const SIDE_LABEL = { ENEMY:'敵', ALLY:'味方', SELF:'自分' };

/* ---------- 状態 ---------- */
let M = blank();

function blank() {
  return {
    id:'', name:'', title:'', rarity:'SR', element:'FIRE', roles:['ATTACKER'],
    description:'', tags:[], limited:false, portrait:'',
    baseStats:{ hp:600, attack:110, defense:45, speed:110, critical:12, criticalDamage:150, resistance:15, healing:100 },
    growth:{ hp:32, attack:6, defense:2.2, speed:1.8, critical:0.2, criticalDamage:0.3 },
    skills:[ newSkill('NORMAL') ],
    awakening:{ name:'', condKey:'hpBelow', condValue:50, description:'', statBonus:{} },
    ai:{ mode:'new', existing:'', rules:[ { priority:10, type:'ULT_READY', value:null, skill:'' } ] },
    art:{ primary:'#2f6d5c', secondary:'#12241e', accent:'#7cffb2', sigil:'', pattern:'burst' },
    trpg:{ source:'', player:'', investigator:'', affiliation:'', visibility:'PRIVATE', note:'' },
  };
}
function newSkill(kind) {
  const base = { kind, name:'', description:'', fx:'', cooldown: kind === 'ACTIVE' ? 3 : 0,
    side: kind === 'ULTIMATE' ? 'ENEMY' : 'ENEMY', pattern: kind === 'ULTIMATE' ? 'ALL' : 'SINGLE',
    effects:[ { type:'DAMAGE', power: kind === 'ULTIMATE' ? 1.8 : (kind === 'NORMAL' ? 0.85 : 1.1), hits:1 } ] };
  if (kind === 'ULTIMATE') base.ultCost = 100;
  return base;
}
const skillId = (s) => {
  const p = { NORMAL:'na', ACTIVE:'sk', ULTIMATE:'ult' }[s.kind];
  const n = M.id || 'chara';
  const idx = M.skills.filter((x) => x.kind === s.kind).indexOf(s);
  return s.kind === 'ACTIVE' ? `${p}_${n}_${idx + 1}` : `${p}_${n}`;
};
const aiId = () => `ai_${M.id || 'chara'}`;
/** fx(演出キー)は必須。未入力ならIDから自動で作る(validate-data.mjs が空を弾くため) */
const skillFx = (s) => s.fx && s.fx.trim() ? s.fx.trim() : `${skillId(s)}_fx`;

/* ---------- 出力の組み立て ---------- */
function buildCharacter() {
  const c = { id:M.id, name:M.name };
  if (M.title) c.title = M.title;
  c.rarity = M.rarity; c.element = M.element; c.roles = [...M.roles];
  c.baseStats = { ...M.baseStats };
  c.growth = {}; for (const [k,v] of Object.entries(M.growth)) if (v !== '' && v !== null) c.growth[k] = Number(v);
  const normal = M.skills.find((s) => s.kind === 'NORMAL');
  if (normal) c.normalAttack = skillId(normal);
  const actives = M.skills.filter((s) => s.kind === 'ACTIVE');
  if (actives.length) c.skills = actives.map(skillId);
  const ult = M.skills.find((s) => s.kind === 'ULTIMATE');
  if (ult) c.ultimate = skillId(ult);
  const aw = { id:`${M.id || 'chara'}_awaken`, name:M.awakening.name, condition:{}, description:M.awakening.description };
  aw.condition[M.awakening.condKey] = Number(M.awakening.condValue);
  const sb = {}; for (const [k,v] of Object.entries(M.awakening.statBonus)) if (v !== '' && v !== null && Number(v) !== 0) sb[k] = Number(v);
  if (Object.keys(sb).length) aw.statBonus = sb;
  c.awakening = aw;
  c.defaultAi = M.ai.mode === 'existing' ? M.ai.existing : aiId();
  c.description = M.description;
  if (M.tags.length) c.tags = [...M.tags];
  const t = {}; for (const k of ['source','player','investigator','affiliation','note']) if (M.trpg[k]) t[k] = M.trpg[k];
  t.visibility = M.trpg.visibility;
  c.trpg = t;
  const art = { primary:M.art.primary, secondary:M.art.secondary, accent:M.art.accent, sigil:M.art.sigil, pattern:M.art.pattern };
  if (M.portrait) art.portrait = M.portrait;
  c.art = art;
  if (M.limited) c.limited = true;
  return c;
}
function buildSkills() {
  return M.skills.map((s) => {
    const o = { id:skillId(s), name:s.name, kind:s.kind, description:s.description, cooldown:Number(s.cooldown) || 0,
      target:{ side:s.side, pattern:s.pattern }, effects:s.effects.map((e) => {
        const r = { type:e.type };
        if (e.type === 'DAMAGE' || e.type === 'HEAL') { r.power = Number(e.power); if (Number(e.hits) > 1) r.hits = Number(e.hits); }
        if (e.type === 'STATUS') { r.status = e.status; r.duration = Number(e.duration) || 1; if (e.potency !== '' && e.potency != null) r.potency = Number(e.potency); if (e.chance !== '' && e.chance != null) r.chance = Number(e.chance); }
        if (e.type === 'CLEANSE') r.hits = Number(e.hits) || 1;
        if (e.type === 'GAUGE' || e.type === 'ULT_GAUGE') r.amount = Number(e.amount) || 0;
        return r;
      }) };
    o.fx = skillFx(s);
    if (s.kind === 'ULTIMATE') o.ultCost = Number(s.ultCost) || 100;
    return o;
  });
}
function buildAi() {
  if (M.ai.mode === 'existing') return null;
  return { id:aiId(), name:`${M.name || M.id || 'キャラ'}の戦術`,
    description:`${M.name || ''} の既定AI。CHARACTER FORGE で作成。`, playerSelectable:true,
    rules:M.ai.rules.map((r) => {
      const rule = { priority:Number(r.priority), condition:{ type:r.type } };
      if (AI_COND_NEEDS_VALUE.has(r.type)) rule.condition.value = Number(r.value);
      rule.skill = r.skill || 'NORMAL';
      return rule;
    }) };
}

/* ---------- 検証(validate-data.mjs と同じ規則) ---------- */
function validate() {
  const out = [];
  const E = (m) => out.push({ level:'err', msg:m });
  const W = (m) => out.push({ level:'warn', msg:m });
  const c = buildCharacter();

  if (!c.id) E('IDが空です');
  else if (!/^[a-z0-9_]+$/.test(c.id)) E('IDは半角小文字の英数字と _ だけにしてください');
  else if (FORGE.characters.some((x) => x.id === c.id)) E(`ID "${c.id}" は既存キャラと重複しています`);
  if (!c.name) E('名前が空です');
  if (!c.description) E('説明が空です');
  if (!c.roles.length) E('ロールを1つ以上選んでください');

  for (const k of S.statKeys) {
    const v = c.baseStats[k];
    if (typeof v !== 'number' || Number.isNaN(v)) E(`baseStats.${k} が数値ではありません`);
    else if (v < 0) E(`baseStats.${k} が負の数です`);
  }
  if (!Object.keys(c.growth).length) W('成長値が空です。レベルを上げても強くなりません');

  // 覚醒
  if (!c.awakening.name) E('覚醒名が空です');
  if (!c.awakening.description) E('覚醒の説明が空です');
  const cv = c.awakening.condition[M.awakening.condKey];
  if (typeof cv !== 'number' || Number.isNaN(cv)) E('覚醒の条件値が数値ではありません');

  // スキル
  const normal = M.skills.filter((s) => s.kind === 'NORMAL');
  if (normal.length === 0) E('通常攻撃が必要です');
  if (normal.length > 1) E('通常攻撃は1つだけにしてください');
  const ults = M.skills.filter((s) => s.kind === 'ULTIMATE');
  if (ults.length > 1) E('必殺技は1つだけにしてください');
  const seen = new Set();
  for (const s of M.skills) {
    const sid = skillId(s);
    const what = `${s.name || sid}`;
    if (!s.name) E(`スキル(${sid})の名前が空です`);
    if (!s.description) W(`スキル「${what}」の説明が空です`);
    if (seen.has(sid)) E(`スキルIDが重複しています: ${sid}`);
    seen.add(sid);
    if (FORGE.skills.some((x) => x.id === sid)) E(`スキルID "${sid}" は既存スキルと重複しています`);
    if (!s.effects.length) E(`スキル「${what}」に効果がありません`);
    s.effects.forEach((e, i) => {
      if ((e.type === 'DAMAGE' || e.type === 'HEAL')) {
        const p = Number(e.power);
        if (!Number.isFinite(p)) E(`「${what}」効果${i + 1}: 威力が数値ではありません`);
        else if (p <= 0) E(`「${what}」効果${i + 1}: 威力は0より大きくしてください`);
        else if (p > 5) W(`「${what}」効果${i + 1}: 威力 ${p} はかなり大きいです`);
      }
      if (e.type === 'STATUS' && !e.status) E(`「${what}」効果${i + 1}: 状態異常の種類が未選択です`);
    });
    if (s.kind === 'ACTIVE' && Number(s.cooldown) <= 0) W(`「${what}」のクールダウンが0です。毎ターン撃てます`);
    if (s.kind === 'NORMAL' && Number(s.cooldown) !== 0) E(`通常攻撃「${what}」のクールダウンは 0 にしてください`);
    if (!skillFx(s)) E(`スキル「${what}」の演出キー(fx)が空です`);
    s.effects.forEach((e, i) => {
      if (e.type === 'STATUS' && !Number.isFinite(Number(e.duration))) E(`「${what}」効果${i + 1}: 継続ターンが数値ではありません`);
      if (e.type === 'STATUS' && e.chance !== '' && e.chance != null) {
        const ch = Number(e.chance);
        if (!Number.isFinite(ch) || ch < 0 || ch > 100) E(`「${what}」効果${i + 1}: 成功率は0〜100で指定してください`);
      }
      if ((e.type === 'GAUGE' || e.type === 'ULT_GAUGE') && !Number.isFinite(Number(e.amount))) E(`「${what}」効果${i + 1}: 増減量が数値ではありません`);
    });
  }

  // AI: 参照スキルは本人が持っているものだけ
  if (M.ai.mode === 'new') {
    const owned = new Set(M.skills.map(skillId));
    if (!M.ai.rules.length) E('AIのルールが1つもありません');
    M.ai.rules.forEach((r, i) => {
      if (r.skill && r.skill !== 'NORMAL' && !owned.has(r.skill)) {
        E(`AIルール${i + 1}: このキャラが持っていないスキルを指しています`);
      }
      if (AI_COND_NEEDS_VALUE.has(r.type) && !Number.isFinite(Number(r.value))) {
        E(`AIルール${i + 1}: 条件の値が数値ではありません`);
      }
    });
    if (M.ai.rules.some((r) => r.type === 'ULT_READY') && !M.skills.some((s) => s.kind === 'ULTIMATE')) {
      E('AIに「必殺ゲージが溜まった」ルールがありますが、必殺技がありません');
    }
  } else if (!M.ai.existing) E('既存AIが選ばれていません');

  // 見た目
  for (const k of ['primary','secondary','accent']) {
    if (!/^#[0-9a-fA-F]{6}$/.test(c.art[k])) E(`art.${k} が #RRGGBB 形式ではありません`);
  }
  const sig = [...(c.art.sigil || '')];
  if (sig.length === 0) E('紋章(sigil)が空です');
  else if (sig.length > 2) E('紋章は1〜2文字にしてください');
  if (!c.trpg.visibility) E('公開範囲が未選択です');
  if (c.trpg.player && c.trpg.visibility !== 'PRIVATE') W('PL名が入っています。公開範囲は PRIVATE を推奨します');

  return out;
}

/* ---------- バランス参考 ---------- */
function refTable() {
  const same = FORGE.characters.filter((c) => c.rarity === M.rarity);
  const pool = same.length >= 2 ? same : FORGE.characters;
  const box = el('div');
  box.appendChild(el('div', { class:'muted', html:
    `同レアリティ <b>${same.length}</b> 体${same.length < 2 ? '(少ないので全キャラと比較)' : ''} の実数値。` }));
  const t = el('table', { class:'ref' });
  t.appendChild(el('tr', {}, [el('th',{},'項目'), el('th',{},'最小'), el('th',{},'平均'), el('th',{},'最大'), el('th',{},'あなた')]));
  for (const k of S.statKeys) {
    const vals = pool.map((c) => c.baseStats?.[k]).filter((v) => typeof v === 'number');
    if (!vals.length) continue;
    const mn = Math.min(...vals), mx = Math.max(...vals);
    const av = vals.reduce((a,b) => a+b, 0) / vals.length;
    const mine = Number(M.baseStats[k]);
    const over = mx > 0 && mine > mx;
    const row = el('tr', {}, [
      el('td',{},STAT_LABEL[k]), el('td',{},String(mn)), el('td',{},av.toFixed(1)), el('td',{},String(mx)),
      el('td',{ style:`color:${over ? 'var(--warn)' : 'var(--fg)'};font-weight:700` }, String(mine)),
    ]);
    t.appendChild(row);
  }
  box.appendChild(t);
  // 全キャラ中の上限(設計上の天井)
  const allSpeed = FORGE.characters.map((c) => c.baseStats?.speed).filter(Boolean);
  if (allSpeed.length) {
    const cap = Math.max(...allSpeed);
    const owner = FORGE.characters.find((c) => c.baseStats?.speed === cap);
    const mine = Number(M.baseStats.speed);
    box.appendChild(el('div', { class:'muted', style:'margin-top:8px', html:
      `全キャラ中の最速は <b>${owner?.name ?? '?'}</b> の SPD <b>${cap}</b>。` +
      (mine > cap ? ' <span style="color:var(--warn)">それを超えています。意図的でなければ下げてください。</span>' : '') }));
  }
  return box;
}

/* ---------- 描画 ---------- */
function renderStatic() {
  const fill = (sel, arr, labels) => { const n = $(sel); n.innerHTML = ''; for (const v of arr) n.appendChild(opt(v, labels ? `${labels[v] ?? v}` : v)); };
  fill('c-rarity', S.rarities);
  fill('c-element', S.elements, ELEMENT_LABEL);
  fill('art-pattern', S.artPatterns);
  fill('t-visibility', S.visibilities);
  const p = $('c-portrait'); p.innerHTML = ''; p.appendChild(opt('', '(なし — 紋章で表示)'));
  for (const v of FORGE.portraits) p.appendChild(opt(v));
  const ae = $('ai-existing'); ae.innerHTML = '';
  for (const a of FORGE.aiProfiles.filter((a) => a.playerSelectable)) ae.appendChild(opt(a.id, `${a.name} (${a.id})`));
  const fxl = document.getElementById('fxlist');
  if (fxl) { fxl.innerHTML = ''; for (const v of (FORGE.fxKeys ?? [])) fxl.appendChild(opt(v)); }
  const ac = $('a-cond'); ac.innerHTML = '';
  for (const k of Object.keys(COND_LABEL)) ac.appendChild(opt(k, COND_LABEL[k]));

  $('c-roles').innerHTML = '';
  for (const r of S.roles) {
    $('c-roles').appendChild(el('span', { class:'chip', 'data-role':r, text:ROLE_LABEL[r] ?? r,
      onclick:(ev) => { const t = ev.target.dataset.role;
        M.roles = M.roles.includes(t) ? M.roles.filter((x) => x !== t) : [...M.roles, t]; render(); } }));
  }
  for (const [wrap, obj, keys] of [['c-baseStats', 'baseStats', S.statKeys], ['c-growth', 'growth', S.statKeys], ['a-statBonus', 'awStat', S.statKeys]]) {
    const n = $(wrap); n.innerHTML = '';
    for (const k of keys) {
      const input = el('input', { type:'number', step:'0.1', 'data-obj':obj, 'data-key':k });
      input.addEventListener('input', (e) => {
        const v = e.target.value === '' ? '' : Number(e.target.value);
        if (obj === 'baseStats') M.baseStats[k] = v === '' ? 0 : v;
        else if (obj === 'growth') M.growth[k] = v;
        else M.awakening.statBonus[k] = v;
        softRender();
      });
      n.appendChild(el('label', { class:'f' }, [STAT_LABEL[k], input]));
    }
  }
}

function renderSkills() {
  const box = $('skills'); box.innerHTML = '';
  M.skills.forEach((s, si) => {
    const head = el('h3', {}, [
      el('span', {}, `${{NORMAL:'通常攻撃', ACTIVE:'アクティブ', ULTIMATE:'必殺技'}[s.kind]} — ${skillId(s)}`),
    ]);
    if (s.kind !== 'NORMAL') head.appendChild(el('button', { class:'btn sm danger', text:'削除',
      onclick:() => { M.skills.splice(si, 1); render(); } }));
    const card = el('div', { class:'skill' }, [head]);

    const row = el('div', { class:'row' });
    row.appendChild(el('label', { class:'f' }, ['技名', bind(el('input', { value:s.name }), (v) => s.name = v)]));
    const sideSel = el('select'); for (const v of S.targetSides) sideSel.appendChild(opt(v, SIDE_LABEL[v] ?? v));
    sideSel.value = s.side; bind(sideSel, (v) => s.side = v);
    row.appendChild(el('label', { class:'f' }, ['対象', sideSel]));
    const patSel = el('select'); for (const v of S.targetPatterns) patSel.appendChild(opt(v, PATTERN_LABEL[v] ?? v));
    patSel.value = s.pattern; bind(patSel, (v) => s.pattern = v);
    row.appendChild(el('label', { class:'f' }, ['選び方', patSel]));
    if (s.kind === 'ACTIVE') row.appendChild(el('label', { class:'f' }, ['クールダウン(ターン)',
      bind(el('input', { type:'number', min:'0', value:s.cooldown }), (v) => s.cooldown = v)]));
    if (s.kind === 'ULTIMATE') row.appendChild(el('label', { class:'f' }, ['必殺コスト',
      bind(el('input', { type:'number', value:s.ultCost ?? 100 }), (v) => s.ultCost = v)]));
    card.appendChild(row);
    card.appendChild(el('label', { class:'f', style:'margin-top:8px' }, ['説明',
      bind(el('textarea', { }, s.description), (v) => s.description = v)]));
    const fxIn = bind(el('input', { value:s.fx ?? '', placeholder:skillId(s) + '_fx', list:'fxlist' }), (v) => { s.fx = v; softRender(); });
    card.appendChild(el('label', { class:'f', style:'margin-top:8px' }, ['演出キー(fx) — 必須。空なら自動で付きます', fxIn,
      el('span', { class:'hint', text:`出力される値: ${skillFx(s)}` })]));

    s.effects.forEach((e, ei) => {
      const efBox = el('div', { class:'eff' });
      const top = el('div', { class:'row' });
      const tSel = el('select'); for (const v of S.effectTypes) tSel.appendChild(opt(v, EFFECT_LABEL[v] ?? v));
      tSel.value = e.type;
      tSel.addEventListener('change', () => { e.type = tSel.value; render(); });
      top.appendChild(el('label', { class:'f' }, [`効果${ei + 1}`, tSel]));
      if (e.type === 'DAMAGE' || e.type === 'HEAL') {
        top.appendChild(el('label', { class:'f' }, ['威力(1.0=等倍)',
          bind(el('input', { type:'number', step:'0.05', value:e.power ?? 1 }), (v) => { e.power = v; softRender(); })]));
        top.appendChild(el('label', { class:'f' }, ['ヒット数',
          bind(el('input', { type:'number', min:'1', value:e.hits ?? 1 }), (v) => e.hits = v)]));
      } else if (e.type === 'STATUS') {
        const st = el('select'); st.appendChild(opt('', '(選択)'));
        for (const v of S.statusTypes) st.appendChild(opt(v));
        st.value = e.status ?? ''; bind(st, (v) => { e.status = v; softRender(); });
        top.appendChild(el('label', { class:'f' }, ['種類', st]));
        top.appendChild(el('label', { class:'f' }, ['継続ターン',
          bind(el('input', { type:'number', min:'1', value:e.duration ?? 2 }), (v) => e.duration = v)]));
        top.appendChild(el('label', { class:'f' }, ['強さ(任意)',
          bind(el('input', { type:'number', value:e.potency ?? '' }), (v) => e.potency = v)]));
        top.appendChild(el('label', { class:'f' }, ['成功率%(任意)',
          bind(el('input', { type:'number', value:e.chance ?? '' }), (v) => e.chance = v)]));
      } else if (e.type === 'CLEANSE') {
        top.appendChild(el('label', { class:'f' }, ['解除する数',
          bind(el('input', { type:'number', min:'1', value:e.hits ?? 1 }), (v) => e.hits = v)]));
      } else {
        top.appendChild(el('label', { class:'f' }, ['増減量',
          bind(el('input', { type:'number', value:e.amount ?? 50 }), (v) => e.amount = v)]));
      }
      efBox.appendChild(top);
      const rm = el('button', { class:'btn sm danger', text:'この効果を消す', onclick:() => { s.effects.splice(ei,1); render(); } });
      if (s.effects.length > 1) efBox.appendChild(el('div', { style:'margin-top:6px' }, [rm]));
      card.appendChild(efBox);
    });
    card.appendChild(el('button', { class:'btn sm', text:'+ 効果を足す', style:'margin-top:7px',
      onclick:() => { s.effects.push({ type:'DAMAGE', power:1, hits:1 }); render(); } }));
    box.appendChild(card);
  });
}

function renderAi() {
  $('ai-existing-wrap').style.display = M.ai.mode === 'existing' ? '' : 'none';
  $('ai-rules-wrap').style.display = M.ai.mode === 'new' ? '' : 'none';
  const box = $('ai-rules'); box.innerHTML = '';
  M.ai.rules.forEach((r, i) => {
    const row = el('div', { class:'row', style:'margin-bottom:7px' });
    row.appendChild(el('label', { class:'f' }, ['優先度(小さいほど先)',
      bind(el('input', { type:'number', value:r.priority }), (v) => r.priority = v)]));
    const cs = el('select'); for (const v of S.aiConditions) cs.appendChild(opt(v, AI_COND_LABEL[v] ?? v));
    cs.value = r.type; cs.addEventListener('change', () => { r.type = cs.value; render(); });
    row.appendChild(el('label', { class:'f' }, ['条件', cs]));
    if (AI_COND_NEEDS_VALUE.has(r.type)) row.appendChild(el('label', { class:'f' }, ['値',
      bind(el('input', { type:'number', value:r.value ?? 50 }), (v) => r.value = v)]));
    const ss = el('select'); ss.appendChild(opt('NORMAL', '通常攻撃'));
    for (const s of M.skills) if (s.kind !== 'NORMAL') ss.appendChild(opt(skillId(s), s.name || skillId(s)));
    ss.value = r.skill || 'NORMAL'; bind(ss, (v) => { r.skill = v; softRender(); });
    row.appendChild(el('label', { class:'f' }, ['使う技', ss]));
    const del = el('button', { class:'btn sm danger', text:'削除', onclick:() => { M.ai.rules.splice(i,1); render(); } });
    row.appendChild(el('label', { class:'f' }, [' ', del]));
    box.appendChild(row);
  });
}

function renderIssues() {
  const issues = validate();
  const box = $('issues'); box.innerHTML = '';
  const errs = issues.filter((i) => i.level === 'err');
  $('check-count').textContent = errs.length ? `エラー ${errs.length}件` : 'OK';
  if (!issues.length) {
    box.appendChild(el('div', { class:'issue ok' }, '問題なし。そのまま出力できます。'));
  } else {
    for (const i of issues) box.appendChild(el('div', { class:`issue ${i.level}` }, (i.level === 'err' ? '✗ ' : '⚠ ') + i.msg));
  }
  return errs.length === 0;
}

function renderOutputs(okToUse) {
  const box = $('outputs'); box.innerHTML = '';
  const files = outputFiles();
  for (const f of files) {
    const d = el('details');
    d.appendChild(el('summary', {}, `${f.path}`));
    d.appendChild(el('pre', { class:'out' }, f.body));
    const bar = el('div', { style:'display:flex;gap:7px;margin-top:7px' }, [
      el('button', { class:'btn sm', text:'コピー', onclick:() => navigator.clipboard?.writeText(f.body) }),
      el('button', { class:'btn sm', text:'ダウンロード', onclick:() => download(f.name, f.body) }),
    ]);
    d.appendChild(bar);
    box.appendChild(d);
  }
  const how = $('howto'); how.innerHTML = '';
  const steps = [
    ['1', `<b>${files[0].path}</b> を新規ファイルとして置く`],
    ['2', `スキルを <b>data/skills/*.json</b> の配列に追記する(通常攻撃は normal.json、アクティブは active.json、必殺は ultimate.json)`],
  ];
  if (M.ai.mode === 'new') steps.push(['3', 'AIプロファイルを <b>data/ai/profiles.json</b> の配列に追記する']);
  steps.push([String(steps.length + 1), '<span class="mono">node scripts/validate-data.mjs</span> を実行して OK を確認']);
  steps.push([String(steps.length + 1), '<span class="mono">node tools/build-standalone.mjs</span> で遊べるHTMLを作り直す']);
  for (const [n, t] of steps) how.appendChild(el('div', { class:'step' }, [el('b', {}, n), el('span', { html:t })]));
}

function outputFiles() {
  const c = buildCharacter();
  const out = [{ path:`data/characters/${c.id || 'ID未設定'}.json`, name:`${c.id || 'character'}.json`,
    body:JSON.stringify(c, null, 2) }];
  const byKind = { NORMAL:'normal.json', ACTIVE:'active.json', ULTIMATE:'ultimate.json' };
  const skills = buildSkills();
  for (const kind of ['NORMAL','ACTIVE','ULTIMATE']) {
    const rows = skills.filter((s) => s.kind === kind);
    if (!rows.length) continue;
    out.push({ path:`data/skills/${byKind[kind]} に追記`, name:`skills-${kind.toLowerCase()}.json`,
      body:JSON.stringify(rows, null, 2) });
  }
  const ai = buildAi();
  if (ai) out.push({ path:'data/ai/profiles.json に追記', name:'ai-profile.json', body:JSON.stringify([ai], null, 2) });
  return out;
}

function download(name, body) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([body], { type:'application/json' }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}

function bind(node, fn) {
  node.addEventListener('input', (e) => fn(e.target.value));
  node.addEventListener('change', (e) => fn(e.target.value));
  return node;
}

function syncInputs() {
  $('c-id').value = M.id; $('c-name').value = M.name; $('c-title').value = M.title;
  $('c-rarity').value = M.rarity; $('c-element').value = M.element; $('c-portrait').value = M.portrait;
  $('c-description').value = M.description; $('c-limited').checked = M.limited;
  $('idPreview').textContent = M.id || 'ID';
  for (const chip of $('c-roles').children) chip.classList.toggle('on', M.roles.includes(chip.dataset.role));
  const tb = $('c-tags'); tb.innerHTML = '';
  M.tags.forEach((t, i) => tb.appendChild(el('span', { class:'chip on', text:`${t} ×`,
    onclick:() => { M.tags.splice(i,1); render(); } })));
  for (const k of S.statKeys) {
    const b = document.querySelector(`[data-obj="baseStats"][data-key="${k}"]`); if (b) b.value = M.baseStats[k];
    const g = document.querySelector(`[data-obj="growth"][data-key="${k}"]`); if (g) g.value = M.growth[k] ?? '';
    const a = document.querySelector(`[data-obj="awStat"][data-key="${k}"]`); if (a) a.value = M.awakening.statBonus[k] ?? '';
  }
  $('a-name').value = M.awakening.name; $('a-cond').value = M.awakening.condKey;
  $('a-value').value = M.awakening.condValue; $('a-description').value = M.awakening.description;
  $('ai-mode').value = M.ai.mode; $('ai-existing').value = M.ai.existing || ($('ai-existing').options[0]?.value ?? '');
  for (const k of ['primary','secondary','accent']) {
    $(`art-${k}`).value = M.art[k]; $(`sw-${k}`).style.background = M.art[k];
  }
  $('art-sigil').value = M.art.sigil; $('art-pattern').value = M.art.pattern;
  for (const k of ['source','player','investigator','affiliation','note']) $(`t-${k}`).value = M.trpg[k];
  $('t-visibility').value = M.trpg.visibility;
  $('ref-rarity').textContent = `${M.rarity} と比較`;
}

let raf = 0;
function softRender() { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { const ok = renderIssues(); renderOutputs(ok); $('ref').innerHTML = ''; $('ref').appendChild(refTable()); }); }
function render() {
  syncInputs(); renderSkills(); renderAi();
  const ok = renderIssues(); renderOutputs(ok);
  $('ref').innerHTML = ''; $('ref').appendChild(refTable());
}

/* ---------- イベント ---------- */
function wire() {
  const t = (id, fn) => { const n = $(id); n.addEventListener('input', () => { fn(n.value); softRender(); }); n.addEventListener('change', () => { fn(n.value); render(); }); };
  t('c-id', (v) => M.id = v.trim()); t('c-name', (v) => M.name = v); t('c-title', (v) => M.title = v);
  t('c-rarity', (v) => M.rarity = v); t('c-element', (v) => M.element = v); t('c-portrait', (v) => M.portrait = v);
  t('c-description', (v) => M.description = v);
  $('c-limited').addEventListener('change', (e) => { M.limited = e.target.checked; softRender(); });
  $('c-tag-add').addEventListener('click', () => { const v = $('c-tag-input').value.trim(); if (v && !M.tags.includes(v)) { M.tags.push(v); $('c-tag-input').value=''; render(); } });
  $('c-tag-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('c-tag-add').click(); } });
  t('a-name', (v) => M.awakening.name = v); t('a-cond', (v) => M.awakening.condKey = v);
  t('a-value', (v) => M.awakening.condValue = v); t('a-description', (v) => M.awakening.description = v);
  $('ai-mode').addEventListener('change', (e) => { M.ai.mode = e.target.value; render(); });
  t('ai-existing', (v) => M.ai.existing = v);
  $('ai-add').addEventListener('click', () => { M.ai.rules.push({ priority:(M.ai.rules.length+1)*10, type:'ALWAYS', value:null, skill:'NORMAL' }); render(); });
  for (const k of ['primary','secondary','accent']) t(`art-${k}`, (v) => M.art[k] = v);
  t('art-sigil', (v) => M.art.sigil = v); t('art-pattern', (v) => M.art.pattern = v);
  for (const k of ['source','player','investigator','affiliation','note']) t(`t-${k}`, (v) => M.trpg[k] = v);
  t('t-visibility', (v) => M.trpg.visibility = v);
  document.querySelectorAll('[data-addskill]').forEach((b) => b.addEventListener('click', () => {
    M.skills.push(newSkill(b.dataset.addskill)); render();
  }));
  $('btn-reset').addEventListener('click', () => { if (confirm('入力を全部消して最初からやり直しますか?')) { M = blank(); render(); } });
  $('btn-sample').addEventListener('click', () => { M = sample(); render(); });
  $('btn-load').addEventListener('click', loadExisting);
  $('btn-download').addEventListener('click', () => { for (const f of outputFiles()) download(f.name, f.body); });
}

function sample() {
  const m = blank();
  Object.assign(m, { id:'mikage', name:'御影 灯', title:'MIKAGE AKARI / 灯火の守り手',
    rarity:'SSR', element:'LIGHT', roles:['HEALER','SUPPORT'], limited:false,
    description:'灯を絶やさぬことだけを己に課した、物静かな守り手。前に出ることはないが、誰よりも最後まで立っている。',
    tags:['探索者','Healer'] });
  m.baseStats = { hp:720, attack:88, defense:58, speed:104, critical:8, criticalDamage:150, resistance:28, healing:135 };
  m.growth = { hp:38, attack:4.5, defense:2.8, speed:1.6, critical:0.15, criticalDamage:0.25 };
  m.skills = [
    Object.assign(newSkill('NORMAL'), { name:'灯芯の一打', description:'灯を纏った杖で打ち据える。', fx:'light_wick_strike' }),
    Object.assign(newSkill('ACTIVE'), { name:'ともしび', description:'最も傷ついた味方をやさしく照らして癒やす。',
      side:'ALLY', pattern:'LOWEST_HP', cooldown:2, fx:'heal_tomoshibi',
      effects:[{ type:'HEAL', power:1.2, hits:1 }] }),
    Object.assign(newSkill('ULTIMATE'), { name:'長夜の灯', description:'夜が明けるまで消えぬ灯。味方全体を癒やし、continuous に守る。',
      side:'ALLY', pattern:'ALL', fx:'heal_long_night',
      effects:[{ type:'HEAL', power:1.0, hits:1 }, { type:'STATUS', status:'REGEN', duration:3, potency:20 }] }),
  ];
  m.awakening = { name:'不滅の灯', condKey:'hpBelow', condValue:40,
    description:'消えかけた灯が、かえって強く燃え上がる。回復力と耐性が大きく伸びる。',
    statBonus:{ healing:40, resistance:20 } };
  m.ai = { mode:'new', existing:'', rules:[
    { priority:10, type:'ULT_READY', value:null, skill:'ult_mikage' },
    { priority:20, type:'ALLY_HP_BELOW', value:60, skill:'sk_mikage_1' },
    { priority:99, type:'ALWAYS', value:null, skill:'NORMAL' },
  ] };
  m.art = { primary:'#C8A24A', secondary:'#241C10', accent:'#FFE9A8', sigil:'灯', pattern:'petal' };
  m.trpg = { source:'', player:'', investigator:'御影 灯', affiliation:'', visibility:'PRIVATE', note:'CHARACTER FORGE のお手本' };
  return m;
}

function loadExisting() {
  const id = prompt('読み込むキャラのIDを入れてください:\n' + FORGE.characters.map((c) => `${c.id} (${c.name})`).join('\n'));
  if (!id) return;
  const c = FORGE.characters.find((x) => x.id === id.trim());
  if (!c) { alert('そのIDのキャラは見つかりませんでした。'); return; }
  const m = blank();
  Object.assign(m, { id:'', name:c.name + '(コピー)', title:c.title ?? '', rarity:c.rarity, element:c.element,
    roles:[...(c.roles ?? [])], description:c.description ?? '', tags:[...(c.tags ?? [])],
    limited:c.limited === true, portrait:c.art?.portrait ?? '' });
  m.baseStats = { ...m.baseStats, ...(c.baseStats ?? {}) };
  m.growth = { ...(c.growth ?? {}) };
  if (c.art) m.art = { primary:c.art.primary, secondary:c.art.secondary, accent:c.art.accent, sigil:c.art.sigil, pattern:c.art.pattern ?? 'burst' };
  if (c.trpg) m.trpg = { source:c.trpg.source ?? '', player:c.trpg.player ?? '', investigator:c.trpg.investigator ?? '',
    affiliation:c.trpg.affiliation ?? '', visibility:c.trpg.visibility ?? 'PRIVATE', note:c.trpg.note ?? '' };
  if (c.awakening) {
    const ck = Object.keys(c.awakening.condition ?? {})[0] ?? 'hpBelow';
    m.awakening = { name:c.awakening.name ?? '', condKey:COND_LABEL[ck] ? ck : 'hpBelow',
      condValue:c.awakening.condition?.[ck] ?? 50, description:c.awakening.description ?? '',
      statBonus:{ ...(c.awakening.statBonus ?? {}) } };
  }
  m.ai = { mode:'existing', existing:c.defaultAi ?? '', rules:[] };
  M = m; render();
  alert('読み込みました。IDは空にしてあるので、新しいIDを付けてください(既存キャラを上書きしないため)。');
}

renderStatic(); wire(); render();
})();
