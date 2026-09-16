/* =========================================================================
   07d. Music — 対戦BGM。音源ファイルを持たず、その場で音を組み立てて鳴らす。
   キャラクターに設定した曲を、相手側の曲として戦闘中に流す。
   ========================================================================= */
const Music = {
  ctx:null, master:null, timer:null, key:null, bar:0, muted:false, audioEl:null,
  pending:null, unlocked:false,

  ready(){
    if(this.ctx) return true;
    const AC=window.AudioContext||window.webkitAudioContext;
    if(!AC) return false;
    try{
      this.ctx=new AC();
      this.master=this.ctx.createGain();
      this.master.gain.value=this.muted?0:0.5;
      this.master.connect(this.ctx.destination);
      // BGM と効果音を別系統にして、曲の裏でも打撃音が埋もれないようにする
      this.bgmBus=this.ctx.createGain(); this.bgmBus.gain.value=1;   this.bgmBus.connect(this.master);
      this.sfxBus=this.ctx.createGain(); this.sfxBus.gain.value=1.3; this.sfxBus.connect(this.master);
      return true;
    }catch(e){ return false; }
  },
  /* ブラウザは利用者が触れた瞬間でないと音を出させてくれない。
     画面を触ったタイミングでここを通し、待たされていた曲があれば鳴らし直す。 */
  unlock(){
    if(!this.ready()) return false;
    try{
      const b=this.ctx.createBuffer(1,1,22050);
      const src=this.ctx.createBufferSource();
      src.buffer=b; src.connect(this.ctx.destination); src.start(0);
    }catch(e){}
    if(this.ctx.state==="suspended"){
      const p=this.ctx.resume();
      if(p&&p.then) p.then(()=>{ this.unlocked=true; this.resume(); }).catch(()=>{});
    }else{
      this.unlocked=true;
      this.resume();
    }
    return this.ctx.state==="running";
  },
  /* 鳴らせずに待たせていた曲を拾い直す */
  resume(){
    if(this.key||!this.pending) return;
    const p=this.pending;
    this.pending=null;
    this.play(p.key,p.url);
  },
  freq(midi){ return 440*Math.pow(2,(midi-69)/12); },

  /* 1音鳴らす */
  note(midi,at,dur,type,gain){
    const c=this.ctx;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type||"triangle";
    o.frequency.value=this.freq(midi);
    g.gain.setValueAtTime(0.0001,at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002,gain),at+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001,at+dur);
    o.connect(g); g.connect(this.bgmBus||this.master);
    o.start(at); o.stop(at+dur+0.05);
  },
  hat(at){
    const c=this.ctx, len=0.05;
    const buf=c.createBuffer(1,Math.ceil(c.sampleRate*len),c.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
    const src=c.createBufferSource(); src.buffer=buf;
    const g=c.createGain(); g.gain.value=0.05;
    const hp=c.createBiquadFilter(); hp.type="highpass"; hp.frequency.value=6000;
    src.connect(hp); hp.connect(g); g.connect(this.bgmBus||this.master);
    src.start(at);
  },

  /* 1小節ぶんを予約する */
  scheduleBar(p,at){
    const beat=60/p.bpm, bar=beat*4;
    const deg=p.prog[this.bar%p.prog.length];
    const sc=p.scale;
    const chordTone=i=>p.root+sc[(deg+i)%sc.length]+12*Math.floor((deg+i)/sc.length);
    const r=chordTone(0), third=chordTone(2), fifth=chordTone(4);
    // ベース
    for(let i=0;i<4;i++) this.note(r-12,at+beat*i,beat*0.7,"sine",0.16);
    // パッド
    this.note(third+12,at,bar*0.95,p.wave,p.padGain);
    this.note(fifth+12,at,bar*0.95,p.wave,p.padGain*0.8);
    // アルペジオ
    const seq=[0,2,4,2,4,6,4,2];
    for(let i=0;i<8;i++){
      if((this.bar%2)===1&&i%2===1) continue;
      this.note(chordTone(seq[i])+12,at+beat*0.5*i,beat*0.45,p.wave,0.055);
    }
    if(p.hat) for(let i=0;i<8;i++) this.hat(at+beat*0.5*i);
    this.bar++;
    return bar;
  },

  play(bgmKey, customUrl){
    this.stop();
    if(customUrl){
      try{
        this.audioEl=new Audio(customUrl);
        this.audioEl.loop=true; this.audioEl.volume=this.muted?0:0.35;
        const pr=this.audioEl.play();
        if(pr&&pr.catch) pr.catch(()=>{ this.pending={key:bgmKey,url:customUrl}; this.key=null; });
        this.key="custom";
      }catch(e){ this.pending={key:bgmKey,url:customUrl}; }
      return;
    }
    if(!bgmKey||bgmKey==="none"||!BGM[bgmKey]) return;
    if(!this.ready()){ return; }
    const p=BGM[bgmKey];
    const begin=()=>{
      if(this.pending&&this.pending.key===bgmKey) this.pending=null;
      this.key=bgmKey; this.bar=0;
      const loop=()=>{
        if(this.key!==bgmKey) return;
        const len=this.scheduleBar(p,this.ctx.currentTime+0.06);
        this.timer=setTimeout(loop,len*1000);
      };
      loop();
    };
    if(this.ctx.state!=="running"){
      // まだ音を出す許可が下りていないので、次に画面を触ったときに鳴らす
      this.pending={key:bgmKey,url:null};
      const pr=this.ctx.resume?this.ctx.resume():null;
      if(pr&&pr.then) pr.then(()=>{ if(this.ctx.state==="running") begin(); }).catch(()=>{});
      return;
    }
    begin();
  },
  /* いま鳴っているか（鳴らせずに待っている状態と区別する） */
  blocked(){ return !!this.pending && !this.key; },
  stop(){
    this.key=null; this.pending=null;
    if(this.timer){ clearTimeout(this.timer); this.timer=null; }
    if(this.audioEl){ try{ this.audioEl.pause(); }catch(e){} this.audioEl=null; }
  },
  setMuted(m){
    this.muted=m;
    if(!m) this.unlock();
    if(this.master) this.master.gain.value=m?0:0.5;
    if(this.audioEl) this.audioEl.volume=m?0:0.35;
  },
  /* 編集画面の試聴（数秒で止める） */
  preview(key){
    this.play(key);
    if(this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer=setTimeout(()=>this.stop(),8000);
  },

  /* =======================================================================
     効果音。音源ファイルは持たず、打撃も覚醒もその場で組み立てて鳴らす。
     ミュート中と、まだ利用者が画面を触っていない（音を出せない）あいだは黙る。
     ======================================================================= */
  sfxReady(){
    if(this.muted) return false;
    if(!this.ready()) return false;
    return this.ctx.state==="running";
  },
  /* 立ち上がり→減衰の包絡線 */
  env(g,at,a,d,peak){
    g.gain.setValueAtTime(0.0001,at);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002,peak),at+a);
    g.gain.exponentialRampToValueAtTime(0.0001,at+a+d);
  },
  /* 高さの変わる1音 */
  blip(at,f0,f1,dur,type,gain){
    const c=this.ctx, o=c.createOscillator(), g=c.createGain();
    o.type=type||"sine";
    o.frequency.setValueAtTime(Math.max(20,f0),at);
    if(f1&&f1!==f0) o.frequency.exponentialRampToValueAtTime(Math.max(20,f1),at+dur);
    this.env(g,at,Math.min(0.012,dur*0.2),dur,gain);
    o.connect(g); g.connect(this.sfxBus);
    o.start(at); o.stop(at+dur+0.06);
  },
  /* 雑音（打撃の芯・風切り・衝撃） */
  nz(at,dur,gain,filt){
    const c=this.ctx;
    const buf=c.createBuffer(1,Math.max(1,Math.ceil(c.sampleRate*dur)),c.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<d.length;i++) d[i]=(Math.random()*2-1)*(1-i/d.length);
    const src=c.createBufferSource(); src.buffer=buf;
    const g=c.createGain(); this.env(g,at,0.004,dur,gain);
    let tail=src;
    if(filt){
      const f=c.createBiquadFilter();
      f.type=filt.type||"lowpass";
      f.frequency.setValueAtTime(Math.max(30,filt.f0),at);
      if(filt.f1) f.frequency.exponentialRampToValueAtTime(Math.max(30,filt.f1),at+dur);
      if(filt.q) f.Q.value=filt.q;
      src.connect(f); tail=f;
    }
    tail.connect(g); g.connect(this.sfxBus);
    src.start(at); src.stop(at+dur+0.03);
  },
  chord(at,list,dur,type,gain){
    list.forEach((m,i)=>this.blip(at+i*0.012,this.freq(m),this.freq(m),dur,type||"triangle",gain));
  },

  sfx(name,o){
    if(!this.sfxReady()) return;
    o=o||{};
    const t=this.ctx.currentTime+0.005;
    const tier=Math.max(1,Math.min(4,o.tier||1));
    try{
      switch(name){
        case "tap":
          this.blip(t,780,560,0.045,"square",0.035); break;
        case "hit": {
          const g=0.16+0.05*tier;
          this.nz(t,0.06+0.02*tier,g,{type:"lowpass",f0:3600-500*tier,f1:420,q:1});
          this.blip(t,210-24*tier,54,0.16+0.05*tier,"sine",0.30+0.06*tier);
          if(tier>=3) this.blip(t+0.01,90,38,0.4,"sine",0.34);
          if(tier>=4) this.nz(t+0.03,0.5,0.1,{type:"lowpass",f0:900,f1:140});
          break;
        }
        case "crit":
          this.nz(t,0.14,0.3,{type:"lowpass",f0:2600,f1:380,q:1});
          this.blip(t,190,44,0.3,"sine",0.42);
          this.blip(t+0.015,1760,880,0.34,"square",0.085);
          this.blip(t+0.05,2640,1320,0.28,"triangle",0.06);
          this.blip(t+0.02,86,34,0.5,"sine",0.34);
          break;
        case "counter":
          this.blip(t,1480,1040,0.07,"square",0.085);
          this.blip(t+0.07,2080,1420,0.09,"square",0.07);
          this.nz(t,0.1,0.13,{type:"bandpass",f0:2400,q:2});
          break;
        case "guard":
          this.nz(t,0.16,0.2,{type:"bandpass",f0:520,q:2.5});
          this.blip(t,130,72,0.22,"sine",0.26);
          break;
        case "miss":
          this.nz(t,0.24,0.11,{type:"highpass",f0:700,f1:5600,q:0.7});
          break;
        case "heal":
          [0,1,2].forEach(i=>this.blip(t+i*0.07,[660,880,1320][i],[660,880,1320][i],0.22,"triangle",0.085));
          this.nz(t,0.3,0.03,{type:"highpass",f0:3000});
          break;
        case "status": {
          const up=!!o.good;
          this.blip(t,up?620:760,up?930:470,0.16,"triangle",0.08);
          this.blip(t+0.09,up?930:470,up?1240:330,0.2,"triangle",0.06);
          break;
        }
        case "down":
          this.blip(t,240,48,0.7,"sine",0.32);
          this.nz(t,0.5,0.14,{type:"lowpass",f0:1200,f1:120});
          break;
        case "awaken": {
          const len=o.brief?0.45:0.95;
          // 立ち上がる唸り → 炸裂 → 和音
          const c=this.ctx, saw=c.createOscillator(), sg=c.createGain(), lp=c.createBiquadFilter();
          saw.type="sawtooth";
          saw.frequency.setValueAtTime(70,t);
          saw.frequency.exponentialRampToValueAtTime(1150,t+len);
          lp.type="lowpass"; lp.frequency.setValueAtTime(300,t);
          lp.frequency.exponentialRampToValueAtTime(5200,t+len);
          sg.gain.setValueAtTime(0.0001,t);
          sg.gain.exponentialRampToValueAtTime(0.13,t+len*0.85);
          sg.gain.exponentialRampToValueAtTime(0.0001,t+len+0.12);
          saw.connect(lp); lp.connect(sg); sg.connect(this.sfxBus);
          saw.start(t); saw.stop(t+len+0.2);
          this.nz(t+len,0.7,0.26,{type:"lowpass",f0:2600,f1:160});
          this.blip(t+len,110,36,0.9,"sine",0.45);
          this.chord(t+len+0.02,[62,66,69,74],o.brief?0.7:1.3,"triangle",0.085);
          break;
        }
        case "win":
          [[67,0],[71,0.11],[74,0.22],[79,0.34]].forEach(([m,d])=>
            this.blip(t+d,this.freq(m),this.freq(m),d<0.3?0.2:0.75,"triangle",0.1));
          this.chord(t+0.34,[55,62,67],1.2,"sine",0.06);
          break;
        case "lose":
          [[64,0],[60,0.16],[55,0.34]].forEach(([m,d])=>
            this.blip(t+d,this.freq(m),this.freq(m),d<0.3?0.26:1.0,"triangle",0.09));
          this.blip(t+0.34,this.freq(43),this.freq(43),1.2,"sine",0.09);
          break;
      }
    }catch(e){ /* 音が出なくても進行は止めない */ }
  }
};

