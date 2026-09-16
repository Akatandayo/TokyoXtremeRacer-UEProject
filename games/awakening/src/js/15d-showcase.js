/* =========================================================================
   09e. Showcase — ウィザード最後の「完成の一枚」。
        立ち絵を2枚持てることがこのゲームで一番の見せ場なので、
        通常形態と覚醒形態を一枚の舞台の上で見比べられるようにする。
        斜めの境目を指で切り替えると、絵・名前・能力・技がまとめて入れ替わる。
   ========================================================================= */
Object.assign(Editor,{
  showForm:"both",                      // normal / both / awake

  /* 覚醒で見た目が変わるか。変わらないなら見比べの意味がないので出さない。 */
  facesDiffer(){
    const d=this.draft, a=d&&d.awakening, f=a&&a.form;
    if(!a||!a.enabled||!f) return false;
    if(f.portraitImage) return f.portraitImage!==d.portraitImage;
    if(d.portraitImage) return false;                       // 覚醒側だけ絵が無い＝同じ絵
    return !!(f.portrait&&f.portrait!==d.portrait);
  },
  /* 舞台に置く絵。立ち絵が無ければ大きな一文字を置く。 */
  artHtml(face){
    return face.portraitImage
      ? `<img src="${face.portraitImage}" alt="">`
      : `<span class="sc-glyph">${esc(face.portrait||"◆")}</span>`;
  },
  /* 斜めの切れ目。s=0 で覚醒側が隠れ、s=1 で覚醒側が全面に出る。 */
  splitPath(s){
    const x=120-140*Math.max(0,Math.min(1,s));
    return `polygon(${(x+10).toFixed(1)}% -2%, 102% -2%, 102% 102%, ${(x-10).toFixed(1)}% 102%)`;
  },
  splitOf(form){ return form==="awake"?1:(form==="both"?0.5:0); },

  /* 2つの形を重ねたレーダー。金が通常、朱が覚醒。 */
  radarPair(st,awk,size){
    const S=size||150, c=S/2, r=c-18, K=this.RADAR_KEYS;
    const at=(i,f)=>{ const a=-Math.PI/2+i*Math.PI/2, rr=r*f;
      return [c+Math.cos(a)*rr,c+Math.sin(a)*rr]; };
    const poly=o=>K.map((k,i)=>at(i,Math.max(.06,Math.min(1,(o[k]||0)/STAT_MAX[k])))
      .map(n=>n.toFixed(1)).join(",")).join(" ");
    const rings=[1,.66,.33].map(f=>
      `<polygon points="${K.map((k,i)=>at(i,f).map(n=>n.toFixed(1)).join(",")).join(" ")}" class="rr"/>`).join("");
    const axes=K.map((k,i)=>{ const p=at(i,1);
      return `<line x1="${c}" y1="${c}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" class="ra"/>`; }).join("");
    const labels=K.map((k,i)=>{ const p=at(i,1.2);
      return `<text x="${p[0].toFixed(1)}" y="${(p[1]+3.5).toFixed(1)}" class="rt">${STAT_LABEL[k]}</text>`; }).join("");
    return `<svg class="radar sc-radar" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img"
      aria-label="通常形態と覚醒形態の能力の形">${rings}${axes}
      ${awk?`<polygon points="${poly(awk)}" class="rw"/>`:""}
      <polygon points="${poly(st)}" class="rp"/>${labels}</svg>`;
  },

  /* 覚醒後の能力（HPは変わらない）。覚醒が無ければ null。 */
  awakenStats(){
    const d=this.draft, a=d.awakening;
    if(!a||!a.enabled) return null;
    return {hp:d.stats.hp,atk:a.form.stats.atk,def:a.form.stats.def,spd:a.form.stats.spd};
  },
  skillsOf(which){
    const d=this.draft, a=d.awakening;
    const ids=which==="awake"
      ? ((a.form.skills&&a.form.skills.length)?a.form.skills:d.skills)
      : d.skills;
    return ids.map(id=>SKILLS[id]).filter(Boolean);
  },

  /* ---------- 一枚を組み立てる ---------- */
  showcaseHtml(){
    const d=this.draft, a=d.awakening;
    const on=!!(a&&a.enabled);
    const two=this.facesDiffer();
    this.showForm=on?(two?"both":"normal"):"normal";
    const rank=this.rankOf(d.stats);
    const awk=this.awakenStats();
    const rows=["hp","atk","def","spd"].map(k=>{
      const base=d.stats[k], now=awk?awk[k]:base, dif=now-base;
      return `<div class="scr" data-k="${k}">
        <span class="scr-k">${STAT_LABEL[k]}</span>
        <span class="scr-n">${base}</span>
        <span class="scr-a">${on?`${now}${dif?`<em class="${dif>0?"up":"dn"}">${dif>0?"+":""}${dif}</em>`:`<em class="eq">±0</em>`}`:"—"}</span>
      </div>`;
    }).join("");
    return `<div class="showcase r-${rank.k}" id="e-show" data-f="${this.showForm}"
        style="--split:${this.splitOf(this.showForm)}">
      <div class="sc-stage" id="sc-stage">
        <div class="sc-art sc-n">${this.artHtml(d)}</div>
        <div class="sc-art sc-a" id="sc-a" style="clip-path:${this.splitPath(this.splitOf(this.showForm))}">
          ${this.artHtml(this.awakenFace())}</div>
        <i class="sc-seam" aria-hidden="true"></i>
        <i class="sc-flash" aria-hidden="true"></i>
        <div class="sc-vig" aria-hidden="true"></div>
        ${on?`<span class="sc-tag sc-tn">通常</span><span class="sc-tag sc-ta">覚醒</span>`:""}
        <div class="sc-id">
          <div class="rankbadge r-${rank.k}"><b>${rank.k}</b></div>
          <div class="sc-names"><b class="sc-name">${esc(d.name||"名もなき者")}</b>
            <i class="sc-sub">${esc(this.archetype(d.stats))}</i></div>
        </div>
      </div>
      ${on?`<div class="sc-seg" id="sc-seg" role="group" aria-label="見る形態">
        <button data-f="normal" class="${this.showForm==="normal"?"on":""}">通常</button>
        <button data-f="both" class="${this.showForm==="both"?"on":""}">見比べ</button>
        <button data-f="awake" class="${this.showForm==="awake"?"on":""}">覚醒</button>
      </div>`:""}
      <p class="sc-desc">${esc(d.description||"ひとことの説明はありません。")}</p>
      <div class="sc-mid">
        ${this.radarPair(d.stats,awk,150)}
        <div class="sc-stats">
          <div class="scr sc-head"><span class="scr-k"></span>
            <span class="scr-n">通常</span><span class="scr-a">覚醒</span></div>
          ${rows}
        </div>
      </div>
      <div class="sc-skills" id="sc-skills">${this.skillChipsHtml(this.showForm)}</div>
      ${on?`<div class="sc-awk">
        <div class="sa-h"><span>覚醒</span><b>${esc(a.name||"覚醒形態")}</b></div>
        <div class="sa-r"><span>開く条件</span><span>${esc(this.condLabel())}</span></div>
        <div class="sa-r"><span>代償</span><span>${esc(this.costLabel())}</span></div>
        ${two?`<div class="sa-r"><span>見た目</span><span>覚醒すると立ち絵が切り替わります</span></div>`
             :`<div class="sa-r"><span>見た目</span><span>通常と同じ絵のままです。「覚醒」の段で2枚目を決められます</span></div>`}
      </div>`:`<div class="sc-awk off">覚醒なし。追い詰められても姿は変わりません。</div>`}
    </div>`;
  },
  skillChipsHtml(form){
    const list=this.skillsOf(form==="awake"?"awake":"normal");
    const head=form==="awake"?"覚醒中に使える技":"通常形態で使う技";
    return `<div class="sk-h">${head}<em>${list.length}個</em></div>
      <div class="sk-c">${list.map(s=>
        `<span class="mchip t-${s.type}">${esc(s.name)}<em>SP${s.cost}</em></span>`).join("")||"<span class=\"mchip\">なし</span>"}</div>`;
  },

  /* ---------- 配線 ---------- */
  bindShowcase(){
    const box=$("#e-show");
    if(!box) return;
    const seg=$("#sc-seg");
    if(seg) seg.querySelectorAll("button").forEach(b=>b.onclick=()=>this.setForm(b.dataset.f));
    const stage=$("#sc-stage");
    if(stage&&seg) stage.onclick=()=>{
      /* 舞台をたたくと 通常 → 見比べ → 覚醒 と回る */
      const order=["normal","both","awake"];
      this.setForm(order[(order.indexOf(this.showForm)+1)%order.length]);
    };
    if(!Kit.reduced()){
      box.classList.remove("reveal"); void box.offsetWidth; box.classList.add("reveal");
      Kit.buzz([8,60,14]);
    }
  },
  setForm(f){
    const box=$("#e-show"), art=$("#sc-a");
    if(!box||!art) return;
    const prev=this.showForm;
    this.showForm=f;
    box.dataset.f=f;
    box.style.setProperty("--split",this.splitOf(f));
    art.style.clipPath=this.splitPath(this.splitOf(f));
    const seg=$("#sc-seg");
    if(seg) seg.querySelectorAll("button").forEach(b=>b.classList.toggle("on",b.dataset.f===f));
    const chips=$("#sc-skills");
    if(chips) chips.innerHTML=this.skillChipsHtml(f);
    const sub=box.querySelector(".sc-sub");
    if(sub) sub.textContent=f==="awake"
      ? (this.draft.awakening.name||"覚醒形態")
      : this.archetype(this.draft.stats);
    box.querySelectorAll(".scr").forEach(r=>r.classList.toggle("lit",f==="awake"));
    if(f!==prev){
      Kit.buzz(f==="awake"?[12,40,18]:8);
      if(f==="awake"&&!Kit.reduced()){
        box.classList.remove("burst"); void box.offsetWidth; box.classList.add("burst");
      }
    }
  }
});
