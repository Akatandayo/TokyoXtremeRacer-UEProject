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

  show(id){
    this.closeSheet();
    if(id!=="battle") Music.stop();
    $$(".screen").forEach(s=>s.classList.remove("on"));
    $("#s-"+id).classList.add("on");
    window.scrollTo(0,0);
  },

  /* ---------- 共通パーツ ---------- */
  avatar(c,size,cls){
    const inner = c.portraitImage
      ? `<img class="avimg" src="${c.portraitImage}" alt="">`
      : esc(c.portrait||"◆");
    return `<div class="av av-${size} ${cls||""}${c.portraitImage?" hasimg":""}">${inner}</div>`;
  },
  previewCard(c){
    if(!c) return `<div class="note">キャラクターを選んでください。</div>`;
    const a=c.awakening&&c.awakening.enabled?c.awakening:null;
    const bars=["hp","atk","def","spd"].map(k=>{
      const v=c.stats[k], pct=Math.min(100,v/STAT_MAX[k]*100);
      return `<div class="bar"><span class="bl">${k.toUpperCase()}</span>
        <span class="bt"><span class="bf" style="width:${pct}%"></span></span>
        <span class="bv">${v}</span></div>`;
    }).join("");
    return `<div class="pv-head">${this.avatar(c,"84")}
      <div><div class="pv-name">${esc(c.name)}</div><div class="pv-desc">${esc(c.description||"")}</div></div></div>
      <div class="bars">${bars}</div>
      ${a?`<div class="awk-note"><b>覚醒：${esc(a.name||"")}</b><br>
        条件：${esc((a.conditions||[]).map(x=>x.label).join(" または "))}<br>
        代償：${esc((a.cost&&a.cost.label)||"なし")}</div>`:""}`;
  },
  trayHtml(list,current){
    return list.map(c=>`<button class="thumb${current===c.id?" on":""}" data-id="${c.id}">
      ${this.avatar(c,"64")}<span class="tn">${esc(c.name)}</span></button>`).join("");
  },
};
