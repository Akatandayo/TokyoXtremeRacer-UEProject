/* ===== UI：戦闘画面と結果 ===== */
Object.assign(UI, {
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
    this.renderFighters();
    this.strip(this.engine.log.slice(-2));
    this.show("battle");
    this.applyPrefs();
    this.playBgm();
    this.beginInput();
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
    if(Music.muted) b.textContent="♪ OFF";
    else b.textContent=Music.blocked()?"♪ タップ":"♪ ON";
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
  },
  syncSpeed(){
    const b=$("#btn-speed");
    if(b) b.textContent="⏩ "+this.SPEEDS[this.speed].label;
  },
  cycleSpeed(){
    const keys=Object.keys(this.SPEEDS);
    this.speed=keys[(keys.indexOf(this.speed)+1)%keys.length];
    Store.prefs.speed=this.speed; Store.savePrefs();
    this.syncSpeed();
  },

  /* ---------- 盤面 ---------- */
  sideOf(view){ return view===0 ? this.mySide : 1-this.mySide; },
  ownerLabel(side){
    if(this.mode==="local") return "プレイヤー"+(side+1);
    if(this.mode==="ai") return side===this.mySide?"あなた":"AI（"+AI.LEVELS[this.aiLevel].label+"）";
    return side===this.mySide?"あなた":"相手";
  },
  renderFighters(snap,turn){
    const e=this.engine;
    [0,1].forEach(view=>{
      const side=this.sideOf(view);
      const f=e.fighters[side];
      const s=snap?snap[side]:e.snapshot()[side];
      const pct=Math.max(0,s.hp/s.maxHp*100);
      const awake=s.form==="AWAKENED";
      const host=$("#view"+view);
      host.className="unit"+(view===1?" foe":"");
      const chips=s.effects.map(x=>{
        const d=x.duration>=BALANCE.permanentDuration?"∞":(x.duration>1?x.duration:"");
        return `<span class="chip ${effTone(x)}"><span class="ci">${effIcon(x)}</span>${esc(x.name)}${d?" "+d:""}</span>`;
      }).join("");
      const pips=Array.from({length:BALANCE.sp.max},(_,k)=>`<span class="pip${k<s.sp?" on":""}"></span>`).join("");
      host.innerHTML=`
        <div class="avwrap">${this.avatar(f,"84",(view===1?"foe":"me")+(awake?" awake":""))}</div>
        <div class="info">
          <span class="owner">${esc(this.ownerLabel(side))}</span>
          <div class="nmrow"><span class="nm">${esc(f.name)}</span>
            ${awake?`<span class="badge b-gold">${esc(s.formName||"覚醒")}</span>`:""}
            ${s.awaken==="AVAILABLE"?`<span class="badge b-gold b-pulse">覚醒可能</span>`:""}
            ${s.defending?`<span class="badge b-jade">防御</span>`:""}
          </div>
          <div class="hpline">
            <div class="hpbar">
              <div class="hpghost" style="width:${pct}%"></div>
              <div class="hpfill${awake?" awake":""}${pct<=30?" low":""}" style="width:${pct}%"></div>
            </div>
            <div class="hpnum"><span>HP</span><span><b>${s.hp}</b> / ${s.maxHp}</span></div>
          </div>
          <div class="spbar">${pips}</div>
          ${chips?`<div class="chips">${chips}</div>`:""}
        </div>`;
    });
    $("#turn-label").textContent="ターン "+(turn||this.engine.turn);
  },
  popNumber(view,delta,crit){
    const host=$("#view"+view);
    const wrap=host.querySelector(".avwrap");
    if(!wrap) return;
    const d=document.createElement("div");
    d.className="float"+(delta>0?" heal":"")+(crit?" crit":"");
    d.textContent=(delta>0?"+":"−")+Math.abs(delta);
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),1100);
    if(delta<0){
      host.classList.remove("hurt"); void host.offsetWidth; host.classList.add("hurt");
      setTimeout(()=>host.classList.remove("hurt"),450);
    }
  },
  actAnim(side){
    if(side==null) return;
    const host=$("#view"+(side===this.mySide?0:1));
    host.classList.remove("act"); void host.offsetWidth; host.classList.add("act");
    setTimeout(()=>host.classList.remove("act"),520);
  },

  /* ---------- 入力 ---------- */
  beginInput(){
    if(this.engine.over) return;
    this.acted=[false,false];
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
    if(this.mode==="local"&&this.blind){
      $("#veil-title").textContent=`プレイヤー${side+1} の番`;
      $("#veil").classList.add("on");
      $("#veil-ok").onclick=()=>{ $("#veil").classList.remove("on"); this.renderCommand(side); };
    }else this.renderCommand(side);
  },
  waitRemote(){
    if(this.acted[0]&&this.acted[1]) return;
    const who=this.mode==="ai"?"AI":"相手";
    $("#cmd-area").innerHTML=`<div class="waiting">${who}が考えています<span class="dots"></span></div>`;
  },
  renderCommand(side){
    $("#phase-label").textContent=this.mode==="local"?`P${side+1} のコマンド`:"コマンドを選ぶ";
    const o=this.engine.options(side);
    const area=$("#cmd-area");
    area.innerHTML=`<div class="cmd-grid">
      <button class="cbtn" data-cmd="ATTACK"><span class="ci">⚔</span><span class="cl">攻撃</span></button>
      <button class="cbtn" data-cmd="DEFEND"><span class="ci">⛊</span><span class="cl">防御</span></button>
      <button class="cbtn" data-cmd="SKILLS"><span class="ci">✧</span><span class="cl">技${o.silenced?"（沈黙）":""}</span></button>
      <button class="cbtn" data-cmd="INFO"><span class="ci">☰</span><span class="cl">状況</span></button>
      ${o.canAwaken?`<button class="cbtn wide awaken" data-cmd="AWAKEN"><span class="cl">覚 醒</span></button>`:""}
    </div>`;
    area.querySelectorAll("[data-cmd]").forEach(b=>{
      b.onclick=()=>{
        const c=b.dataset.cmd;
        if(c==="SKILLS") this.openSkills(side);
        else if(c==="INFO") this.openInfo(side);
        else this.choose(side,{type:c});
      };
    });
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
        <span class="cost">${dmg>0?"期待 "+dmg:"効果強化"}</span></span>
        <div class="meta">${eff.power?`<span class="mchip">威力 ${eff.power}${eff.hits>1?"×"+eff.hits:""}</span>`:""}
        ${(eff.effects||[]).map(e=>`<span class="mchip">${effIcon(e)} ${esc(e.name)} ${e.duration}T</span>`).join("")}
        <span class="mchip">残SP ${me.sp-sp}</span></div></button>`);
    }
    this.openSheet(x.skill.name+"：SPを決める",
      `<div class="skill-list">${list.join("")}</div>
       <div style="height:9px"></div><button class="btn btn-line" id="spend-back">技をえらび直す</button>`);
    $("#sheet-body").querySelectorAll("[data-sp]").forEach(b=>{
      b.onclick=()=>{ this.closeSheet(); this.choose(side,{type:"SKILL",skillId:x.skill.id,spend:+b.dataset.sp}); };
    });
    $("#spend-back").onclick=()=>this.openSkills(side);
  },
  openInfo(side){
    const f=this.engine.fighters[side], a=f.char.awakening;
    const st=["atk","def","spd"].map(k=>`<span class="mchip">${k.toUpperCase()} ${Effects.stat(f,k)}</span>`).join("");
    let aw="覚醒なし";
    if(a&&a.enabled){
      const state={LOCKED:"条件未達成",AVAILABLE:"いつでも覚醒できる",ACTIVE:`覚醒中（残り${f.awaken.turnsLeft}ターン）`,SPENT:"使用済み"}[f.awaken.state]||"";
      aw=`<b>${esc(a.name||"覚醒")}</b>：${state}<br>条件（${a.conditionMode==="ALL"?"すべて":"いずれか"}）：${esc((a.conditions||[]).map(c=>c.label).join(" ／ "))}<br>代償：${esc((a.cost&&a.cost.label)||"なし")}`;
    }
    const chips=f.effects.map(e=>`<span class="chip ${effTone(e)}"><span class="ci">${effIcon(e)}</span>${esc(e.name)}（${e.duration>=BALANCE.permanentDuration?"永続":"残"+e.duration}）</span>`).join("");
    this.openSheet(f.name+" の状況",
      `<div class="meta" style="display:flex;gap:5px;flex-wrap:wrap">${st}<span class="mchip">SP ${f.sp}/${BALANCE.sp.max}</span></div>
       <div class="awk-note" style="margin-top:12px">${aw}</div>
       ${chips?`<div class="chips" style="margin-top:12px">${chips}</div>`:`<p class="note" style="margin-top:12px">かかっている効果はありません。</p>`}`);
  },
  logTap(){ if(!this.fastForward()) this.openLog(); },
  openLog(){
    const html=`<div class="logfull">`+this.engine.log.map(e=>`<div class="le ${e.kind}">${esc(e.text)}</div>`).join("")+`</div>`;
    this.openSheet("戦闘ログ",html);
    const box=$("#sheet-body").querySelector(".logfull");
    box.scrollTop=box.scrollHeight;
  },
  strip(entries){
    const box=$("#logstrip");
    const last=entries.slice(-2);
    box.innerHTML=last.map((e,i)=>`<div class="ll ${e.kind}${i===0&&last.length>1?" old":""}">${esc(e.text)}</div>`).join("");
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
    $("#phase-label").textContent="行動処理中 — タップで送る";
    $("#cmd-area").innerHTML=`<div class="waiting"><span class="dots"></span></div>`;
    const entries=this.engine.resolveTurn();
    this.playing=true; this.skip=false;
    const k=this.SPEEDS[this.speed].k;
    let i=0, shown=[];
    const step=()=>{
      if(i>=entries.length){
        this.playing=false;
        this.prevSnap=this.engine.snapshot();
        this.renderFighters();
        if(this.engine.over) this.finish();
        else { $("#phase-label").textContent=""; this.beginInput(); }
        return;
      }
      const e=entries[i++];
      shown.push(e); this.strip(shown);
      [0,1].forEach(side=>{
        const before=this.prevSnap[side].hp, after=e.snap[side].hp;
        if(before!==after) this.popNumber(side===this.mySide?0:1,after-before,e.kind==="crit");
      });
      this.prevSnap=e.snap;
      this.renderFighters(e.snap,e.turn);
      if(e.kind==="action"||e.kind==="awaken") this.actAnim(e.actor);
      let wait=430;
      if(e.kind==="turn"){ if(!this.skip) this.banner(e.text); wait=640; }
      if(e.kind==="miss"||e.kind==="sys"||e.kind==="status") wait=320;
      const isAwk=(e.kind==="awaken"&&e.text.indexOf("AWAKENING")>=0);
      if(isAwk){ if(!this.skip) this.awakenFlash(e.text); wait=2050; }
      if(this.skip) wait=isAwk?120:16;          // タップ後は一気に流す
      else wait=Math.max(16,Math.round(wait*(isAwk?Math.max(k,0.45):k)));
      setTimeout(step,wait);
    };
    step();
  },
  /* 再生中に画面を触ったら残りを一気に流す */
  fastForward(){
    if(!this.playing) return false;
    this.skip=true;
    $("#awk").classList.remove("on");
    $("#shockwave").classList.remove("on");
    return true;
  },
  banner(text){
    const a=$("#arena");
    const b=document.createElement("div");
    b.className="banner"; b.innerHTML=`<span>${esc(text)}</span>`;
    a.appendChild(b);
    setTimeout(()=>b.remove(),1000);
  },
  awakenFlash(text){
    const sw=$("#shockwave");
    sw.classList.remove("on"); void sw.offsetWidth; sw.classList.add("on");
    setTimeout(()=>sw.classList.remove("on"),500);
    const o=$("#awk");
    $("#awk-who").textContent=text.replace("【AWAKENING】","");
    o.classList.remove("on"); void o.offsetWidth; o.classList.add("on");
    setTimeout(()=>o.classList.remove("on"),2000);
  },
  finish(){
    const win=this.engine.winner, loser=this.engine.foe(win.side);
    const el=$("#result-win");
    if(this.mode==="local"){ el.className="rw win"; el.textContent="決着"; }
    else if(win.side===this.mySide){ el.className="rw win"; el.textContent="WIN"; }
    else { el.className="rw lose"; el.textContent="LOSE"; }
    $("#result-av").innerHTML=this.avatar(win,"84","awake");
    $("#result-name").textContent=win.name+" の勝利";
    $("#result-sub").textContent=`${this.engine.turn}ターンで決着。${loser.name}は戦闘不能。`;
    const rb=$("#btn-rematch");
    rb.disabled=false; rb.textContent="もう一度たたかう";
    this.show("result");
  },
  rematch(){
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
