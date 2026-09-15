/* ===== UI：オンライン対戦 ===== */
Object.assign(UI, {
  /* ---------- オンライン ---------- */
  openOnline(){
    const list=Object.values(CHARACTERS);
    if(!this.onlinePick||!CHARACTERS[this.onlinePick]) this.onlinePick=list[0].id;
    $("#online-preview").innerHTML=this.previewCard(CHARACTERS[this.onlinePick]);
    const tray=$("#online-tray");
    tray.innerHTML=this.trayHtml(list,this.onlinePick);
    tray.querySelectorAll(".thumb").forEach(b=>b.onclick=()=>{ this.onlinePick=b.dataset.id; this.openOnline(); });
    this.show("online");
  },
  netStatus(text,cls){
    const el=$("#net-status");
    el.style.display="block"; el.className="status "+(cls||""); el.innerHTML=text;
  },
  netBusy(on){
    $("#btn-connect").disabled=on;
    $("#btn-connect").textContent=on?"接続中…":"あいことばでつながる";
    $("#btn-cancel-net").style.display=on?"block":"none";
  },
  /* 相手の端末に無い自作技も一緒に渡す。相手のデータは書き換えない */
  bundleFor(charId){
    const c=CHARACTERS[charId];
    const o=JSON.parse(JSON.stringify(c));
    if(o.bgmAudio&&o.bgmAudio.length>300000){ delete o.bgmAudio; delete o.bgmAudioName; }
    const ids=[].concat(o.skills||[],(o.awakening&&o.awakening.form&&o.awakening.form.skills)||[]);
    const skills={};
    ids.forEach(id=>{ if(SKILLS[id]) skills[id]=SKILLS[id]; });
    return {v:APP_VERSION, char:o, skills};
  },
  battleSkills(b1,b2){
    return Object.assign({},(b1&&b1.skills)||{},(b2&&b2.skills)||{});
  },

  connect(){
    const word=$("#net-word").value.trim();
    if(!word){ this.netStatus("あいことばを入れてください。","bad"); return; }
    this.mode="online"; this.netStarted=false; this.mySide=0;
    Music.unlock();          // 開戦は相手の到着時なので、ここで音を開通させておく
    this.netBusy(true);
    Net.start(word,{
      onStatus:s=>this.netStatus(s.text,s.cls),
      onRole:role=>{ this.mySide=(role==="host")?0:1; },
      onConnect:role=>{
        this.netStatus("つながりました。キャラクターを送っています…","ok");
        if(role==="guest") Net.send({t:"hello",bundle:this.bundleFor(this.onlinePick)});
        else Net.send({t:"hello-req"});
      },
      onData:d=>this.onNetData(d),
      onClose:()=>this.onNetClose()
    });
  },
  cancelNet(){
    Net.close(); this.netBusy(false);
    this.netStatus("接続をやめました。","");
  },
  onNetClose(){
    this.stopResend();
    this.netBusy(false);
    if($("#s-battle").classList.contains("on")||$("#s-result").classList.contains("on")){
      this.openOnline();
      this.netStatus("相手との接続が切れました。もう一度同じあいことばでつなぎ直せます。","bad");
    }else{
      this.netStatus("接続が切れました。もう一度お試しください。","bad");
    }
  },
  onNetData(d){
    if(!d||!d.t) return;
    if(d.t==="hello-req"){ Net.send({t:"hello",bundle:this.bundleFor(this.onlinePick)}); return; }
    if(d.t==="hello"){
      if(Net.role!=="host"||this.netStarted) return;
      if(d.bundle&&d.bundle.v&&d.bundle.v!==APP_VERSION){
        this.netStatus(`相手のアプリの版が違います（相手 ${esc(d.bundle.v)} / あなた ${APP_VERSION}）。同じファイルを使ってください。`,"bad");
        return;
      }
      this.netStarted=true;
      const seed=Math.floor(Math.random()*4294967296);
      const mine=this.bundleFor(this.onlinePick);
      Net.send({t:"start",seed,bundles:[mine,d.bundle]});
      this.beginOnlineBattle([mine,d.bundle],seed);
      return;
    }
    if(d.t==="start"){
      this.netStarted=true;
      this.beginOnlineBattle(d.bundles,d.seed);
      return;
    }
    if(d.t==="need-act"){
      // 相手がこちらの行動を受け取れていない。控えから送り直す
      const a=this.sentActions&&this.sentActions[d.turn];
      if(a) Net.send({t:"act",turn:d.turn,action:a});
      return;
    }
    if(d.t==="act"){
      const side=1-this.mySide;
      if(!this.engine) return;
      if(d.turn<this.engine.turn) return;                    // 済んだターンの重複は捨てる
      if(d.turn!==this.engine.turn||this.acted[side]) this.remoteBuf[d.turn]=d.action;
      else this.submitSide(side,d.action);
      return;
    }
    if(d.t==="rematch-req"){
      if(Net.role!=="host") return;
      const seed=Math.floor(Math.random()*4294967296);
      Net.send({t:"rematch",seed});
      this.beginOnlineBattle(this.bundles,seed);
      return;
    }
    if(d.t==="rematch"){ this.beginOnlineBattle(this.bundles,d.seed); return; }
  },
  beginOnlineBattle(bundles,seed){
    if(!bundles||!bundles[0]||!bundles[1]) return;
    this.bundles=bundles;
    this.chars=[bundles[0].char,bundles[1].char];
    this.controllers=this.mySide===0?["local","remote"]:["remote","local"];
    this.remoteBuf={}; this.sentActions={};
    this.stopResend();
    this.netBusy(false);
    this.startBattle(this.chars[0],this.chars[1],seed,this.battleSkills(bundles[0],bundles[1]));
  },
  /* 通信が一度こぼれても止まらないよう、相手の行動が来るまで自分の行動を送り直す */
  startResend(){
    if(this.resendTimer) return;
    this.resendTimer=setInterval(()=>{
      if(this.mode!=="online"||!this.engine||this.engine.over) return this.stopResend();
      if(this.playing) return;
      const me=this.mySide, foe=1-me, t=this.engine.turn;
      if(this.acted[me]&&!this.acted[foe]){
        const mine=this.sentActions&&this.sentActions[t];
        if(mine) Net.send({t:"act",turn:t,action:mine});   // 自分の分が落ちていた場合
        Net.send({t:"need-act",turn:t});                   // 相手の分が落ちていた場合
      }
      if(Net.quiet()) $("#phase-label").textContent="相手と通信できていません…";
    },1800);
  },
  stopResend(){ if(this.resendTimer){ clearInterval(this.resendTimer); this.resendTimer=null; } },
});
