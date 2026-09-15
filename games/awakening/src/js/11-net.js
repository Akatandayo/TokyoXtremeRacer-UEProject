/* =========================================================================
   07c. Net — あいことば方式のオンライン対戦（P2P）

   つまずきやすい点をこちらで吸収する設計にしている。
   ・「部屋を作る／参加する」を選ばせない。両者とも同じボタンでよい。
     まず部屋を開こうとし、すでに誰かが開いていたら自動で参加側に回る。
   ・相手が先に押していなくても、見つかるまで自動で探し直す。
   ・携帯回線などP2Pが直接つながらない環境のために中継サーバー(TURN)も使う。
   ・信号サーバーとの一時的な切断では対戦を止めず、裏でつなぎ直す。
   ========================================================================= */
const Net = {
  peer:null, conn:null, pending:null, role:null, word:"", handlers:{},
  closed:true, live:false, joinTries:0, swaps:0, lastSeen:0, pingTimer:null,

  LIB:"https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js",
  ICE:{iceServers:[
    {urls:["stun:stun.l.google.com:19302","stun:stun1.l.google.com:19302"]},
    {urls:["turn:openrelay.metered.ca:80","turn:openrelay.metered.ca:443",
           "turn:openrelay.metered.ca:443?transport=tcp"],
     username:"openrelayproject", credential:"openrelayproject"}
  ]},

  loadLib(){
    if(window.Peer) return Promise.resolve();
    if(this._loading) return this._loading;
    this._loading=new Promise((res,rej)=>{
      const sc=document.createElement("script");
      sc.src=this.LIB; sc.onload=()=>res(); sc.onerror=()=>rej(new Error("no-lib"));
      document.head.appendChild(sc);
    });
    return this._loading;
  },
  roomId(word){
    let h=2166136261>>>0;
    const w=String(word).trim().toLowerCase().replace(/\s+/g,"");
    for(const ch of w){ h^=ch.codePointAt(0); h=Math.imul(h,16777619)>>>0; }
    return "awkbtl"+NET_PROTOCOL+"-"+h.toString(36);
  },
  fire(name,arg){ const h=this.handlers[name]; if(h) h(arg); },
  status(text,cls){ this.fire("onStatus",{text,cls}); },

  /* ---------- 接続開始（役割は自動で決まる） ---------- */
  start(word, handlers){
    this.close();
    this.handlers=handlers||{};
    this.word=word; this.closed=false; this.live=false;
    this.joinTries=0; this.swaps=0;
    this.status("つなぐ準備をしています…","wait");
    this.loadLib().then(()=>{ if(!this.closed) this.tryHost(); })
      .catch(()=>this.status(this.errorText({type:"no-lib"}),"bad"));
  },
  dropPeer(){
    if(this.pending){ try{ this.pending.close(); }catch(e){} this.pending=null; }
    if(this.peer){ try{ this.peer.removeAllListeners&&this.peer.removeAllListeners(); }catch(e){}
      try{ this.peer.destroy(); }catch(e){} this.peer=null; }
  },
  newPeer(id){
    return new window.Peer(id,{debug:0,config:this.ICE});
  },

  tryHost(){
    if(this.closed) return;
    this.dropPeer();
    this.role="host";
    this.status("あいことばで待ち合わせ中…","wait");
    let p;
    try{ p=this.peer=this.newPeer(this.roomId(this.word)); }
    catch(e){ this.status(this.errorText(e),"bad"); return; }
    p.on("open",()=>{
      if(this.closed||this.role!=="host") return;
      this.fire("onRole","host");
      this.status(`<div class="word">${this.word}</div>このあいことばを相手に伝えてください。相手が同じ言葉で「つながる」を押すと始まります。`,"wait");
    });
    p.on("connection",c=>{
      if(this.closed||this.conn) return;
      this.bind(c);
    });
    p.on("error",e=>this.onPeerError(e));
    p.on("disconnected",()=>this.softReconnect());
  },

  tryJoin(){
    if(this.closed) return;
    this.dropPeer();
    this.role="guest"; this.joinTries=0;
    this.status("相手の部屋をさがしています…","wait");
    let p;
    try{ p=this.peer=this.newPeer(undefined); }
    catch(e){ this.status(this.errorText(e),"bad"); return; }
    p.on("open",()=>{ if(!this.closed&&this.role==="guest") this.attempt(); });
    p.on("error",e=>this.onPeerError(e));
    p.on("disconnected",()=>this.softReconnect());
  },
  attempt(){
    if(this.closed||this.conn||!this.peer) return;
    this.joinTries++;
    let c;
    try{ c=this.peer.connect(this.roomId(this.word),{reliable:true}); }
    catch(e){ this.retryJoin(); return; }
    this.pending=c;
    c.on("open",()=>{
      if(this.closed) return;
      this.pending=null;
      this.fire("onRole","guest");
      this.bind(c);
    });
    c.on("error",()=>{});
    // 一定時間でつながらなければ、つなぎ直す
    setTimeout(()=>{
      if(this.closed||this.conn) return;
      if(this.pending===c){ try{ c.close(); }catch(e){} this.pending=null; this.retryJoin(); }
    },4000);
  },
  retryJoin(){
    if(this.closed||this.conn) return;
    if(this.joinTries<5){
      this.status(`相手の部屋をさがしています…（${this.joinTries}回目）`,"wait");
      setTimeout(()=>this.attempt(),900);
    }else this.swapRole();
  },
  /* 相手も同時に部屋を開こうとしていた場合や、古い部屋が残っていた場合の逃げ道 */
  swapRole(){
    if(this.closed||this.conn) return;
    this.swaps++;
    if(this.swaps>3){
      this.status("相手が見つかりませんでした。二人とも同じあいことばで「つながる」を押しているか確認して、もう一度お試しください。","bad");
      this.dropPeer();
      return;
    }
    if(this.role==="host") this.tryJoin(); else this.tryHost();
  },
  onPeerError(e){
    const t=(e&&e.type)||"";
    if(this.closed) return;
    if(t==="unavailable-id"){ this.tryJoin(); return; }        // 相手がすでに部屋を開いていた
    if(t==="peer-unavailable"){ this.retryJoin(); return; }    // まだ相手が来ていない
    if(t==="network"||t==="socket-error"||t==="server-error"||t==="socket-closed"){
      if(this.live){ this.softReconnect(); return; }           // 対戦中は止めない
      this.status("接続サーバーに届きませんでした。通信環境を確認して、もう一度お試しください。","bad");
      return;
    }
    if(t==="browser-incompatible"){ this.status(this.errorText(e),"bad"); return; }
    if(this.live) return;                                      // 対戦中の細かなエラーは無視する
    this.status(this.errorText(e),"bad");
  },
  softReconnect(){
    if(this.closed||!this.peer) return;
    try{ if(this.peer.disconnected&&!this.peer.destroyed) this.peer.reconnect(); }catch(e){}
  },

  bind(conn){
    this.conn=conn; this.live=true; this.lastSeen=Date.now();
    conn.on("data",d=>{
      this.lastSeen=Date.now();
      if(d&&d.t==="ping"){ this.send({t:"pong"}); return; }
      if(d&&d.t==="pong") return;
      this.fire("onData",d);
    });
    conn.on("close",()=>{ if(!this.closed){ this.live=false; this.fire("onClose"); } });
    conn.on("error",()=>{});
    if(this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer=setInterval(()=>{
      if(!this.connected()){ return; }
      this.send({t:"ping"});
    },8000);
    this.fire("onConnect",this.role);
  },
  send(obj){
    try{ if(this.conn&&this.conn.open){ this.conn.send(obj); return true; } }catch(e){}
    return false;
  },
  connected(){ return !!(this.conn&&this.conn.open); },
  quiet(){ return this.live && (Date.now()-this.lastSeen)>25000; },
  close(){
    this.closed=true; this.live=false;
    if(this.pingTimer){ clearInterval(this.pingTimer); this.pingTimer=null; }
    if(this.conn){ try{ this.conn.close(); }catch(e){} this.conn=null; }
    this.dropPeer();
    this.role=null;
  },
  errorText(e){
    const t=(e&&e.type)||"";
    if(t==="no-lib") return "通信の部品を読み込めませんでした。インターネットにつながった状態で開いてください。";
    if(t==="browser-incompatible") return "このブラウザはP2P通信に対応していません。Safari・Chrome・Edgeの最新版でお試しください。";
    return "接続に失敗しました。もう一度お試しください。";
  }
};

