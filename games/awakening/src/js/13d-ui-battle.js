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
    this.awkState=[null,null];
    this.bindBattle();
    this.prewarmSfx();
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
    $$("#arena .float,#arena .cue,#arena .gring,#arena .spark,#arena .statusburst,#arena .banner,"
      +"#arena .im,#arena .sb,#arena .column,#arena .gbreak,#arena .proj,#arena .combo").forEach(el=>el.remove());
    ["sh1","sh2","sh3","sh4","settled"].forEach(c=>$("#arena").classList.remove(c));
    $("#s-battle").classList.remove("charging");
    $("#awk").classList.remove("on");
    $("#decide").className="decide";
    $("#decide").setAttribute("aria-hidden","true");
    $("#ffcatch").classList.remove("on");
  },

  /* この戦闘で鳴りうる「技に設定された効果音」を先に読み込んでおく。
     Media（担当C）がまだ無い環境でも黙って合成音に落ちる。 */
  prewarmSfx(){
    const e=this.engine;
    if(!e||!Music.prewarm) return;
    const ids=[];
    [0,1].forEach(s=>{
      const f=e.fighters[s];
      if(!f) return;
      const list=(f.skills||[]).concat(["basic_attack"]);
      const form=f.char&&f.char.awakening&&f.char.awakening.form;
      if(form&&Array.isArray(form.skills)) list.push.apply(list,form.skills);
      list.forEach(id=>{ const sk=e.SK[id]; if(sk&&sk.sfxId) ids.push(sk.sfxId); });
    });
    Music.prewarm(ids);
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
  /* 立ち姿（舞台の上）と ステータス板（舞台の縁）を組み立てる。
     以後は中身の書き換えだけにして、レイアウトを走らせない。 */
  buildUnit(view){
    const host=$("#view"+view);
    host.innerHTML=`
      <div class="stand">
        <div class="shadow"></div>
        <div class="avwrap">
          <div class="st-aura" data-aura></div>
          <div class="figure" data-av></div>
        </div>
      </div>`;
    const plate=$("#plate"+view);
    plate.innerHTML=`
      <div class="nmrow">
        <span class="nm" data-nm></span>
        <span class="owner" data-owner></span>
        <span class="bg" data-badges></span>
      </div>
      <div class="hpline">
        <div class="hpbar"><div class="hpchip" data-chip></div><div class="hpfill" data-fill></div>
          <div class="hpmark" data-mark hidden></div></div>
        <div class="hpnum" data-num></div>
      </div>
      <div class="spline"><span class="splabel">SP <b data-spn></b></span><div class="spbar" data-sp></div></div>
      <div class="chips" data-chips></div>`;
    this.unitBuilt[view]=true;
  },
  /* その時点で見せるべき姿。覚醒形態に絵が設定されていればそちらを使う。 */
  lookOf(f,awake){
    const af=awake&&f.char&&f.char.awakening&&f.char.awakening.form;
    if(af&&(af.portraitImage||af.portrait))
      return {portraitImage:af.portraitImage||null, portrait:af.portrait||f.portrait};
    return f;
  },
  /* 姿が変わる瞬間の演出。減らす設定のときは静かに差し替える。 */
  morphAvatar(view){
    const el=this.unitPart(view,"av");
    if(!el||this.reduceMotion&&this.reduceMotion()) return;
    el.classList.remove("morph");
    void el.offsetWidth;                                   // アニメを撃ち直すための再計算
    el.classList.add("morph");
    setTimeout(()=>el.classList.remove("morph"),900);
  },

  /* 立ち姿とステータス板の両方から部品を引く */
  unitPart(view,key){
    return $("#view"+view).querySelector("[data-"+key+"]")||$("#plate"+view).querySelector("[data-"+key+"]");
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
    const plate=$("#plate"+view);
    const q=k=>this.unitPart(view,k);
    const awake=s.form==="AWAKENED";
    // 状態異常は「立ち姿そのもの」に出す。行動を止める系は動きを凍らせる
    const st=FxKit.bodyState(s.effects);
    host.className="unit"+(view===1?" foe":" me")+(s.hp<=0?" down":"")
      +(awake?" awakened":"")+(st.aura?" has-st":"")+(st.held?" held":"");
    if(st.aura) host.style.setProperty("--h",st.hue);
    plate.className="plate "+(view===1?"foe":"me");

    // 覚醒すると立ち姿そのものが変わる。覚醒用の絵が無いキャラは通常の絵のままにする。
    const 見た目=this.lookOf(f,awake);
    const avCls=(view===1?"foe":"me")+(awake?" awake":"");
    const 鍵=avCls+"|"+(見た目.portraitImage||見た目.portrait);
    if(host._av!==鍵){
      const 絵が変わる=host._av && host._av.split("|")[1]!==(見た目.portraitImage||見た目.portrait);
      host._av=鍵;
      q("av").innerHTML=this.avatar(見た目,"84",avCls);
      if(絵が変わる&&awake) this.morphAvatar(view);          // 覚醒で姿が変わった瞬間を見せる
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

    // 覚醒できるようになった瞬間は、音と光で必ず知らせる（見逃させない）
    if(!this.awkState) this.awkState=[null,null];
    const prevAwk=this.awkState[view];
    this.awkState[view]=s.awaken;
    if(prevAwk&&prevAwk!==s.awaken&&s.awaken==="AVAILABLE"&&!this.skip){
      Music.sfx("ready",{view});
      this.cue(view,"覚醒可能","awk");
      this.column(view,44);
    }

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
    num.innerHTML=`<b>${s.hp}</b>/${s.maxHp}${lost?` <span class="dmgd">−${lost}</span>`:""}`;

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
    }
  },

  /* ---------- 技のデータから決まる演出 ----------
     形・色・向き・大きさは FxKit が技データから導く。ここは描くだけ。 */
  impact(view,o){
    o=o||{};
    const wrap=$("#view"+view).querySelector(".avwrap");
    if(!wrap) return;
    const p=o.plan||FxKit.plan({type:"ATTACK"});
    let shape=o.counter?"pierce":p.impact;
    if(shape==="slash"&&p.hits>1) shape="wave";
    if(shape==="hex"||shape==="aura") shape="burst";
    const tier=Math.max(1,Math.min(4,o.tier||1));
    const el=document.createElement("div");
    el.className="im "+shape+(o.crit?" crit":"");
    el.style.setProperty("--sc",(0.7+tier*0.15+(o.crit?0.18:0)).toFixed(2));
    el.style.setProperty("--h",o.counter?274:(o.crit?44:p.hue));
    // 斬る向きは立ち位置から。連撃は1発ごとに返して「刻んでいる」ように見せる
    const base=(view===1?-32:32);
    el.style.setProperty("--ang",(base*(((o.index||1)%2)?1:-1))+"deg");
    wrap.appendChild(el);
    setTimeout(()=>el.remove(),740);
  },
  /* 防御を砕く：破片が散る */
  shatter(view){
    const wrap=$("#view"+view).querySelector(".avwrap");
    if(!wrap) return;
    const d=document.createElement("div");
    d.className="gbreak";
    d.innerHTML=[0,1,2,3,4,5].map(i=>`<i style="--r:${i*60+12}deg"></i>`).join("");
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),620);
  },
  /* 立ちのぼる光（回復・構え・自己強化・代償） */
  column(view,hue){
    const wrap=$("#view"+view).querySelector(".avwrap");
    if(!wrap) return;
    const d=document.createElement("div");
    d.className="column";
    d.style.setProperty("--h",hue);
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),720);
  },
  /* 連撃の手数 */
  comboPop(view,n){
    const wrap=$("#view"+view).querySelector(".avwrap");
    if(!wrap) return;
    const old=wrap.querySelector(".combo");
    if(old) old.remove();
    const d=document.createElement("div");
    d.className="combo";
    d.innerHTML=`${n}<small>HIT</small>`;
    wrap.appendChild(d);
    setTimeout(()=>{ if(d.parentNode) d.remove(); },900);
  },
  /* 遠隔の技だけ、撃った側から相手へ光が飛ぶ */
  projectile(side,plan){
    const from=$("#view"+this.viewOf(side)).querySelector(".avwrap");
    const to=$("#view"+this.viewOf(1-side)).querySelector(".avwrap");
    const field=$("#field");
    if(!from||!to||!field) return;
    const fr=from.getBoundingClientRect(), tr=to.getBoundingClientRect(), br=field.getBoundingClientRect();
    const x0=fr.left+fr.width/2-br.left, y0=fr.top+fr.height/2-br.top;
    const d=document.createElement("div");
    d.className="proj";
    d.style.left=x0+"px"; d.style.top=y0+"px";
    d.style.setProperty("--dx",Math.round(tr.left+tr.width/2-br.left-x0)+"px");
    d.style.setProperty("--dy",Math.round(tr.top+tr.height/2-br.top-y0)+"px");
    d.style.setProperty("--h",plan.hue);
    d.style.setProperty("--t",Math.round(210*Math.min(1,this.SPEEDS[this.speed].k+0.3))+"ms");
    field.appendChild(d);
    setTimeout(()=>d.remove(),700);
  },
  /* 状態変化ひとつぶん。kind が未知でも sigil に落ちて必ず絵が出る */
  statusFx(view,fx){
    const wrap=$("#view"+view).querySelector(".avwrap");
    if(!wrap) return;
    const d=document.createElement("div");
    d.className="sb "+fx.family;
    d.style.setProperty("--h",fx.hue);
    d.innerHTML=`<i>${esc(fx.glyph)}</i>`;
    wrap.appendChild(d);
    setTimeout(()=>d.remove(),900);
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
  /* 踏み込み方も技のデータで変わる（先制＝踏み込み、重い技＝溜め、魔法＝詠唱…） */
  actAnim(side,plan){
    if(side==null) return;
    const host=$("#view"+this.viewOf(side));
    host.classList.remove("act","m-dash","m-heavy","m-cast","m-brace");
    void host.offsetWidth;
    host.classList.add("act");
    const m=plan&&plan.motion;
    if(m&&m!=="lunge") host.classList.add("m-"+m);
    setTimeout(()=>host.classList.remove("act","m-dash","m-heavy","m-cast","m-brace"),700);
  },
  /* 行動の宣言でこのターンの演出を決める。技名では分岐しない */
  beginAction(e){
    const id=(this.intent&&e.actor!=null)?this.intent[e.actor]:null;
    const s=FxKit.skillFromLog(this.engine,e.text,id);
    this.curSkill=s;
    this.curPlan=FxKit.plan(s||{type:"ATTACK",power:0,accuracy:95});
    this.hitIndex=0;
    if(this.skip||e.actor==null) return;
    const p=this.curPlan;
    this.actAnim(e.actor,p);
    const view=this.viewOf(e.actor);
    if(p.ranged){
      if(p.heal||p.motion==="brace") this.column(view,p.hue);
      else this.projectile(e.actor,p);
      Music.sfx("cast",{plan:p,view});
    }else if(p.heavy){
      Music.sfx("charge",{plan:p,view});
    }
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
    // どの技を出したかは解決前にしか残らないので、演出用に控えておく
    this.intent=(this.engine.pending||[]).map(a=>(a&&a.skillId)||null);
    this.curPlan=null; this.curSkill=null; this.hitIndex=0;
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
        ms=this.skip?140:this.awakenFlash(e.text,e.actor);
      }else if(e.kind==="win"){
        ms=this.decideCard(this.skip);           // 最後の一撃からリザルトまでを一続きにする
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
    if(e.kind==="action") this.beginAction(e);
    [0,1].forEach(side=>{
      const before=prev[side].hp, after=e.snap[side].hp;
      if(before===after) return;
      const view=this.viewOf(side);
      const delta=after-before;
      if(delta>0){
        if(!this.skip){ this.popNumber(view,delta); this.column(view,150); this.flash("heal"); Music.sfx("heal",{view}); }
        return;
      }
      const amount=-delta;
      const tier=this.tierOf(amount/Math.max(1,e.snap[side].maxHp));
      const crit=(e.kind==="crit");
      const cost=/代償|自分を攻撃/.test(e.text);
      const counter=!cost&&this.actorSide===side;
      if(this.skip) return;
      this.popNumber(view,delta,{crit,counter,cost,tier});
      const plan=this.curPlan||FxKit.plan({type:"ATTACK"});
      if(cost){
        // 自分で払った代償。殴られた絵ではなく、身を削る赤い光にする
        this.column(view,352);
      }else{
        this.hitIndex++;
        this.impact(view,{plan,crit,counter,tier,index:this.hitIndex});
        if(!counter&&plan.hits>1&&this.hitIndex>=2) this.comboPop(view,this.hitIndex);
      }
      this.shake(tier);
      this.flash(crit?"crit":"");
      this.buzz(this.TIERS[tier].vib);
      Music.sfx("strike",{tier,crit,counter,cost,plan,view,index:this.hitIndex,
        sfxId:(!cost&&!counter&&this.curSkill)?this.curSkill.sfxId:null});
      stop=Math.max(stop,this.TIERS[tier].stop*(crit?1.35:1));
      // 防御していた側が受けたダメージ。貫通する技なら防御が砕ける絵にする
      if(e.snap[side].defending&&!this.guardShown[side]&&!cost&&!counter){
        this.guardShown[side]=true;
        if(plan.breaker){
          this.shatter(view); this.cue(view,"防御貫通","break"); Music.sfx("break",{view});
          stop=Math.max(stop,90);
        }else{
          this.cue(view,"防御","guard");
          this.fx(view,"gring",560);
        }
      }
      if(e.snap[side].hp<=0){ Music.sfx("down",{view}); stop=Math.max(stop,this.deathBlow(view)); }
    });
    if(this.skip) return stop;

    if(e.kind==="awaken") this.actAnim(e.actor);
    if(e.kind==="miss"){
      const side=this.sideFromText(e.text,this.actorSide==null?null:1-this.actorSide);
      if(side!=null){
        const view=this.viewOf(side);
        const host=$("#view"+view);
        host.classList.remove("dodge"); void host.offsetWidth; host.classList.add("dodge");
        setTimeout(()=>host.classList.remove("dodge"),460);
        this.cue(view,/効かなかった/.test(e.text)?"無効":"MISS","miss");
        Music.sfx("miss",{plan:this.curPlan,view});
      }
    }
    if(e.kind==="status") stop=Math.max(stop,this.statusEntry(e));
    if(e.kind==="sys"&&/無効化した/.test(e.text)){
      const side=this.sideFromText(e.text,this.actorSide==null?null:1-this.actorSide);
      if(side!=null){ this.cue(this.viewOf(side),"NULLIFY","nullify"); Music.sfx("guard",{view:this.viewOf(side)}); stop=Math.max(stop,90); }
    }
    if(e.kind==="sys"&&/を防いだ/.test(e.text)){
      const side=this.sideFromText(e.text,this.actorSide==null?null:1-this.actorSide);
      if(side!=null){ this.cue(this.viewOf(side),"SHIELD","guard"); Music.sfx("guard",{view:this.viewOf(side)}); }
    }
    if(e.kind==="sys"&&/身を固めた/.test(e.text)){
      const side=this.sideFromText(e.text,e.actor);
      if(side!=null){
        const view=this.viewOf(side);
        const host=$("#view"+view);
        this.curPlan=FxKit.plan({type:"DEFENSE",power:0});
        this.curSkill=null;
        host.classList.remove("guard"); void host.offsetWidth; host.classList.add("guard");
        setTimeout(()=>host.classList.remove("guard"),440);
        this.statusFx(view,{family:"ward",hue:166,glyph:"⛨"});
        this.column(view,166);
        Music.sfx("guard",{view});
      }
    }
    return stop;
  },
  /* 状態変化の1行。効果の定義（kind・icon・tone）はその場のスナップショットから引くので、
     利用者が自分で足した状態異常でも、知らないまま正しい色と紋で出せる。 */
  statusEntry(e){
    const side=this.sideFromText(e.text,this.actorSide);
    if(side==null) return 0;
    const view=this.viewOf(side);
    const m=/「(.+?)」/.exec(e.text);
    let def=null;
    if(m){
      def=(e.snap[side].effects||[]).find(x=>x.name===m[1])||null;
      if(!def&&this.curSkill) def=(this.curSkill.effects||[]).find(x=>x.name===m[1])||null;
    }
    if(!def&&this.curSkill){
      // 付与せずその場で起きる効果（時飛ばし・反転重力など）は名前が文に出ない
      const want=(side===this.actorSide)?"self":"enemy";
      def=(this.curSkill.effects||[]).find(x=>(x.target==="enemy"?"enemy":"self")===want)||null;
    }
    const fx=FxKit.effectFx(def||{name:(m?m[1]:"状態変化"),tone:(side===this.actorSide?"good":"bad")});
    this.statusFx(view,fx);
    if(fx.tone==="good") this.column(view,fx.hue);
    this.cue(view,fx.name,"status"+(fx.tone==="good"?" good":""));
    Music.sfx("status",{good:fx.tone==="good",family:fx.family,view});
    return 60;
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
  /* 覚醒の演出だけを飛ばす（その後は通常の速度で続ける）。
     溜めの最中（まだ幕が上がっていない）でも押せるようにしておく。 */
  cutScene(){
    if(!$("#awk").classList.contains("on")&&!$("#arena").classList.contains("charging")) return;
    const view=this._awkView;
    this.hideAwaken();
    if(view!=null) this.morphAvatar(view);          // 幕を飛ばしても姿の切り替わりは見せる
    if(this._advance) this._advance();
  },
  hideAwaken(){
    const o=$("#awk");
    (this._awkTimers||[]).forEach(clearTimeout);
    this._awkTimers=[];
    o.classList.remove("on","brief");
    o.setAttribute("aria-hidden","true");
    $("#arena").classList.remove("charging");
    $("#s-battle").classList.remove("charging");
    $$("#arena .unit.charge").forEach(el=>el.classList.remove("charge"));
    $("#shockwave").classList.remove("on");
  },
  banner(text){
    const a=$("#arena");
    const b=document.createElement("div");
    b.className="banner"; b.innerHTML=`<span>${esc(text)}</span>`;
    a.appendChild(b); a.classList.add("bannering");
    setTimeout(()=>{ b.remove(); a.classList.remove("bannering"); },1000);
  },
  /* 覚醒：この作品の題名そのもの。
     ①舞台が息を呑む（溜め）→ ②闇が本人の位置から広がる → ③一閃 → ④新しい姿 → ⑤舞台に戻す。
     1回目はたっぷり、2回目からは①を省いて短く。いつでもスキップできる。 */
  awakenFlash(text,actor){
    const brief=this.awkSeen>0;
    this.awkSeen++;
    const calm=this.reduceMotion&&this.reduceMotion();
    const name=text.replace("【AWAKENING】","");
    const m=name.match(/^(.+?)が(.+?)へ移行した/);
    $("#awk-who").textContent=m?m[1]:name;
    $("#awk-form").textContent=m?m[2]:"";

    // 誰が覚醒したのか。その立ち姿を幕の中央に据える（覚醒前の姿→覚醒後の姿）
    const side=(actor!=null)?actor:this.sideFromText(text,null);
    const view=(side!=null)?this.viewOf(side):0;
    this._awkView=(side!=null)?view:null;
    const f=(side!=null)?this.engine.fighters[side]:null;
    if(f){
      $("#awk-sil").innerHTML=this.avatar(this.lookOf(f,false),"84","");
      $("#awk-fig").innerHTML=this.avatar(this.lookOf(f,true),"84","awake");
    }else{ $("#awk-sil").innerHTML=""; $("#awk-fig").innerHTML=""; }

    this._awkTimers=(this._awkTimers||[]);
    this._awkTimers.forEach(clearTimeout);
    this._awkTimers=[];
    const at=(ms,fn)=>{ this._awkTimers.push(setTimeout(fn,ms)); };

    const charge=(brief||calm)?0:420;
    if(charge) this.awakenCharge(view);
    at(charge,()=>this.awakenCurtain(brief,calm,view));
    const dur=calm?700:(brief?1150:2700);
    // 幕が引ける少し前に立ち姿を差し替える。幕の残り香が切り替わりを隠してくれる
    at(charge+dur-200,()=>{ if($("#awk").classList.contains("on")) this.morphAvatar(view); });
    at(charge+dur,()=>{ if($("#awk").classList.contains("on")){ this.hideAwaken(); this.awakenLand(view); } });
    return charge+dur+(brief?60:160);
  },
  /* ①溜め。舞台が暗み、本人だけが光る。ここでの「間」が覚醒を重くする */
  awakenCharge(view){
    const a=$("#arena");
    a.classList.add("charging");
    $("#s-battle").classList.add("charging");
    const host=$("#view"+view);
    if(host){ host.classList.add("charge"); }
    this.column(view,44);
    Music.sfx("awakenRise");
    this.buzz([0,12,90,18,110,26]);
  },
  /* ⑤舞台に戻る。幕が引けた瞬間、足元から金の波が広がって新しい姿を舞台に据える */
  awakenLand(view){
    this.fx(view,"awkland",900);
    this.column(view,44);
    const host=$("#view"+view);
    if(host){
      host.classList.remove("landed"); void host.offsetWidth; host.classList.add("landed");
      setTimeout(()=>host.classList.remove("landed"),900);
    }
  },
  /* ②〜④幕。--t は CSS と JS で同じ値を使う */
  awakenCurtain(brief,calm,view){
    const o=$("#awk"), a=$("#arena");
    a.classList.remove("charging");
    $("#s-battle").classList.remove("charging");
    const host=$("#view"+view);
    if(host) host.classList.remove("charge");
    // 闇の広がる起点を、覚醒した本人の立ち位置に合わせる
    const wrap=host&&host.querySelector(".avwrap");
    if(wrap){
      const r=wrap.getBoundingClientRect();
      o.style.setProperty("--ox",Math.round(r.left+r.width/2)+"px");
      o.style.setProperty("--oy",Math.round(r.top+r.height/2)+"px");
    }else{ o.style.setProperty("--ox","50%"); o.style.setProperty("--oy","44%"); }
    const dur=calm?700:(brief?1150:2700);
    o.style.setProperty("--t",dur+"ms");
    o.classList.remove("on","brief");
    void o.offsetWidth;
    o.classList.add("on");
    if(brief) o.classList.add("brief");
    o.setAttribute("aria-hidden","false");
    Music.sfx("awaken",{brief});
    this.buzz(brief?[0,30,40,30]:[0,40,60,40,80,60]);
    if(!calm){
      // 断つ瞬間に白が抜ける。幕の 33% 地点＝一閃が交差するところ
      this._awkTimers.push(setTimeout(()=>{
        const sw=$("#shockwave");
        sw.classList.remove("on"); void sw.offsetWidth; sw.classList.add("on");
        this._awkTimers.push(setTimeout(()=>sw.classList.remove("on"),460));
        this.buzz([0,50,30,70]);
      },Math.round(dur*0.32)));
    }
  },

  /* ---------- 決着 ----------
     最後の一撃 → 倒れる → 決着の札 → リザルト、を一続きの体験にする。 */
  /* とどめ。時間が伸びたように見せ、舞台から色を抜く */
  deathBlow(view){
    if(this.skip) return 0;
    const a=$("#arena");
    a.classList.add("settled");
    const host=$("#view"+view);
    if(host){ this.fx(view,"deathring",900); }
    this.flash("final");
    this.shake(4);
    this.buzz([0,60,50,90,60,140]);
    Music.sfx("deathblow",{view});
    return 420;
  },
  /* 決着の札。勝ちか負けかを一拍で言い切ってからリザルトへ渡す */
  decideCard(quick){
    const e=this.engine, o=$("#decide");
    const win=e.winner;
    const mine=!!(win&&win.side===this.mySide);
    const local=(this.mode==="local");
    const word=local?"決着":(mine?"勝利":"敗北");
    const sub=local
      ? (win?win.name+" の勝ち":"")
      : (win?win.name+(mine?" が勝った":" に敗れた"):"");
    $("#decide-word").innerHTML=word.split("").map(c=>`<span>${esc(c)}</span>`).join("");
    $("#decide-sub").textContent=sub;
    Music.sfx(local?"win":(mine?"win":"lose"));
    if(quick){ return 140; }
    const calm=this.reduceMotion&&this.reduceMotion();
    const dur=calm?600:1500;
    o.className="decide on"+(local?" draw":(mine?" win":" lose"));
    o.style.setProperty("--t",dur+"ms");
    o.setAttribute("aria-hidden","false");
    this.buzz(mine||local?[0,30,60,40]:[0,80]);
    return dur;
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
    // 勝ち負けで画面の温度を変え、決着の札からそのまま溶け込ませる
    const mine=(win.side===this.mySide);
    $("#s-result").classList.toggle("won",this.mode==="local"||mine);
    $("#s-result").classList.toggle("lost",this.mode!=="local"&&!mine);
    this.show("result");
    const dc=$("#decide");
    if(dc.classList.contains("on")){
      dc.classList.add("out");
      setTimeout(()=>{ dc.className="decide"; dc.setAttribute("aria-hidden","true"); },420);
    }
    $("#arena").classList.remove("settled");
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
