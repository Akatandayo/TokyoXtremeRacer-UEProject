/* ===== UI：モード選択・編成（キャラクター選択） =====
   自作キャラクターが何十体も並ぶ前提で組む。
   上＝いま組んでいる対戦カード（比較）、下＝探して選ぶ一覧、最下段＝親指の届く主要操作。 */
Object.assign(UI, {
  selQuery:"", selTab:"all",

  /* ---------- モード別の準備画面 ---------- */
  openMode(mode){
    this.mode=mode;
    if(mode==="online"){ this.openOnline(); return; }
    this.mySide=0; this.slotFocus=0;
    const ai=mode==="ai";
    $("#select-title").textContent = ai ? "AI対戦の編成" : "編成";
    $("#who0").textContent = ai ? "あなた" : "プレイヤー1";
    $("#who1").textContent = ai ? "相手（AI）" : "プレイヤー2";
    this.initSelect();
    this.renderSelect();
    this.show("select");
  },

  /* 検索と絞り込みの配線は一度だけ。キャラクター一覧（担当Cの画面）と同じ言い回しに揃える */
  initSelect(){
    if(this._selectReady) return;
    this._selectReady=true;
    const q=$("#select-q");
    if(q) q.oninput=()=>{ this.selQuery=q.value.trim(); this.renderTray(); };
    const clr=$("#select-qclear");
    if(clr) clr.onclick=()=>{ this.selQuery=""; if(q){ q.value=""; q.focus(); } this.renderTray(); };
    $$("#select-tabs .fchip[data-tab]").forEach(b=>b.onclick=()=>{
      $$("#select-tabs .fchip[data-tab]").forEach(o=>{
        const on=o===b; o.classList.toggle("on",on); o.setAttribute("aria-pressed",String(on));
      });
      this.selTab=b.dataset.tab;
      this.haptic(6);
      this.renderTray();
    });
  },

  /* ---------- 一覧に出すキャラクター ---------- */
  selectList(){
    const q=this.selQuery.toLowerCase();
    const list=Object.values(CHARACTERS).filter(c=>{
      if(this.selTab==="mine"&&!c.custom) return false;
      if(this.selTab==="preset"&&c.custom) return false;
      if(this.selTab==="awake"&&!(c.awakening&&c.awakening.enabled)) return false;
      if(!q) return true;
      return (c.name+" "+(c.description||"")).toLowerCase().indexOf(q)>=0;
    });
    // 自分で作ったものを先に、その中では新しいものから
    const custom=list.filter(c=>c.custom).sort((a,b)=>String(b.id).localeCompare(String(a.id)));
    return custom.concat(list.filter(c=>!c.custom));
  },

  /* ---------- 画面全体 ---------- */
  renderSelect(){
    this.renderSlots();
    this.renderBoard();
    this.renderOptions();
    this.renderTray();
    this.renderDock();
  },

  /* 枠（どちらのキャラを選んでいるか） */
  renderSlots(){
    [0,1].forEach(i=>{
      const el=$("#slot"+i), c=this.pick[i]?CHARACTERS[this.pick[i]]:null;
      if(!el) return;
      const active=this.slotFocus===i;
      el.classList.toggle("active",active);
      el.classList.toggle("filled",!!c);
      el.setAttribute("aria-pressed",String(active));
      const who=$("#who"+i);
      el.setAttribute("aria-label",
        `${who?who.textContent:""}：${c?c.name:"未選択"}。押すとこちらを選びます`);
      const av=$("#sav"+i);
      if(av) av.innerHTML=this.avatarMini(c);
      const pick=el.querySelector(".pick");
      pick.textContent=c?c.name:"未選択";
      pick.classList.toggle("none",!c);
      const tag=$("#stag"+i);
      if(tag) tag.innerHTML=c?this.charTags(c):"";
    });
  },
  /* 自作か既定か、覚醒を持つか。編成でいちばん知りたい2つ */
  charTags(c){
    const t=[`<span class="chip ${c.custom?"vio":""}">${c.custom?"自作":"最初から"}</span>`];
    if(c.awakening&&c.awakening.enabled) t.push(`<span class="chip gold">覚醒</span>`);
    return t.join("");
  },

  /* 能力値の対面比較。左は右から、右は左から伸ばして中央で突き合わせる */
  renderBoard(){
    const a=this.pick[0]?CHARACTERS[this.pick[0]]:null;
    const b=this.pick[1]?CHARACTERS[this.pick[1]]:null;
    const stats=$("#select-stats"), foot=$("#select-foot");
    if(!a&&!b){
      if(stats) stats.innerHTML="";
      if(foot) foot.innerHTML="";
      $("#select-board").classList.remove("open");
      return;
    }
    $("#select-board").classList.add("open");
    if(stats) stats.innerHTML=["hp","atk","def","spd"].map(k=>this.cmpRow(k,a,b)).join("");
    if(foot){
      foot.innerHTML=`<button class="btn btn-line" id="btn-detail">
        <span class="ic" aria-hidden="true">◎</span>技と覚醒条件をくわしく見る</button>`;
      $("#btn-detail").onclick=()=>this.openDetail();
    }
  },
  cmpRow(k,a,b){
    const max=STAT_MAX[k];
    const av=a?a.stats[k]:null, bv=b?b.stats[k]:null;
    const w=(x,y)=>(x!=null&&y!=null&&x>y)?" win":"";
    const bar=(v,side)=>v==null
      ? `<span class="cb ${side}"></span>`
      : `<span class="cb ${side}"><i style="transform:scaleX(${Math.max(.03,Math.min(1,v/max)).toFixed(3)})"></i></span>`;
    return `<div class="cr">
      <span class="cv l${w(av,bv)}">${av==null?"—":av}</span>
      ${bar(av,"l")}
      <span class="ck">${STAT_LABEL[k]}</span>
      ${bar(bv,"r")}
      <span class="cv r${w(bv,av)}">${bv==null?"—":bv}</span></div>`;
  },

  /* 対戦の設定。組み合わせを選ぶ前に決めるものなので一覧より上に置く */
  renderOptions(){
    const opt=$("#select-options");
    if(!opt) return;
    if(this.mode==="ai"){
      opt.innerHTML=`<div class="optline">
        <span class="ol-t" id="ai-lv-label">AIの強さ</span>
        <div class="seg" role="group" aria-labelledby="ai-lv-label">`+
        Object.keys(AI.LEVELS).map(k=>`<button data-lv="${k}" class="${this.aiLevel===k?"on":""}"
          aria-pressed="${this.aiLevel===k}">${AI.LEVELS[k].label}</button>`).join("")+
        `</div></div>`;
      opt.querySelectorAll("[data-lv]").forEach(b=>b.onclick=()=>{
        this.aiLevel=b.dataset.lv;
        this.haptic(8);
        this.renderOptions();
      });
    }else{
      opt.innerHTML=`<label class="switchrow" for="opt-blind">
        <span class="sw-tx"><span class="sw-tl">コマンドを相手に見せない</span>
          <span class="sw-ts">交代のたびに目隠しをはさみます</span></span>
        <input class="switch" type="checkbox" id="opt-blind" ${this.blind?"checked":""}></label>`;
      $("#opt-blind").onchange=e=>{ this.blind=e.target.checked; this.haptic(8); };
    }
  },

  /* 一覧。件数が増えても札の大きさは変えず、探して絞る側で捌く */
  renderTray(){
    const list=this.selectList();
    const tray=$("#select-tray"), empty=$("#select-empty");
    const cnt=$("#select-count");
    const total=Object.keys(CHARACTERS).length;
    if(cnt) cnt.textContent=`${list.length}/${total}体`;
    const clr=$("#select-qclear");
    if(clr) clr.classList.toggle("on",!!this.selQuery);

    if(!list.length){
      tray.innerHTML="";
      empty.innerHTML=`<div class="empty">
        <div class="emo" aria-hidden="true">◇</div>
        <b>${this.selQuery||this.selTab!=="all"?"見つかりませんでした":"まだ誰もいません"}</b>
        <span>${this.selQuery||this.selTab!=="all"
          ? "言葉を変えるか、絞り込みを「すべて」に戻してください。"
          : "キャラクターを1体作るところから始まります。"}</span>
        <div class="em-act"><button class="btn btn-line" id="select-make">キャラクターを作る</button></div></div>`;
      $("#select-make").onclick=()=>{ if(this.renderRoster) this.renderRoster(); this.show("roster"); };
      return;
    }
    empty.innerHTML="";
    tray.innerHTML=list.map(c=>this.pickCard(c)).join("");
    tray.querySelectorAll(".thumb").forEach(b=>b.onclick=()=>this.tapPick(b.dataset.id));
  },
  /* 一覧の1枚。名前・自作か既定か・覚醒の有無・能力の当たりがこれだけで分かる */
  pickCard(c){
    const side=this.pick[0]===c.id?0:(this.pick[1]===c.id?1:-1);
    const awk=c.awakening&&c.awakening.enabled;
    const st=c.stats||{hp:0,atk:0,def:0,spd:0};
    const spark=["hp","atk","def","spd"].map(k=>
      `<i style="transform:scaleY(${Math.max(.08,Math.min(1,st[k]/STAT_MAX[k])).toFixed(3)})"></i>`).join("");
    return `<button class="thumb${side>=0?" on":""}" data-id="${c.id}" aria-pressed="${side>=0}"
      aria-label="${esc(c.name)}${c.custom?"、自作":"、最初から"}${awk?"、覚醒あり":""}">
      <span class="tag ${c.custom?"mine":"pre"}">${c.custom?"自作":"既定"}</span>
      ${awk?`<span class="dot" aria-hidden="true"></span>`:""}
      ${side>=0?`<span class="mark">${side===0?"1P":"2P"}</span>`:""}
      ${this.avatar(c,"56")}
      <span class="tn">${esc(c.name)}</span>
      <span class="tsp" aria-hidden="true">${spark}</span></button>`;
  },
  /* 選択状態だけを札に書き戻す。一覧ごと作り直すと押した札が消えて手応えが途切れる */
  syncTray(){
    $$("#select-tray .thumb").forEach(b=>{
      const id=b.dataset.id;
      const side=this.pick[0]===id?0:(this.pick[1]===id?1:-1);
      b.classList.toggle("on",side>=0);
      b.setAttribute("aria-pressed",String(side>=0));
      let m=b.querySelector(".mark");
      if(side>=0){
        if(!m){
          m=document.createElement("span");
          m.className="mark";
          b.insertBefore(m,b.querySelector(".av"));
        }
        m.textContent=side===0?"1P":"2P";
      }else if(m) m.remove();
    });
  },
  /* 札を押したとき。片方が空なら自動でもう一方の枠へ送る */
  tapPick(id){
    this.pick[this.slotFocus]=id;
    if(this.pick[1]===null) this.slotFocus=1;
    else if(this.pick[0]===null) this.slotFocus=0;
    this.haptic(12);
    this.renderSlots(); this.renderBoard(); this.syncTray(); this.renderDock();
  },
  /* 枠をつつく。一覧は組み直さない */
  focusSlot(i){
    this.slotFocus=i;
    this.haptic(8);
    this.renderSlots(); this.renderDock();
  },

  /* 最下段。何が足りないか／誰と誰が戦うのかを常に出しておく */
  renderDock(){
    const a=this.pick[0]?CHARACTERS[this.pick[0]]:null;
    const b=this.pick[1]?CHARACTERS[this.pick[1]]:null;
    const hint=$("#cta-hint");
    if(hint){
      if(a&&b) hint.innerHTML=`<b>${esc(a.name)}</b>　VS　<b>${esc(b.name)}</b>`;
      else if(a||b) hint.textContent=`${a?$("#who1").textContent:$("#who0").textContent}のキャラクターを選んでください`;
      else hint.textContent="上の枠を切り替えて、2人ぶん選びます";
    }
    $("#btn-start").disabled=!(a&&b);
  },

  /* ---------- くわしく（段階的開示） ---------- */
  openDetail(){
    const ids=[this.pick[0],this.pick[1]].filter(Boolean);
    if(!ids.length) return;
    const who=[$("#who0").textContent,$("#who1").textContent];
    const html=[this.pick[0],this.pick[1]].map((id,i)=>{
      if(!id) return "";
      return `<div class="dsec"><div class="h-rule">${esc(who[i])}</div>${this.detailCard(CHARACTERS[id])}</div>`;
    }).join("");
    this.openSheet("くわしく",html);
  },
  detailCard(c){
    const skl=(c.skills||[]).map(id=>SKILLS[id]).filter(Boolean);
    const form=c.awakening&&c.awakening.enabled&&c.awakening.form;
    const fskl=form?(form.skills||[]).map(id=>SKILLS[id]).filter(Boolean):[];
    const line=s=>`<div class="sline"><span class="sl-n">${esc(s.name)}</span>
      <span class="sl-m">${TYPE_LABEL[s.type]||"技"}${s.power>0?" / 威力"+s.power:""} / SP${s.cost}</span></div>`;
    return `<div class="pv-head">${this.avatar(c,"64")}
        <div style="min-width:0"><div class="pv-name">${esc(c.name)}</div>
          <div class="pv-desc">${esc(c.description||"")}</div>
          <div class="pv-tags">${this.charTags(c)}</div></div></div>
      <div class="bars">${this.statBars(c)}</div>
      ${this.awakeningCard(c)}
      <div class="h-rule">技</div>
      <div class="slines">${skl.length?skl.map(line).join(""):`<div class="note">技がありません。</div>`}</div>
      ${fskl.length?`<div class="h-rule">覚醒後の技</div><div class="slines">${fskl.map(line).join("")}</div>`:""}`;
  },

  /* 迷ったとき用。空いている枠をその場で埋める */
  randomPick(){
    const ids=this.selectList().map(c=>c.id);
    if(!ids.length){ if(Kit&&Kit.toast) Kit.toast("選べるキャラクターがいません。"); return; }
    const rnd=()=>ids[Math.floor(Math.random()*ids.length)];
    this.pick[this.slotFocus]=rnd();
    if(!this.pick[1-this.slotFocus]) this.pick[1-this.slotFocus]=rnd();
    this.haptic(16);
    this.renderSlots(); this.renderBoard(); this.syncTray(); this.renderDock();
  },
});
