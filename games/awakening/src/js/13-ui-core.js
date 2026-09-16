/* =========================================================================
   08. BattleUI — 表示と入力のみ。ここで戦闘計算はしない。
   ========================================================================= */
const $ = s=>document.querySelector(s);
const $$ = s=>Array.from(document.querySelectorAll(s));
const esc = s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const TYPE_LABEL={ATTACK:"攻撃",DEFENSE:"防御",SPECIAL:"特殊",SUPPORT:"補助"};
const KIND_ICON={DOT:"✹",REGEN:"✚",STUN:"✸",PARALYZE:"⚡",SILENCE:"✖",CONFUSE:"✧",SHIELD:"⛨",
  HEALBLOCK:"⊘",ACC:"◐",CRIT:"✦",COUNTER:"↩",PIERCE:"➶",NEGATE:"⛉",STAT:"◆"};
const STAT_MAX={hp:1600,atk:280,def:150,spd:160};
const STAT_LABEL={hp:"HP",atk:"ATK",def:"DEF",spd:"SPD"};

function effTone(e){
  if(e.tone) return e.tone;
  if(e.kind==="STAT") return e.mult>=1?"good":"bad";
  if(["DOT","STUN","PARALYZE","SILENCE","CONFUSE","HEALBLOCK"].includes(e.kind)) return "bad";
  if(e.kind==="ACC") return (e.value||0)<0?"bad":"good";
  return "good";
}
function effIcon(e){
  if(e.icon) return e.icon;
  if(e.kind==="STAT"){ return e.mult>=1?"▲":"▽"; }
  return KIND_ICON[e.kind]||"◆";
}

const UI = {
  mode:"local", pick:[null,null], slotFocus:0, blind:true, aiLevel:"normal",
  mySide:0, controllers:["local","local"],
  engine:null, chars:[null,null],
  localSides:[], li:0, acted:[false,false], remoteBuf:{}, playing:false,
  netStarted:false, onlinePick:null, sheetMode:null,
  SPEEDS:{normal:{label:"ふつう",k:1},fast:{label:"はやい",k:0.5},instant:{label:"瞬時",k:0.12}},
  speed:"fast", skip:false,

  /* =======================================================================
     画面遷移 — 進む／戻るに向きがあり、端末の戻る操作にも従う
     ======================================================================= */
  nav:["title"],          // 今どこまで潜っているか
  scrollPos:{},           // 画面ごとのスクロール位置（戻ったときに復元する）
  histOk:false,

  initNav(){
    // file:// で開かれた場合など pushState が使えない環境もあるので、使えるか確かめておく
    try{ history.replaceState({awk:"title",d:1},""); this.histOk=true; }catch(e){ this.histOk=false; }
    window.addEventListener("popstate",e=>this.onPop(e));
  },
  onPop(ev){
    const st=(ev.state&&ev.state.awk)?ev.state:{awk:"title",d:1};
    const d=Math.max(1,st.d||1);
    const dir=d<this.nav.length?"back":"fwd";
    this.nav.length=Math.min(this.nav.length,d);
    while(this.nav.length<d) this.nav.push(st.awk);
    this.nav[this.nav.length-1]=st.awk;
    this.show(st.awk,{fromPop:true,dir});
  },

  show(id,opt){
    opt=opt||{};
    if(this.closeSheet) this.closeSheet();
    if(id!=="battle" && typeof Music!=="undefined") Music.stop();
    if(id==="title" && typeof Net!=="undefined" && Net.close) Net.close();

    const cur=$(".screen.on");
    const curId=cur?cur.id.replace(/^s-/,""):null;
    if(curId===id) return;

    let dir=opt.dir;
    if(!dir){
      const i=this.nav.indexOf(id);
      dir=(i>=0 && i<this.nav.length-1) ? "back" : "fwd";
    }
    if(!opt.fromPop){
      const i=this.nav.indexOf(id);
      if(dir==="back" && i>=0){
        const steps=this.nav.length-1-i;
        // 実際の切り替えは popstate 側で行う（端末の戻ると同じ道筋を通す）
        if(steps>0 && this.histOk){ history.go(-steps); return; }
        this.nav.length=i+1;
      }else{
        this.nav.push(id);
        if(this.histOk){ try{ history.pushState({awk:id,d:this.nav.length},""); }catch(e){} }
      }
    }
    this.transition(curId,id,dir);
  },

  transition(fromId,toId,dir){
    const outEl=fromId?$("#s-"+fromId):null, inEl=$("#s-"+toId);
    if(!inEl) return;
    const back=dir==="back";
    if(outEl){
      this.scrollPos[fromId]=window.scrollY||window.pageYOffset||0;
      outEl.classList.remove("on");
      outEl.classList.add("leaving");
      outEl.setAttribute("data-anim",back?"out-back":"out-fwd");
      this.afterAnim(outEl,()=>{ outEl.classList.remove("leaving"); outEl.removeAttribute("data-anim"); });
    }
    inEl.classList.add("on");
    inEl.setAttribute("data-anim",back?"in-back":"in-fwd");
    this.afterAnim(inEl,()=>inEl.removeAttribute("data-anim"));
    const y=back?(this.scrollPos[toId]||0):0;
    requestAnimationFrame(()=>window.scrollTo(0,y));
  },
  /* アニメーションの終わりを待つ。取りこぼしても必ず後始末が走るよう保険つき */
  afterAnim(el,fn){
    let done=false;
    const fin=()=>{ if(done) return; done=true; el.removeEventListener("animationend",h); fn(); };
    const h=e=>{ if(e.target===el) fin(); };
    el.addEventListener("animationend",h);
    setTimeout(fin,700);
  },
  /* 画面内の「戻る」。履歴が無ければタイトルへ */
  goBack(){
    if(this.nav.length>1){
      if(this.histOk){ history.back(); return; }
      this.show(this.nav[this.nav.length-2],{dir:"back"});
    }else this.show("title",{dir:"back"});
  },

  /* =======================================================================
     触り心地 — 波紋と触覚
     ======================================================================= */
  haptic(ms){
    if(Store.prefs.haptics===false) return;
    if(!navigator.vibrate) return;
    try{ navigator.vibrate(ms||8); }catch(e){}
  },
  ripple(el,x,y){
    if(!el||el.disabled) return;
    const r=el.getBoundingClientRect();
    if(!r.width) return;
    const d=Math.max(r.width,r.height)*2.1;
    const s=document.createElement("span");
    s.className="rip";
    s.style.width=s.style.height=d+"px";
    s.style.left=((x==null?r.width/2:x-r.left))+"px";
    s.style.top=((y==null?r.height/2:y-r.top))+"px";
    el.classList.add("rip-host");
    el.appendChild(s);
    const kill=()=>{ if(s.parentNode) s.parentNode.removeChild(s); };
    s.addEventListener("animationend",kill);
    setTimeout(kill,800);
  },
  /* 押した所に波紋を出し、対応端末なら軽く震わせる */
  bindTouchFeel(){
    const SEL="button,.btn,[role=button],.slot,.thumb,.skl,.tile,label.filebtn";
    document.addEventListener("pointerdown",ev=>{
      if(ev.button!==undefined&&ev.button!==0) return;
      const el=ev.target&&ev.target.closest?ev.target.closest(SEL):null;
      if(!el||el.disabled||el.hasAttribute("data-norip")) return;
      this.ripple(el,ev.clientX,ev.clientY);
      this.haptic(8);
    },{passive:true});
  },

  /* =======================================================================
     設定シート
     ======================================================================= */
  openSettings(){
    const on=k=>Store.prefs[k]!==false;
    const row=(id,title,sub,checked)=>`<label class="switchrow" for="${id}">
      <span class="sw-tx"><span class="sw-tl">${title}</span><span class="sw-ts">${sub}</span></span>
      <input class="switch" type="checkbox" id="${id}" ${checked?"checked":""}></label>`;
    const canVib=!!navigator.vibrate;
    this.openSheet("設定",
      `<div class="stack">
        ${row("set-haptics","触覚フィードバック",canVib?"操作したときに端末を軽く震わせます":"この端末は振動に対応していません",on("haptics")&&canVib)}
        ${row("set-sound","対戦BGM","戦闘中に相手のテーマ曲を鳴らします",!Store.prefs.muted)}
      </div>
      <div class="h-rule">ホーム画面に追加</div>
      <p class="note">ブラウザの共有メニューから「ホーム画面に追加」を選ぶと、アドレスバーのない全画面で遊べます。データは端末の中に残ります。</p>
      <div class="ver">覚醒 v${APP_VERSION}</div>`);
    const hap=$("#set-haptics");
    if(hap){
      hap.disabled=!canVib;
      hap.onchange=e=>{ Store.prefs.haptics=e.target.checked; Store.savePrefs(); this.haptic(14); };
    }
    const snd=$("#set-sound");
    if(snd) snd.onchange=()=>{ if(this.toggleMute) this.toggleMute(); };
  },

  /* =======================================================================
     共通パーツ
     ======================================================================= */
  avatar(c,size,cls){
    const inner = c.portraitImage
      ? `<img class="avimg" src="${c.portraitImage}" alt="">`
      : esc(c.portrait||"◆");
    return `<div class="av av-${size} ${cls||""}${c.portraitImage?" hasimg":""}">${inner}</div>`;
  },
  /* 立ち絵の小さい版（枠の中に置く用） */
  avatarMini(c){
    if(!c) return "＋";
    return c.portraitImage ? `<img src="${c.portraitImage}" alt="">` : esc(c.portrait||"◆");
  },
  /* 能力値の帯。幅ではなく scaleX で伸ばすのでレイアウトが走らない。
     vs を渡すと相手との差を右端に出す。 */
  statBars(c,vs){
    return ["hp","atk","def","spd"].map(k=>{
      const v=c.stats[k], pct=Math.max(.03,Math.min(1,v/STAT_MAX[k]));
      let diff="";
      if(vs&&vs.stats){
        const d=v-vs.stats[k];
        const cls=d>0?"up":(d<0?"dn":"eq");
        diff=`<span class="bd ${cls}">${d>0?"+"+d:(d<0?d:"±0")}</span>`;
      }else diff=`<span class="bd eq"></span>`;
      return `<div class="bar"><span class="bl">${STAT_LABEL[k]}</span>
        <span class="bt"><span class="bf" style="transform:scaleX(${pct.toFixed(3)})"></span></span>
        <span class="bv">${v}</span>${diff}</div>`;
    }).join("");
  },
  awakeningCard(c){
    const a=c.awakening&&c.awakening.enabled?c.awakening:null;
    if(!a) return `<div class="awk-card none"><div class="ah"><span class="ak">覚醒</span>
      <span class="an">なし</span></div></div>`;
    const cond=(a.conditions||[]).map(x=>esc(x.label)).join("<br>");
    const mode=(a.conditionMode==="ALL")?"すべて満たす":"どれか1つ";
    return `<div class="awk-card"><div class="ah"><span class="ak">覚醒</span>
        <span class="an">${esc(a.name||"")}</span></div>
      <div class="ab">
        <div class="arow"><span class="k">条件</span><span>${cond||"—"}<br>
          <span style="opacity:.7">（${mode}）</span></span></div>
        <div class="arow"><span class="k">代償</span><span>${esc((a.cost&&a.cost.label)||"なし")}</span></div>
      </div></div>`;
  },
  previewCard(c,opt){
    opt=opt||{};
    if(!c) return `<div class="note">キャラクターを選んでください。</div>`;
    const vs=(opt.vs&&opt.vs.id!==c.id)?opt.vs:null;
    const tags=[];
    if(c.custom) tags.push(`<span class="chip">自作</span>`);
    if(c.awakening&&c.awakening.enabled) tags.push(`<span class="chip gold">覚醒あり</span>`);
    if(c.bgm&&c.bgm!=="none"&&typeof BGM!=="undefined"&&BGM[c.bgm])
      tags.push(`<span class="chip">♪ ${esc(BGM[c.bgm].name)}</span>`);
    return `<div class="pv-head">${this.avatar(c,"84")}
      <div style="min-width:0"><div class="pv-name">${esc(c.name)}</div>
        <div class="pv-desc">${esc(c.description||"")}</div>
        <div class="pv-tags">${tags.join("")}</div></div></div>
      ${vs?`<div class="cmp-head"><span>能力値</span><span>${esc(vs.name)} との差</span></div>`:""}
      <div class="bars">${this.statBars(c,vs)}</div>
      ${this.awakeningCard(c)}`;
  },
  trayHtml(list,current){
    return list.map(c=>{
      const on=current===c.id;
      const awk=c.awakening&&c.awakening.enabled;
      return `<button class="thumb${on?" on":""}" data-id="${c.id}" aria-pressed="${on}">
        ${c.custom?`<span class="tag">自作</span>`:""}
        ${awk?`<span class="dot" aria-label="覚醒あり"></span>`:""}
        ${this.avatar(c,"56")}<span class="tn">${esc(c.name)}</span></button>`;
    }).join("");
  },
};
