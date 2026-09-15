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
    o.connect(g); g.connect(this.master);
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
    src.connect(hp); hp.connect(g); g.connect(this.master);
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
  }
};

