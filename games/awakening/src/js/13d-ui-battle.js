/* ===== UI：戦闘画面と結果 =====
   エンジンは触らない。engine.options(side) と engine.log のスナップショットを読むだけ。
   盤面は最初に一度だけ組み立て、以後は値の書き換えだけにして transform の transition を効かせる。 */
window.UI = UI;   // 検査スクリプト（tools/）から触れるように

Object.assign(UI, {
  /* 画面を揺らす強さ・数字の大きさ・ヒットストップの段階 */
  TIERS:[
    null,
    {sh:"sh1", s:0.92, stop:40,  vib:8},
    {sh:"sh2", s:1.12, stop:90,  vib:18},
    {sh:"sh3", s:1.38, stop:150, vib:[0,24,40,24]},
    {sh:"sh4", s:1.74, stop:230, vib:[0,34,50,34,60,34]}
  ],
  awkSeen:0,

  /* ---------- 戦闘開始 ---------- */
  startLocalOrAi(){
    Music.unlock();
    this.mySide=0;
    this.controllers=this.mode==="ai"?["local","ai"]:["local","local"];
    this.chars=[CHARACTERS[this.pick[0]],CHARACTERS[this.pick[1]]];
    this.startBattle(this.chars[0],this.chars[1],null,null);
  },
  applyPrefs(){
    if(this.SPEEDS[Store.prefs.speed]) this.speed=Store.prefs.speed;
    Music.setMuted(!!Store.prefs.muted);
    this.syncSpeed(); this.syncMute();
  },
  startBattle(charA,charB,seed,skills){
    const opts={};
    if(seed!=null) opts.seed=seed;
    if(skills) opts.skills=skills;
    this.engine=new BattleEngine(charA,charB,opts);
    this.acted=[false,false];
    this.prevSnap=this.engine.log[0].snap;
    this.unitBuilt=[false,false];
    this.chipSig=["",""];
    this.lastSp=[null,null];
    this.actorSide=null;
    this.guardShown=[false,false];
    this.bindBattle();
    this.clearFx();
    this.renderFighters();
    this.strip(this.engine.log.slice(-2));
    this.show("battle");
    this.applyPrefs();
    this.playBgm();
    this.beginInput();
  },
  /* 画面の常設ボタンは一度だけ結び付ける（16-boot.js が持たないぶん） */
  bindBattle(){
    if(this._battleBound) return;
    this._battleBound=true;
    const hist=$("#btn-loghist");
    if(hist) hist.onclick=()=>{ this.tick(); this.openLog(); };
    const ff=$("#ffcatch");
    if(ff) ff.onclick=()=>this.fastForward();
    const awk=$("#awk");
    if(awk) awk.onclick=()=>this.cutScene();
    const sk=$("#awk-skip");
    if(sk) sk.onclick=ev=>{ ev.stopPropagation(); this.cutScene(); };
  },
  clearFx(){
    $$("#arena .float,#arena .cue,#arena .gring,#arena .spark,#arena .statusburst,#arena .banner").forEach(el=>el.remove());
    ["sh1","sh2","sh3","sh4"].forEach(c=>$("#arena").classList.remove(c));
    $("#awk").classList.remove("on");
    $("#ffcatch").classList.remove("on");
  },

  /* 対戦相手のキャラクターに設定された曲を流す */
  playBgm(){
    const foe=this.chars[1-this.mySide]||{}, mine=this.chars[this.mySide]||{};
    const pick = (foe.bgmAudio||(foe.bgm&&foe.bgm!=="none")) ? foe : mine;
    Music.play(pick.bgm, pick.bgmAudio);
    this.syncMute();
    setTimeout(()=>this.syncMute(),400);
  },
  syncMute(){
    const b=$("#btn-mute");
    if(!b) return;
    const t=b.querySelector(".tl");
    b.classList.toggle("off",!!Music.muted);
    b.classList.toggle("hot",!Music.muted&&Music.blocked());
    if(t) t.textContent = Music.muted ? "OFF" : (Music.blocked()?"タップ":"ON");
    b.setAttribute("aria-label", Music.muted?"音を出す":"音を消す");
  },
  /* 画面を触ったら、鳴らせずに待っていた曲を拾う */
  nudgeMusic(){
    if(Music.muted) return;
    if(Music.blocked()||!Music.key){ Music.unlock(); }
    this.syncMute();
    setTimeout(()=>this.syncMute(),350);
  },
  toggleMute(){
    Music.setMuted(!Music.muted);
    Store.prefs.muted=Music.muted; Store.savePrefs();
    if(!Music.muted&&!Music.key&&$("#s-battle").classList.contains("on")) this.playBgm();
    this.syncMute();
    if(!Music.muted) Music.sfx("tap");
  },
  syncSpeed(){
    const b=$("#btn-speed");
    if(!b) return;
    const t=b.querySelector(".tl");
    if(t) t.textContent=this.SPEEDS[this.speed].label;
    b.setAttribute("aria-label","演出の速さ："+this.SPEEDS[this.speed].label);
  },
  cycleSpeed(){
    const keys=Object.keys(this.SPEEDS);
    this.speed=keys[(keys.indexOf(this.speed)+1)%keys.length];
    Store.prefs.speed=this.speed; Store.savePrefs();
    this.syncSpeed();
    this.tick();
  },
  /* 押した手応え（音と触覚）。設定でミュートなら音は出さない */
  tick(pattern){
    Music.sfx("tap");
    this.buzz(pattern||8);
  },
  buzz(p){
    try{ if(navigator.vibrate&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches) navigator.vibrate(p); }catch(e){}
  },

  /* ---------- 盤面 ---------- */
  sideOf(view){ return view===0 ? this.mySide : 1-this.mySide; },
  viewOf(side){ return side===this.mySide ? 0 : 1; },
  ownerLabel(side){
    if(this.mode==="local") return "プレイヤー"+(side+1);
    if(this.mode==="ai") return side===this.mySide?"あなた":"AI（"+AI.LEVELS[this.aiLevel].label+"）";
    return side===this.mySide?"あなた":"相手";
  },
  /* 覚醒条件のうち「HPが◯%以下」のラインを返す（無ければ null） */
  awakenLine(f){
    const a=f.char&&f.char.awakening;
    if(!a||!a.enabled) return null;
    const c=(a.conditions||[]).find(x=>x.type==="HP_BELOW");
    return c?c.value:null;
  },
  buildUnit(view){
    const host=$("#view"+view);
    host.innerHTML=`
      <div class="avwrap" data-av></div>
      <div class="info">
        <span class="owner" data-owner></span>
        <div class="nmrow"><span class="nm" data-nm></span><span data-badges></span></div>
        <div class="hpline">
          <div class="hpbar"><div class="hpchip" data-chip></div><div class="hpfill" data-fill></div></div>
          <div class="hpmark" data-mark hidden></div>
          <div class="hpnum" data-num></div>
        </div>
        <div class="spline"><span class="splabel">SP <b data-spn></b></span><div class="spbar" data-sp></div></div>
        <div class="chips" data-chips></div>
      </div>`;
    this.unitBuilt[view]=true;
  },
  renderFighters(snap,turn){
    const e=this.engine;
    const now=snap||e.snapshot();
    [0,1].forEach(view=>{
      const side=this.sideOf(view);
      if(!this.unitBuilt[view]) this.buildUnit(view);
      this.updateUnit(view,e.fighters[side],now[side],side);
    });
    $("#turn-label").textContent="ターン "+(turn||this.engine.turn);
  },
  updateUnit(view,f,s,side){
    const host=$("#view"+view);
    const q=k=>host.querySelector("[data-"+k+"]");
    const awake=s.form==="AWAKENED";
    host.className="unit"+(view===1?" foe":"")+(s.hp<=0?" down":"");

    const avCls=(view===1?"foe":"me")+(awake?" awake":"");
    if(host._av!==avCls+"|"+(f.portraitImage||f.portrait)){
      host._av=avCls+"|"+(f.portraitImage||f.portrait);
      q("av").innerHTML=this.avatar(f,"84",avCls);
    }
    const owner=this.ownerLabel(side);
    if(q("owner").textContent!==owner) q("owner").textContent=owner;
    if(q("nm").textContent!==f.name) q("nm").textContent=f.name;

    const badges=(awake?`<span class="badge b-gold">${esc(s.formName||"覚醒")}</span>`:"")
      +(s.awaken==="AVAILABLE"?`<span class="badge b-gold b-pulse">覚醒可能</span>`:"")
      +(s.defending?`<span class="badge b-jade">防御</span>`:"");
    if(q("badges").innerHTML!==badges) q("badges").innerHTML=badges;

    // HP：scaleX だけで伸縮させる。削れ跡は CSS の transition-delay で遅れて追う
    const p=Math.max(0,Math.min(1,s.hp/s.maxHp));
    const fill=q("fill"), chip=q("chip");
    fill.style.setProperty("--p",p);
    chip.style.setProperty("--pg",p);
    const tone = awake?"awake" : p>0.55?"" : p>0.3?"mid" : p>0.15?"low":"crisis";
    const fc="hpfill"+(tone?" "+tone:"");
    if(fill.className!==fc) fill.className=fc;

    const line=this.awakenLine(f);
    const mark=q("mark");
    if(line!=null&&s.awaken!=="ACTIVE"&&s.awaken!=="SPENT"&&s.awaken!=="NONE"){
      mark.hidden=false;
      mark.classList.toggle("done",s.awaken==="AVAILABLE");
      mark.style[view===1?"right":"left"]=(line*100)+"%";
      mark.style[view===1?"left":"right"]="auto";
      mark.title="覚醒ライン";
    }else mark.hidden=true;

    const num=q("num");
    const lost=s.maxHp-s.hp;
    num.innerHTML=`<span>HP</span><span><b>${s.hp}</b> / ${s.maxHp}${lost?` <span class="dmgd">−${lost}</span>`:""}</span>`;

    const spn=q("spn");
    if(spn.textContent!==String(s.sp)) spn.textContent=s.sp;
    const spbox=q("sp");
    const prevSp=this.lastSp[view];
    if(spbox.childElementCount!==BALANCE.sp.max){
      spbox.innerHTML=Array.from({length:BALANCE.sp.max},()=>`<span class="pip"></span>`).join("");
    }
    Array.from(spbox.children).forEach((pip,k)=>{
      const on=k<s.sp;
      if(pip.classList.contains("on")!==on) pip.className="pip"+(on?" on":"");
      if(on&&prevSp!=null&&k>=prevSp){ pip.classList.remove("fresh"); void pip.offsetWidth; pip.classList.add("fresh"); }
    });
    this.lastSp[view]=s.sp;

    const sig=s.effects.map(x=>x.name+x.duration).join("|");
    if(this.chipSig[view]!==sig){
      const old=this.chipSig[view];
      this.chipSig[view]=sig;
      q("chips").innerHTML=s.effects.map(x=>{
        const d=x.duration>=BALANCE.permanentDuration?"∞":(x.duration>1?x.duration:"");
        const isNew=old.indexOf(x.name)<0;
        return `<span class="chip ${effTone(x)}${isNew?" new":""}"><span class="ci">${effIcon(x)}</span>${esc(x.name)}${d?" "+d:""}</span>`;
      }).join("");
    }
  },

  /* ---------- 演出の部品 ---------- */
  tierOf(pct){ return pct<0.05?1 : pct<0.11?2 : pct<0.2?3 : 4; },
  shake(tier){
    const a=$("#arena");
    ["sh1","sh2","sh3","sh4"].forEach(c=>a.classList.remove(c));
    void a.offsetWidth;
    a.classList.add(this.TIERS[tier].sh);
  },
  flash(kind){
    const el=$("#hitflash");
    el.className="";
    void el.offsetWidth;
    el.className=(kind||"")+" on";
    setTimeout(()=>{ el.className=""; },360);
  },
  fx(view,cls,life){
    const wrap=$("#view"+view).querySelector(".avwrap");
    if(!wrap) return null;
    const d=document.createElement("div");
    d.className=cls;
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),life||700);
    return d;
  },
  /* ダメージ／回復の数字 */
  popNumber(view,delta,o){
    o=o||{};
    const host=$("#view"+view);
    const wrap=host.querySelector(".avwrap");
    if(!wrap) return;
    const heal=delta>0;
    const tier=o.tier||1;
    let cls="float"+(heal?" heal":"")+(o.crit?" crit":"")+(o.counter?" counter":"")+(o.cost?" cost":"");
    const d=document.createElement("div");
    d.className=cls;
    const scale=(heal?1:this.TIERS[tier].s)*(o.crit?1.22:1);
    d.style.setProperty("--s",Math.round(scale*100)/100);
    const tag=o.crit?"CRITICAL":o.counter?"COUNTER":o.cost?"代償":"";
    d.innerHTML=(tag?`<span class="tag">${tag}</span>`:"")+(heal?"+":"−")+Math.abs(delta);
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),1100);
    if(!heal){
      host.classList.remove("hurt","big"); void host.offsetWidth;
      host.classList.add("hurt"); if(tier>=3) host.classList.add("big");
      setTimeout(()=>host.classList.remove("hurt","big"),520);
      this.fx(view,"spark"+(o.crit?" crit":o.counter?" counter":""),400);
    }
  },
  /* 数字を伴わない合図（回避・防御・状態異常・無効化） */
  cue(view,text,cls){
    const host=$("#view"+view);
    const wrap=host.querySelector(".avwrap");
    if(!wrap) return;
    const d=document.createElement("div");
    d.className="cue "+(cls||"");
    d.textContent=text;
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),780);
  },
  actAnim(side){
    if(side==null) return;
    const host=$("#view"+this.viewOf(side));
    host.classList.remove("act"); void host.offsetWidth; host.classList.add("act");
    setTimeout(()=>host.classList.remove("act"),500);
  },
  /* ログの文からどちらの話かを推測する（エンジンは側を持たないため） */
  sideFromText(text,fallback){
    const n=[this.engine.fighters[0].name,this.engine.fighters[1].name];
    if(n[0]!==n[1]){
      const i0=text.indexOf(n[0]), i1=text.indexOf(n[1]);
      if(i0===0&&i1!==0) return 0;
      if(i1===0&&i0!==0) return 1;
      if(i0>=0&&i1<0) return 0;
      if(i1>=0&&i0<0) return 1;
    }
    return fallback==null?null:fallback;
  },

  /* ---------- 入力 ---------- */
  beginInput(){
    if(this.engine.over) return;
    this.acted=[false,false];
    this.guardShown=[false,false];
    $("#phase-label").textContent="";
    this.localSides=[0,1].filter(s=>this.controllers[s]==="local");
    this.li=0;
    [0,1].forEach(s=>{
      if(this.controllers[s]==="ai"){
        setTimeout(()=>{ if(this.engine&&!this.acted[s]&&!this.engine.over)
          this.submitSide(s,AI.choose(this.engine,s,this.aiLevel)); },700);
      }
      if(this.controllers[s]==="remote"){
        const buf=this.remoteBuf[this.engine.turn];
        if(buf){ delete this.remoteBuf[this.engine.turn]; this.submitSide(s,buf); }
      }
    });
    if(this.mode==="online") this.startResend();
    this.nextLocal();
  },
  nextLocal(){
    if(this.li>=this.localSides.length){ this.waitRemote(); return; }
    const side=this.localSides[this.li];
    if(this.mode==="local"&&this.blind) this.showVeil(side);
    else this.renderCommand(side);
  },
  /* ローカル対戦：端末を渡すあいだの目隠し */
  showVeil(side){
    const f=this.engine.fighters[side];
    const s=this.engine.snapshot()[side];
    $("#veil-badge").textContent="P"+(side+1);
    $("#veil-badge").className="veil-badge"+(side===1?" p2":"");
    $("#veil-title").textContent=`プレイヤー${side+1} の番`;
    $("#veil-av").innerHTML=this.avatar(f,"64",side===1?"foe":"me");
    const chips=s.effects.slice(0,3).map(x=>
      `<span class="chip ${effTone(x)}"><span class="ci">${effIcon(x)}</span>${esc(x.name)}</span>`).join("");
    $("#veil-meta").innerHTML=`<div class="vn">${esc(f.name)}</div>
      <div class="vstat"><span class="chip">HP ${s.hp}/${s.maxHp}</span><span class="chip">SP ${s.sp}</span>
      ${s.awaken==="AVAILABLE"?`<span class="chip gold">覚醒できる</span>`:""}${chips}</div>`;
    $("#veil-sub").textContent="相手に画面を見られないように端末を渡してください。受け取ったら下のボタンを押すとコマンドが出ます。";
    $("#veil").classList.add("on");
    $("#veil-ok").onclick=()=>{
      this.tick();
      $("#veil").classList.remove("on");
      this.renderCommand(side);
    };
  },
  waitRemote(){
    if(this.acted[0]&&this.acted[1]) return;
    const who=this.mode==="ai"?"AI":"相手";
    $("#cmd-area").className="dock";
    $("#cmd-area").innerHTML=`<div class="waiting"><div class="thinking"><i></i><i></i><i></i></div>
      <div>${who}が考えています</div><div class="wsub">まもなく結果が出ます</div></div>`;
  },
  /* 技ボタン1つぶんの中身。押す前にコスト・残り回数・使えない理由が読めるようにする */
  skillButton(x,i,side){
    const s=x.skill;
    const me=this.engine.fighters[side], foe=this.engine.foe(side);
    const cost = x.variable ? `SP ${s.cost}〜${x.maxSpend}` : (s.cost?`SP ${s.cost}`:"SP 0");
    const bits=[];
    if(x.usable){
      const eff=x.variable?BattleEngine.effectiveSkill(s,x.maxSpend):s;
      const dmg=Math.round(this.engine.preview(me,foe,eff));
      if(dmg>0) bits.push(`<span class="sx">目安 ${dmg}${s.hits>1?"×"+s.hits:""}</span>`);
      else if(s.healPercent) bits.push(`<span class="sx">回復 ${s.healPercent}%</span>`);
      else if((s.effects||[]).length) bits.push(`<span class="sx">${effIcon(s.effects[0])} ${esc(s.effects[0].name)}</span>`);
      if(s.priority) bits.push(`<span class="sx hot">先制</span>`);
      else if(s.guardBreak) bits.push(`<span class="sx hot">防御貫通</span>`);
      if(/^残り/.test(x.reason||"")) bits.push(`<span class="sx hot">${esc(x.reason)}</span>`);
      else if(s.oncePerBattle) bits.push(`<span class="sx hot">1回だけ</span>`);
    }else{
      bits.push(`<span class="why">${esc(x.reason||"使えない")}</span>`);
    }
    return `<button class="sbtn t-${s.type}${x.usable?"":" no"}" data-cmd="SKILL" data-i="${i}" ${x.usable?"":"disabled"}>
      <span class="sn">${esc(s.name)}</span>
      <span class="srow"><span class="sp${s.cost?"":" free"}">${cost}</span>${bits.slice(0,2).join("")}</span></button>`;
  },
  renderCommand(side){
    const o=this.engine.options(side);
    const f=this.engine.fighters[side];
    $("#phase-label").textContent=this.mode==="local"?`P${side+1} の入力`:"コマンドを選ぶ";
    const pips=Array.from({length:BALANCE.sp.max},(_,k)=>`<span class="pip${k<f.sp?" on":""}"></span>`).join("");
    const alerts=[];
    if(o.silenced) alerts.push("沈黙中：技が使えない");
    if(Effects.has(f,"CONFUSE")) alerts.push("混乱：自分を殴ることがある");
    const area=$("#cmd-area");
    area.className="dock arm";
    area.innerHTML=`
      <div class="dock-head">
        <span class="dock-who">${esc(this.ownerLabel(side))}</span>
        ${alerts.length?`<span class="dock-alert">${esc(alerts[0])}</span>`:""}
        <span class="dock-sp"><span class="sl">SP</span><b>${f.sp}</b><span class="sl">/${BALANCE.sp.max}</span>
          <span class="spbar">${pips}</span></span>
        <button class="tool" data-cmd="INFO" aria-label="能力値と覚醒条件を見る"><span class="ti">☰</span><span class="tl">状況</span></button>
      </div>
      <div class="skl-grid">${o.skills.map((x,i)=>this.skillButton(x,i,side)).join("")}</div>
      <div class="cmd-grid">
        <button class="cbtn attack" data-cmd="ATTACK"><span class="ci">⚔</span>
          <span class="cl">攻撃<span class="cs">SPを使わない</span></span></button>
        <button class="cbtn defend" data-cmd="DEFEND"><span class="ci">⛊</span>
          <span class="cl">防御<span class="cs">被ダメ半減・SP+${BALANCE.sp.defendBonus}</span></span></button>
        ${o.canAwaken?`<button class="cbtn wide awaken" data-cmd="AWAKEN">
          <span class="cl">覚 醒<span class="cs">${esc((f.char.awakening&&f.char.awakening.name)||"形態を変える")}</span></span></button>`:""}
      </div>`;
    // 直前の演出のタップが残って誤爆しないよう、少しのあいだ受け付けない
    setTimeout(()=>area.classList.remove("arm"),240);
    area.querySelectorAll("[data-cmd]").forEach(b=>{
      b.onclick=()=>{
        const c=b.dataset.cmd;
        Music.unlock();
        if(c==="INFO"){ this.tick(); this.openInfo(side); return; }
        if(c==="SKILL"){ this.pickSkill(side,o.skills[+b.dataset.i]); return; }
        if(c==="AWAKEN"){ this.tick(16); this.confirmAwaken(side); return; }
        this.tick(12);
        this.choose(side,{type:c});
      };
    });
  },
  /* 技を押したとき：可変SPなら量を、最後の1回なら念のため確認を挟む */
  pickSkill(side,x){
    if(!x||!x.usable) return;
    this.tick(12);
    const s=x.skill;
    if(x.variable&&x.maxSpend>s.cost){ this.chooseSpend(side,x); return; }
    const last = s.oncePerBattle || (s.uses&&/^残り1回$/.test(x.reason||""));
    if(last){ this.confirmSkill(side,x); return; }
    this.choose(side,{type:"SKILL",skillId:s.id});
  },
  confirmSkill(side,x){
    const s=x.skill;
    const me=this.engine.fighters[side], foe=this.engine.foe(side);
    const dmg=Math.round(this.engine.preview(me,foe,s));
    this.openSheet("この技でいい？",
      `<div class="confirm">
        <div class="cf-lead">この戦闘では<b>もう使えなくなります</b>。</div>
        <div class="cf-name">${esc(s.name)}</div>
        <div class="cf-list">${esc(s.description||"")}${dmg>0?`<br>目安ダメージ <b>${dmg}</b>`:""}<br>消費 SP <b>${s.cost}</b></div>
        <button class="btn btn-gold" id="cf-ok">これで行く</button>
        <div style="height:9px"></div>
        <button class="btn btn-line" id="cf-no">やめる</button>
      </div>`);
    $("#cf-ok").onclick=()=>{ this.tick(16); this.closeSheet(); this.choose(side,{type:"SKILL",skillId:s.id}); };
    $("#cf-no").onclick=()=>{ this.tick(); this.closeSheet(); };
  },
  /* 覚醒は取り返しがつかないので、何が起きるかを見せてから切らせる */
  confirmAwaken(side){
    const f=this.engine.fighters[side];
    const a=f.char.awakening||{}, form=a.form||{};
    const st=form.stats?["atk","def","spd"].filter(k=>form.stats[k]!=null)
      .map(k=>`${k.toUpperCase()} ${f.base[k]}→<b>${form.stats[k]}</b>`).join("　"):"";
    const sk=(form.skills||[]).map(id=>(this.engine.SK[id]||{}).name).filter(Boolean).join("／");
    this.openSheet("覚醒する？",
      `<div class="confirm">
        <div class="cf-lead">切れるのは一度きり。押すと今ターンの行動は覚醒になります。</div>
        <div class="cf-name">${esc(a.name||"覚醒")}</div>
        <div class="cf-list">
          ${st?`能力 ${st}<br>`:""}
          ${sk?`技 <b>${esc(sk)}</b><br>`:""}
          ${a.duration?`持続 <b>${a.duration}ターン</b><br>`:""}
          <span class="cf-warn">代償：${esc((a.cost&&a.cost.label)||"なし")}</span>
        </div>
        <button class="btn btn-gold" id="cf-ok">覚醒する</button>
        <div style="height:9px"></div>
        <button class="btn btn-line" id="cf-no">まだ切らない</button>
      </div>`);
    $("#cf-ok").onclick=()=>{ this.tick([0,18,30,18]); this.closeSheet(); this.choose(side,{type:"AWAKEN"}); };
    $("#cf-no").onclick=()=>{ this.tick(); this.closeSheet(); };
  },

  /* ---------- ボトムシート ---------- */
  openSheet(title,html){
    $("#sheet-title").textContent=title;
    $("#sheet-body").innerHTML=html;
    $("#sheet").classList.add("on"); $("#scrim").classList.add("on");
  },
  closeSheet(){
    $("#sheet").classList.remove("on"); $("#scrim").classList.remove("on");
  },
  skillCardHtml(x,i){
      const s=x.skill;
      const meta=[`<span class="mchip">${TYPE_LABEL[s.type]||"技"}</span>`];
      if(s.power>0) meta.push(`<span class="mchip">威力 ${s.power}${s.hits>1?"×"+s.hits:""}</span>`);
      meta.push(`<span class="mchip">命中 ${s.accuracy}%</span>`);
      if(s.priority) meta.push(`<span class="mchip hot">優先度 ${s.priority}</span>`);
      if(s.guardBreak) meta.push(`<span class="mchip hot">防御貫通</span>`);
      if(s.buffPierce) meta.push(`<span class="mchip hot">バフ貫通</span>`);
      if(s.healPercent) meta.push(`<span class="mchip">回復 ${s.healPercent}%</span>`);
      if(s.drain) meta.push(`<span class="mchip">吸収 ${Math.round(s.drain*100)}%</span>`);
      if(s.varyPercent) meta.push(`<span class="mchip">ばらつき ±${s.varyPercent}%</span>`);
      if(s.costMax) meta.push(`<span class="mchip hot">SP1ごとに威力+${s.powerPerSp||0}${s.durationPerSp?" 持続+"+s.durationPerSp:""}</span>`);
      (s.effects||[]).forEach(e=>meta.push(`<span class="mchip">${effIcon(e)} ${esc(e.name)}${e.chance!=null?" "+Math.round(e.chance*100)+"%":""}</span>`));
      const costText=x.usable
        ? ("SP "+(x.variable?s.cost+"〜"+s.costMax:s.cost)+(x.reason?" ／ "+x.reason:""))
        : x.reason;
      return `<button class="skl t-${s.type}" data-i="${i}" ${x.usable?"":"disabled"}>
        <span class="top"><span class="snm">${esc(s.name)}</span>
        <span class="cost${x.usable?"":" no"}">${costText}</span></span>
        <div class="sds">${esc(s.description||"")}</div>
        <div class="meta">${meta.join("")}</div></button>`;
  },
  openSkills(side){
    const o=this.engine.options(side);
    const html=`<div class="skill-list">`+o.skills.map((x,i)=>this.skillCardHtml(x,i)).join("")+`</div>`;
    this.openSheet("技をえらぶ",html);
    $("#sheet-body").querySelectorAll(".skl").forEach(b=>{
      b.onclick=()=>{
        const x=o.skills[+b.dataset.i];
        if(x.variable&&x.maxSpend>x.skill.cost) this.chooseSpend(side,x);
        else { this.closeSheet(); this.choose(side,{type:"SKILL",skillId:x.skill.id}); }
      };
    });
  },
  /* 可変SPの技：いくら注ぎ込むかを選ぶ */
  chooseSpend(side,x){
    const me=this.engine.fighters[side], foe=this.engine.foe(side);
    const list=[];
    for(let sp=x.skill.cost; sp<=x.maxSpend; sp++){
      const eff=BattleEngine.effectiveSkill(x.skill,sp);
      const dmg=Math.round(this.engine.preview(me,foe,eff));
      list.push(`<button class="skl t-${x.skill.type}" data-sp="${sp}">
        <span class="top"><span class="snm">SP ${sp} で放つ</span>
        <span class="cost">${dmg>0?"目安 "+dmg:"効果強化"}</span></span>
        <div class="meta">${eff.power?`<span class="mchip">威力 ${eff.power}${eff.hits>1?"×"+eff.hits:""}</span>`:""}
        ${(eff.effects||[]).map(e=>`<span class="mchip">${effIcon(e)} ${esc(e.name)} ${e.duration}T</span>`).join("")}
        <span class="mchip">残SP ${me.sp-sp}</span></div></button>`);
    }
    this.openSheet(x.skill.name+"：SPを決める",
      `<div class="skill-list">${list.join("")}</div>
       <div style="height:9px"></div><button class="btn btn-line" id="spend-back">やめる</button>`);
    $("#sheet-body").querySelectorAll("[data-sp]").forEach(b=>{
      b.onclick=()=>{ this.tick(14); this.closeSheet(); this.choose(side,{type:"SKILL",skillId:x.skill.id,spend:+b.dataset.sp}); };
    });
    $("#spend-back").onclick=()=>{ this.tick(); this.closeSheet(); };
  },
  openInfo(side){
    const f=this.engine.fighters[side], a=f.char.awakening;
    const o=this.engine.options(side);
    const st=["atk","def","spd"].map(k=>`<span class="mchip">${k.toUpperCase()} ${Effects.stat(f,k)}</span>`).join("");
    let aw="覚醒なし";
    if(a&&a.enabled){
      const state={LOCKED:"条件未達成",AVAILABLE:"いつでも覚醒できる",ACTIVE:`覚醒中（残り${f.awaken.turnsLeft}ターン）`,SPENT:"使用済み"}[f.awaken.state]||"";
      aw=`<b>${esc(a.name||"覚醒")}</b>：${state}<br>条件（${a.conditionMode==="ALL"?"すべて":"いずれか"}）：${esc((a.conditions||[]).map(c=>c.label).join(" ／ "))}<br>代償：${esc((a.cost&&a.cost.label)||"なし")}`;
    }
    const chips=f.effects.map(e=>`<span class="chip ${effTone(e)}"><span class="ci">${effIcon(e)}</span>${esc(e.name)}（${e.duration>=BALANCE.permanentDuration?"永続":"残"+e.duration}）</span>`).join("");
    this.openSheet(f.name+" の状況",
      `<div class="meta" style="display:flex;gap:5px;flex-wrap:wrap">${st}<span class="mchip">HP ${f.hp}/${f.maxHp}</span><span class="mchip">SP ${f.sp}/${BALANCE.sp.max}</span></div>
       <div class="awk-note" style="margin-top:12px">${aw}</div>
       ${chips?`<div class="chips" style="margin-top:12px">${chips}</div>`:`<p class="note" style="margin-top:12px">かかっている効果はありません。</p>`}
       <div class="h-rule">技のくわしい内容</div>
       <div class="skill-list">${o.skills.map((x,i)=>this.skillCardHtml(x,i)).join("")}</div>`);
    $("#sheet-body").querySelectorAll(".skl").forEach(b=>{ b.disabled=true; });
  },
  logTap(){ if(!this.fastForward()){ this.tick(); this.openLog(); } },
  openLog(){
    let turn=null, html="";
    this.engine.log.forEach(e=>{
      if(e.turn!==turn){ turn=e.turn; html+=`<div class="lg-t">ターン ${turn}</div>`; }
      if(e.kind==="turn") return;
      html+=`<div class="le ${e.kind}">${esc(e.text)}</div>`;
    });
    this.openSheet("戦闘ログ",`<div class="logfull">${html}</div>`);
    const box=$("#sheet-body").querySelector(".logfull");
    box.scrollTop=box.scrollHeight;
  },
  strip(entries){
    const box=$("#logstrip");
    const last=entries.filter(e=>e.kind!=="turn").slice(-2);
    const show=last.length?last:entries.slice(-1);
    box.innerHTML=show.map((e,i)=>`<div class="ll ${e.kind}${i===0&&show.length>1?" old":""}">${esc(e.text)}</div>`).join("");
  },

  choose(side,action){
    this.li++;
    if(this.mode==="online"){
      const t=this.engine.turn;
      this.sentActions=this.sentActions||{};
      this.sentActions[t]=action;
      Object.keys(this.sentActions).forEach(k=>{ if(+k<t-4) delete this.sentActions[k]; });
      Net.send({t:"act",turn:t,action});
      this.startResend();
    }
    this.submitSide(side,action,true);
  },
  submitSide(side,action,fromLocal){
    if(this.acted[side]||!this.engine||this.engine.over) return;
    this.engine.submit(side,action);
    this.acted[side]=true;
    if(this.acted[0]&&this.acted[1]){ this.stopResend(); this.resolve(); return; }
    if(fromLocal) this.nextLocal();
    else if(this.li>=this.localSides.length) this.waitRemote();
  },

  /* ---------- 解決 ---------- */
  resolve(){
    $("#veil").classList.remove("on");
    this.closeSheet();
    $("#phase-label").textContent="タップで早送り";
    $("#cmd-area").className="dock";
    $("#cmd-area").innerHTML=`<div class="waiting"><div class="thinking"><i></i><i></i><i></i></div>
      <div>行動を処理しています</div><div class="wsub">画面をタップすると一気に送れます</div></div>`;
    $("#ffcatch").classList.add("on");
    const entries=this.engine.resolveTurn();
    this.playing=true; this.skip=false;
    this.actorSide=null;
    const k=this.SPEEDS[this.speed].k;
    let i=0;
    const shown=[];
    /* 途中で打ち切れるよう、待ち時間はここで一元管理する */
    const later=(ms,fn)=>{
      clearTimeout(this._t);
      this._advance=()=>{ clearTimeout(this._t); this._advance=null; fn(); };
      this._t=setTimeout(()=>{ this._advance=null; fn(); },Math.max(0,ms));
    };
    const step=()=>{
      if(i>=entries.length){
        this.playing=false; this._advance=null;
        $("#ffcatch").classList.remove("on");
        this.prevSnap=this.engine.snapshot();
        this.renderFighters();
        if(this.engine.over) this.finish();
        else { $("#phase-label").textContent=""; this.beginInput(); }
        return;
      }
      const e=entries[i++];
      shown.push(e); this.strip(shown);
      if(e.actor!=null) this.actorSide=e.actor;
      const extra=this.playEntry(e);
      this.prevSnap=e.snap;
      this.renderFighters(e.snap,e.turn);

      let wait=400;
      if(e.kind==="turn"){ if(!this.skip) this.banner(e.text); wait=560; }
      if(e.kind==="miss"||e.kind==="sys"||e.kind==="status") wait=320;
      if(e.kind==="action") wait=360;
      if(e.kind==="win") wait=700;
      const isAwk=(e.kind==="awaken"&&e.text.indexOf("AWAKENING")>=0);
      let ms;
      if(isAwk){
        ms=this.skip?140:this.awakenFlash(e.text);
      }else if(this.skip){
        ms=14;
      }else{
        ms=Math.round(wait*k)+Math.round(extra*Math.min(1,k+0.35));
      }
      later(ms,step);
    };
    step();
  },
  /* 1行ぶんの演出。返り値はヒットストップ（追加で待つミリ秒） */
  playEntry(e){
    let stop=0;
    const prev=this.prevSnap;
    [0,1].forEach(side=>{
      const before=prev[side].hp, after=e.snap[side].hp;
      if(before===after) return;
      const view=this.viewOf(side);
      const delta=after-before;
      if(delta>0){
        if(!this.skip){ this.popNumber(view,delta); this.flash("heal"); Music.sfx("heal"); }
        return;
      }
      const amount=-delta;
      const tier=this.tierOf(amount/Math.max(1,e.snap[side].maxHp));
      const crit=(e.kind==="crit");
      const cost=/代償|自分を攻撃/.test(e.text);
      const counter=!cost&&this.actorSide===side;
      if(this.skip) return;
      this.popNumber(view,delta,{crit,counter,cost,tier});
      this.shake(tier);
      this.flash(crit?"crit":"");
      this.buzz(this.TIERS[tier].vib);
      Music.sfx(crit?"crit":counter?"counter":"hit",{tier});
      stop=Math.max(stop,this.TIERS[tier].stop*(crit?1.35:1));
      // 防御していた側が受けたダメージには「防御」を重ねて見せる
      if(e.snap[side].defending&&!this.guardShown[side]){
        this.guardShown[side]=true;
        this.cue(view,"防御","guard");
        this.fx(view,"gring",560);
      }
      if(e.snap[side].hp<=0) Music.sfx("down");
    });
    if(this.skip) return stop;

    if(e.kind==="action"||e.kind==="awaken") this.actAnim(e.actor);
    if(e.kind==="miss"){
      const side=this.sideFromText(e.text,this.actorSide==null?null:1-this.actorSide);
      if(side!=null){
        const view=this.viewOf(side);
        const host=$("#view"+view);
        host.classList.remove("dodge"); void host.offsetWidth; host.classList.add("dodge");
        setTimeout(()=>host.classList.remove("dodge"),460);
        this.cue(view,/効かなかった/.test(e.text)?"無効":"MISS","miss");
        Music.sfx("miss");
      }
    }
    if(e.kind==="status"&&/状態になった|効果。/.test(e.text)){
      const side=this.sideFromText(e.text,this.actorSide);
      if(side!=null){
        const view=this.viewOf(side);
        const good=/効果。$/.test(e.text)&&side===this.actorSide;
        this.fx(view,"statusburst "+(good?"good":"bad"),640);
        const m=e.text.match(/「(.+?)」/);
        this.cue(view,m?m[1]:"状態変化","status"+(good?" good":""));
        Music.sfx("status",{good});
        stop=Math.max(stop,60);
      }
    }
    if(e.kind==="sys"&&/無効化した/.test(e.text)){
      const side=this.sideFromText(e.text,this.actorSide==null?null:1-this.actorSide);
      if(side!=null){ this.cue(this.viewOf(side),"NULLIFY","nullify"); Music.sfx("guard"); stop=Math.max(stop,90); }
    }
    if(e.kind==="sys"&&/を防いだ/.test(e.text)){
      const side=this.sideFromText(e.text,this.actorSide==null?null:1-this.actorSide);
      if(side!=null){ this.cue(this.viewOf(side),"SHIELD","guard"); Music.sfx("guard"); }
    }
    if(e.kind==="sys"&&/身を固めた/.test(e.text)){
      const side=this.sideFromText(e.text,e.actor);
      if(side!=null){
        const view=this.viewOf(side);
        const host=$("#view"+view);
        host.classList.remove("guard"); void host.offsetWidth; host.classList.add("guard");
        setTimeout(()=>host.classList.remove("guard"),440);
        this.fx(view,"gring",560);
        Music.sfx("guard");
      }
    }
    if(e.kind==="win") Music.sfx(this.engine.winner&&this.engine.winner.side===this.mySide?"win":"lose");
    return stop;
  },
  /* 再生中に画面を触ったら残りを一気に流す */
  fastForward(){
    if(!this.playing) return false;
    this.skip=true;
    this.hideAwaken();
    $("#shockwave").classList.remove("on");
    if(this._advance) this._advance();
    return true;
  },
  /* 覚醒の演出だけを飛ばす（その後は通常の速度で続ける） */
  cutScene(){
    if(!$("#awk").classList.contains("on")) return;
    this.hideAwaken();
    if(this._advance) this._advance();
  },
  hideAwaken(){
    const o=$("#awk");
    o.classList.remove("on","brief");
    o.setAttribute("aria-hidden","true");
  },
  banner(text){
    const a=$("#arena");
    const b=document.createElement("div");
    b.className="banner"; b.innerHTML=`<span>${esc(text)}</span>`;
    a.appendChild(b); a.classList.add("bannering");
    setTimeout(()=>{ b.remove(); a.classList.remove("bannering"); },1000);
  },
  /* 覚醒：1回目はたっぷり、2回目からは短く。いつでもスキップできる */
  awakenFlash(text){
    const brief=this.awkSeen>0;
    this.awkSeen++;
    const sw=$("#shockwave");
    sw.classList.remove("on"); void sw.offsetWidth; sw.classList.add("on");
    setTimeout(()=>sw.classList.remove("on"),460);
    const o=$("#awk");
    const name=text.replace("【AWAKENING】","");
    const m=name.match(/^(.+?)が(.+?)へ移行した/);
    $("#awk-who").textContent=m?m[1]:name;
    $("#awk-form").textContent=m?m[2]:"";
    o.classList.remove("on","brief");
    void o.offsetWidth;
    o.classList.add("on");
    if(brief) o.classList.add("brief");
    o.setAttribute("aria-hidden","false");
    const dur=brief?1150:2400;
    Music.sfx("awaken",{brief});
    this.buzz(brief?[0,30,40,30]:[0,40,60,40,80,60]);
    setTimeout(()=>{ if(o.classList.contains("on")) this.hideAwaken(); },dur);
    return dur+(brief?60:140);
  },

  /* ---------- リザルト ---------- */
  /* ログのスナップショットを追って、その戦闘で何が起きたかを数える */
  battleStats(){
    const e=this.engine;
    const st=[0,1].map(()=>({taken:0,self:0,biggest:0,heal:0,crit:0,miss:0,awakened:false}));
    let prev=e.log[0].snap, actor=null;
    for(let i=1;i<e.log.length;i++){
      const en=e.log[i];
      if(en.actor!=null) actor=en.actor;
      const selfish=/代償|自分を攻撃/.test(en.text);
      [0,1].forEach(s=>{
        const d=en.snap[s].hp-prev[s].hp;
        if(d<0){
          st[s].taken+=-d;
          if(selfish) st[s].self+=-d;
          else if(-d>st[s].biggest) st[s].biggest=-d;
        }else if(d>0) st[s].heal+=d;
      });
      if(en.kind==="crit"&&actor!=null) st[actor].crit++;
      if(en.kind==="miss"&&actor!=null) st[actor].miss++;
      if(en.kind==="awaken"&&en.text.indexOf("AWAKENING")>=0){
        const s=en.actor!=null?en.actor:this.sideFromText(en.text,0);
        if(s!=null) st[s].awakened=true;
      }
      prev=en.snap;
    }
    return st;
  },
  finish(){
    const e=this.engine;
    const win=e.winner, loser=e.foe(win.side);
    const el=$("#result-win");
    if(this.mode==="local"){ el.className="rw win"; el.textContent="決着"; }
    else if(win.side===this.mySide){ el.className="rw win"; el.textContent="WIN"; }
    else { el.className="rw lose"; el.textContent="LOSE"; }
    $("#result-av").innerHTML=this.avatar(win,"84","awake");
    $("#result-name").textContent=win.name+" の勝利";
    $("#result-sub").textContent=`${e.turn}ターンで決着。${loser.name}は戦闘不能。`;

    const st=this.battleStats();
    const me=this.mySide, fo=1-this.mySide;
    const dealt=[st[fo].taken-st[fo].self, st[me].taken-st[me].self].map(v=>Math.max(0,v));

    const myName=this.mode==="local"?"プレイヤー1":"あなた";
    const foName=this.mode==="local"?"プレイヤー2":(this.mode==="ai"?"AI":"相手");
    const awk=[st[me].awakened,st[fo].awakened];
    const tile=(k,v,cls)=>`<div class="rz-tile${cls?" "+cls:""}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const top=Math.max(1,dealt[0],dealt[1]);
    const row=(cls,name,v)=>`<div class="rz-row ${cls}"><span class="rn">${esc(name)}</span>
      <span class="rt"><i class="${cls}" style="--w:${(v/top).toFixed(3)}"></i></span><b>${v}</b></div>`;
    $("#result-stats").innerHTML=`
      <div class="rz-tt">与えたダメージ</div>
      <div class="rz-cmp">${row("me",myName,dealt[0])}${row("fo",foName,dealt[1])}</div>
      <div class="rz-tiles">
        ${tile("ターン数",`${e.turn}<small>ターン</small>`)}
        ${tile("最大の一撃",`${st[fo].biggest}<small>ダメージ</small>`)}
        ${tile("会心の一撃",`${st[me].crit}<small>回</small>`)}
        ${tile("受けたダメージ",st[me].taken)}
        ${tile("覚醒",awk[0]?"切った":(awk[1]?"相手だけ":"なし"),awk[0]?"gold":"")}
        ${tile("勝者の残りHP",`${win.hp}<small>/${win.maxHp}</small>`)}
      </div>`;

    const rb=$("#btn-rematch");
    rb.disabled=false; rb.textContent="もう一度たたかう";
    this.hideAwaken();
    $("#ffcatch").classList.remove("on");
    this.show("result");
  },
  rematch(){
    this.tick(14);
    if(this.mode==="online"){
      if(!Net.connected()){ this.onNetClose(); return; }
      if(Net.role==="host"){
        const seed=Math.floor(Math.random()*4294967296);
        Net.send({t:"rematch",seed});
        this.beginOnlineBattle(this.bundles,seed);
      }else{
        Net.send({t:"rematch-req"});
        $("#btn-rematch").disabled=true;
        $("#btn-rematch").textContent="相手の準備を待っています…";
      }
    }else this.startBattle(this.chars[0],this.chars[1],null,null);
  },
});
