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
  /* 立ち絵・覚醒立ち絵・BGM・技の効果音は重い。これらを hello に丸ごと積むと
     対戦の開始そのものが遅れるうえ、大きすぎて届かないこともある。
     そこで本体は「実体を抜いた軽い束」として先に送り、実体はあとから小分けで送る。
     届いたぶんから順に反映されるので、対戦はすぐ始められる。 */
  MEDIA_CHUNK:48*1024,          // 1回に送る大きさ
  MEDIA_BUDGET:16*1024*1024,    // 1回の対戦で送るメディアの合計上限

  bundleFor(charId){
    const c=CHARACTERS[charId];
    const o=JSON.parse(JSON.stringify(c));
    const ids=[].concat(o.skills||[],(o.awakening&&o.awakening.form&&o.awakening.form.skills)||[]);
    const skills={};
    ids.forEach(id=>{ if(SKILLS[id]) skills[id]=SKILLS[id]; });

    // 実体を抜き、どこに何があったかの目録だけ残す
    const media=[];
    const 抜く=(obj,field,key)=>{
      const v=obj&&obj[field];
      if(typeof v==="string"&&v.length>0){ media.push({key,kind:"data",len:v.length}); obj[field]=null; }
    };
    抜く(o,"portraitImage","face");
    抜く(o,"bgmAudio","bgm");
    const af=o.awakening&&o.awakening.form;
    if(af) 抜く(af,"portraitImage","awk");
    Object.keys(skills).forEach(id=>{
      if(skills[id].sfxId) media.push({key:"sfx:"+id,kind:"sfx",sfxId:skills[id].sfxId,len:0});
    });
    return {v:APP_VERSION, char:o, skills, media};
  },

  /* 目録に従って実体を集める。効果音は IndexedDB から取り出す。 */
  collectMedia(charId,bundle){
    const c=CHARACTERS[charId];
    const out=[];
    const push=(key,val)=>{ if(typeof val==="string"&&val) out.push({key,text:val}); };
    push("face", c.portraitImage);
    push("bgm",  c.bgmAudio);
    const af=c.awakening&&c.awakening.form;
    if(af) push("awk", af.portraitImage);
    const sfx=(bundle.media||[]).filter(m=>m.kind==="sfx");
    if(!sfx.length||typeof Media==="undefined"||!Media.supported()) return Promise.resolve(out);
    return Promise.all(sfx.map(m=>
      Media.get(m.sfxId).then(rec=>{
        if(!rec||!rec.data) return;
        const bin=(typeof rec.data==="string")?rec.data:Media.toBase64(rec.data);
        if(bin) out.push({key:m.key,text:bin,sfxId:m.sfxId,name:rec.name,
                          type:rec.type,durationMs:rec.durationMs,b64:typeof rec.data!=="string"});
      }).catch(()=>{})
    )).then(()=>out);
  },

  /* 小分けにして送る。相手の受信が追いつくよう少しずつ流す。 */
  sendMedia(charId,bundle){
    this.collectMedia(charId,bundle).then(items=>{
      let 予算=this.MEDIA_BUDGET;
      const 送る=items.filter(it=>{
        if(it.text.length>予算) return false;               // 入りきらないものは諦める
        予算-=it.text.length; return true;
      });
      const 落とした=items.length-送る.length;
      if(落とした) this.netStatus(`相手に渡せないほど大きいデータが ${落とした} 件ありました。`,"");
      const queue=[];
      送る.forEach(it=>{
        const n=Math.ceil(it.text.length/this.MEDIA_CHUNK)||1;
        for(let i=0;i<n;i++) queue.push({t:"media",key:it.key,i,n,
          part:it.text.slice(i*this.MEDIA_CHUNK,(i+1)*this.MEDIA_CHUNK),
          meta:i===0?{sfxId:it.sfxId,name:it.name,type:it.type,durationMs:it.durationMs,b64:it.b64}:null});
      });
      const 流す=()=>{
        if(!queue.length||!Net.conn) return;
        for(let k=0;k<4&&queue.length;k++) Net.send(queue.shift());
        setTimeout(流す,24);
      };
      流す();
    }).catch(()=>{});
  },

  /* 受け取った小分けを組み立て、揃ったものから相手のキャラに反映する */
  onMediaChunk(d){
    if(!d||!d.key) return;
    this.mediaBuf=this.mediaBuf||{};
    const b=this.mediaBuf[d.key]=this.mediaBuf[d.key]||{parts:[],got:0,n:d.n,meta:null};
    if(d.meta) b.meta=d.meta;
    if(b.parts[d.i]==null){ b.parts[d.i]=d.part; b.got++; }
    if(b.got<b.n) return;
    const text=b.parts.join("");
    delete this.mediaBuf[d.key];
    this.applyMedia(d.key,text,b.meta);
  },
  applyMedia(key,text,meta){
    const side=1-this.mySide;
    const c=this.chars&&this.chars[side];
    if(!c) return;
    if(key==="face"){ c.portraitImage=text; }
    else if(key==="bgm"){ c.bgmAudio=text; this.playBgm(); }
    else if(key==="awk"){
      if(c.awakening&&c.awakening.form) c.awakening.form.portraitImage=text;
    }
    else if(key.indexOf("sfx:")===0&&meta&&meta.sfxId&&typeof Media!=="undefined"){
      // 相手の効果音は相手の対戦のあいだだけ使う。手元の保存物として残さない。
      Media.putRemote(meta.sfxId,text,meta);
      return;
    }
    // 立ち絵が届いたら、戦闘中でも姿を描き直す
    if(this.engine){
      const f=this.engine.fighters[side];
      if(f){ if(key==="face") f.portraitImage=text; f.char=c; }
      const view=(side===this.mySide)?0:1;
      const host=$("#view"+view); if(host) host._av=null;      // 描き直させる
      this.renderFighters();
    }
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
    if(d.t==="media"){ this.onMediaChunk(d); return; }
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
    // 束は送信のために実体を抜いてある。相手ぶんはあとから届くが、
    // 自分ぶんは手元にあるのだから、ここで戻しておく（戻し忘れると
    // 自分の立ち絵だけが出ない、という形で現れる）。
    this.restoreOwnMedia();
    this.controllers=this.mySide===0?["local","remote"]:["remote","local"];
    this.remoteBuf={}; this.sentActions={};
    this.stopResend();
    this.netBusy(false);
    this.mediaBuf={};
    this.startBattle(this.chars[0],this.chars[1],seed,this.battleSkills(bundles[0],bundles[1]));
    // 対戦はもう始まっている。立ち絵と音はここから順に届く。
    const mine=bundles[this.mySide];
    if(mine&&(mine.media||[]).length) this.sendMedia(this.onlinePick,mine);
  },
  /* 自分の側の立ち絵・覚醒立ち絵・BGMを、手元のキャラクターから戻す */
  restoreOwnMedia(){
    const 自分=this.chars&&this.chars[this.mySide];
    const 手元=CHARACTERS[this.onlinePick];
    if(!自分||!手元) return;
    if(手元.portraitImage) 自分.portraitImage=手元.portraitImage;
    if(手元.bgmAudio){ 自分.bgmAudio=手元.bgmAudio; 自分.bgmAudioName=手元.bgmAudioName; }
    const 元覚醒=手元.awakening&&手元.awakening.form;
    const 先覚醒=自分.awakening&&自分.awakening.form;
    if(元覚醒&&先覚醒&&元覚醒.portraitImage) 先覚醒.portraitImage=元覚醒.portraitImage;
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
