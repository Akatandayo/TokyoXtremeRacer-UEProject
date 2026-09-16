/* =========================================================================
   09d. Media — 音の実体を置く場所。
        localStorage は約5MBしかなく、技ごとの効果音まで入れると必ず溢れる。
        実体は IndexedDB に置き、localStorage には参照ID（skill.sfxId）だけ残す。
        IndexedDB が使えない環境（プライベートモード等）では機能を止め、
        黙って失敗せずに理由を返す。
        公開API（他の担当もここを呼ぶ。名前と戻り値を変えないこと）:
          Media.putFile(file)      -> Promise<{id,name,bytes,durationMs}>
          Media.getArrayBuffer(id) -> Promise<ArrayBuffer|null>
          Media.list()             -> Promise<[{id,name,bytes,durationMs}]>
          Media.remove(id)         -> Promise<void>
          Media.exportAll()        -> Promise<{[id]:base64}>
          Media.importAll(obj)     -> Promise<void>
   ========================================================================= */
const Media = {
  DB:"awakening_media_v1", STORE:"files", VER:1,
  MAX_BYTES:512*1024,          // 1ファイルの上限
  MAX_MS:5000,                 // 長さの上限
  /* 受け付ける形式。拡張子と MIME の両方で見る（端末によって type が空になる） */
  EXT:["mp3","m4a","ogg","wav"],
  MIME:/^audio\/(mpeg|mp3|mp4|m4a|x-m4a|aac|ogg|oga|wav|x-wav|wave|vnd\.wave)$/i,
  _db:null, _meta:null, _off:null,

  /* ---------- 使えるかどうか ---------- */
  supported(){
    if(this._off!=null) return !this._off;
    let ok=true;
    try{ ok=!!(window.indexedDB); }catch(e){ ok=false; }
    this._off=!ok;
    return ok;
  },
  /* 使えない理由を日本語で返す（画面にそのまま出す） */
  reason(){
    return "この環境では音を端末に保存できません（プライベートモードなどで保存領域が使えません）。";
  },

  open(){
    if(this._db) return Promise.resolve(this._db);
    if(!this.supported()) return Promise.reject(new Error(this.reason()));
    return new Promise((res,rej)=>{
      let req;
      try{ req=indexedDB.open(this.DB,this.VER); }
      catch(e){ this._off=true; rej(new Error(this.reason())); return; }
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains(this.STORE)) db.createObjectStore(this.STORE,{keyPath:"id"});
      };
      req.onsuccess=()=>{ this._db=req.result; res(this._db); };
      req.onerror=()=>{ this._off=true; rej(new Error(this.reason())); };
      req.onblocked=()=>{ rej(new Error("別のタブが開いているため保存領域を更新できません。")); };
    });
  },
  tx(mode){
    return this.open().then(db=>{
      const t=db.transaction(this.STORE,mode);
      return t.objectStore(this.STORE);
    });
  },
  wrap(req){
    return new Promise((res,rej)=>{
      req.onsuccess=()=>res(req.result);
      req.onerror=()=>rej(req.error||new Error("保存領域に書き込めませんでした。"));
    });
  },

  /* ---------- 検証 ---------- */
  extOf(name){ const m=/\.([a-z0-9]+)$/i.exec(String(name||"")); return m?m[1].toLowerCase():""; },
  checkKind(file){
    const ext=this.extOf(file.name);
    if(this.EXT.indexOf(ext)>=0) return null;
    if(file.type&&this.MIME.test(file.type)) return null;
    return `この形式には対応していません（${this.EXT.join("・")}のいずれかをお選びください）。`;
  },
  /* 音の長さを測る。測れない端末では 0 を返し、長さの判定は見送る。 */
  durationOf(file){
    return new Promise(res=>{
      let url=null;
      try{ url=URL.createObjectURL(file); }catch(e){ res(0); return; }
      const a=document.createElement("audio");
      let done=false;
      const fin=v=>{ if(done) return; done=true; try{ URL.revokeObjectURL(url); }catch(e){} res(v); };
      a.preload="metadata";
      a.onloadedmetadata=()=>fin(isFinite(a.duration)?Math.round(a.duration*1000):0);
      a.onerror=()=>fin(-1);                       // 読めない＝壊れている
      setTimeout(()=>fin(0),4000);                 // 測れなくても固まらせない
      a.src=url;
    });
  },

  /* ---------- 書き込み ---------- */
  newId(){ return "m_"+Date.now().toString(36)+Math.floor(Math.random()*1296).toString(36); },
  putFile(file){
    if(!file) return Promise.reject(new Error("ファイルが選ばれていません。"));
    if(!this.supported()) return Promise.reject(new Error(this.reason()));
    const kind=this.checkKind(file);
    if(kind) return Promise.reject(new Error(kind));
    if(file.size>this.MAX_BYTES)
      return Promise.reject(new Error(
        `ファイルが大きすぎます（${Math.round(this.MAX_BYTES/1024)}KBまで／選んだのは${(file.size/1024).toFixed(0)}KB）。短く切り出すか、書き出し設定を下げてください。`));
    return this.durationOf(file).then(ms=>{
      if(ms<0) throw new Error("音として読み込めませんでした。別のファイルでお試しください。");
      if(ms>this.MAX_MS)
        throw new Error(`長すぎます（${(this.MAX_MS/1000).toFixed(0)}秒まで／選んだのは${(ms/1000).toFixed(1)}秒）。効果音として短く切り出してください。`);
      return this.bufOf(file).then(buf=>{
        const rec={id:this.newId(),name:String(file.name||"効果音").slice(0,40),
          type:file.type||"audio/"+this.extOf(file.name),
          bytes:buf.byteLength,durationMs:ms,at:Date.now(),data:buf};
        return this.tx("readwrite").then(st=>this.wrap(st.put(rec))).then(()=>{
          this._meta=null;
          return {id:rec.id,name:rec.name,bytes:rec.bytes,durationMs:rec.durationMs};
        });
      });
    });
  },
  /* 古い端末には File.arrayBuffer() が無いので読み方を用意しておく */
  bufOf(file){
    if(file.arrayBuffer) return file.arrayBuffer();
    return new Promise((res,rej)=>{
      const r=new FileReader();
      r.onerror=()=>rej(new Error("ファイルを読み込めませんでした。"));
      r.onload=()=>res(r.result);
      r.readAsArrayBuffer(file);
    });
  },
  /* 生のデータごと入れ直す（読み込み用） */
  putRaw(rec){
    if(!this.supported()) return Promise.reject(new Error(this.reason()));
    return this.tx("readwrite").then(st=>this.wrap(st.put(rec))).then(()=>{ this._meta=null; });
  },

  /* ---------- 読み出し ---------- */
  get(id){
    if(!id||!this.supported()) return Promise.resolve(null);
    return this.tx("readonly").then(st=>this.wrap(st.get(id))).catch(()=>null);
  },
  getArrayBuffer(id){
    return this.get(id).then(r=>(r&&r.data)?r.data:null);
  },
  info(id){
    return this.get(id).then(r=>r?{id:r.id,name:r.name,bytes:r.bytes,durationMs:r.durationMs}:null);
  },
  list(){
    if(!this.supported()) return Promise.resolve([]);
    return this.tx("readonly").then(st=>this.wrap(st.getAll()))
      .then(rows=>(rows||[]).map(r=>({id:r.id,name:r.name,bytes:r.bytes,durationMs:r.durationMs})))
      .catch(()=>[]);
  },
  remove(id){
    if(!id||!this.supported()) return Promise.resolve();
    return this.tx("readwrite").then(st=>this.wrap(st.delete(id))).then(()=>{ this._meta=null; }).catch(()=>{});
  },
  /* いまどれだけ置いているか（一覧の「端末に置いている量」に足す） */
  usage(){
    return this.list().then(rows=>({count:rows.length,bytes:rows.reduce((a,r)=>a+(r.bytes||0),0)}));
  },

  /* ---------- 書き出し／読み込み ---------- */
  b64FromBuffer(buf){
    const b=new Uint8Array(buf);
    let s="";
    for(let i=0;i<b.length;i+=0x8000) s+=String.fromCharCode.apply(null,b.subarray(i,i+0x8000));
    return btoa(s);
  },
  bufferFromB64(b64){
    const bin=atob(String(b64||""));
    const out=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
    return out.buffer;
  },
  /* 取り決めどおり {id:base64} を返す。名前や長さは meta() のほうで持ち運ぶ。 */
  exportAll(){
    if(!this.supported()) return Promise.resolve({});
    return this.tx("readonly").then(st=>this.wrap(st.getAll())).then(rows=>{
      const out={};
      (rows||[]).forEach(r=>{ if(r&&r.data) out[r.id]=this.b64FromBuffer(r.data); });
      return out;
    }).catch(()=>({}));
  },
  /* 名前・長さ・形式。書き出しJSONに一緒に入れて、読み込み時に復元する。 */
  exportMeta(){
    if(!this.supported()) return Promise.resolve({});
    return this.list().then(rows=>{
      const out={};
      rows.forEach(r=>{ out[r.id]={name:r.name,bytes:r.bytes,durationMs:r.durationMs}; });
      return out;
    }).catch(()=>({}));
  },
  /* obj は {id:base64}。meta があれば名前と長さも戻す。 */
  importAll(obj,meta){
    if(!obj||typeof obj!=="object") return Promise.resolve();
    if(!this.supported()) return Promise.resolve();
    const ids=Object.keys(obj);
    if(!ids.length) return Promise.resolve();
    meta=meta||{};
    let chain=Promise.resolve();
    ids.forEach(id=>{
      chain=chain.then(()=>{
        let buf;
        try{ buf=this.bufferFromB64(obj[id]); }catch(e){ return; }   // 壊れた1件で全部を止めない
        if(!buf||buf.byteLength>this.MAX_BYTES*2) return;
        const m=meta[id]||{};
        return this.putRaw({id,name:String(m.name||"効果音").slice(0,40),type:m.type||"audio/mpeg",
          bytes:buf.byteLength,durationMs:Number(m.durationMs)||0,at:Date.now(),data:buf}).catch(()=>{});
      });
    });
    return chain.then(()=>{ this._meta=null; });
  },

  /* ---------- 参照されていない音を片づける ---------- */
  used(){
    const set={};
    Object.keys(SKILLS).forEach(k=>{ if(SKILLS[k]&&SKILLS[k].sfxId) set[SKILLS[k].sfxId]=1; });
    return set;
  },
  sweep(){
    const keep=this.used();
    return this.list().then(rows=>{
      const dead=rows.filter(r=>!keep[r.id]);
      let chain=Promise.resolve();
      dead.forEach(r=>{ chain=chain.then(()=>this.remove(r.id)); });
      return chain.then(()=>dead.length);
    }).catch(()=>0);
  }
};
