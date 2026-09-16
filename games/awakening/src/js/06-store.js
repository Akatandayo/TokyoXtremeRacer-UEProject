/* =========================================================================
   04. Store — 追加キャラ／技の保存。localStorage が使えない環境では
       メモリ上に保持し、JSONの書き出し／読み込みで持ち運ぶ。
       保存が失敗したときは必ず理由を返す（黙って消えるのが一番まずい）。
   ========================================================================= */
const Store = {
  KEY:"awakening_trpg_battle_v1",     // 旧版と同じキー・同じ形。壊さない。
  PKEY:"awakening_trpg_prefs_v1",
  DKEY:"awakening_trpg_draft_v1",     // 作りかけの下書き
  FORMAT:"awakening-battle", VERSION:2,
  mem:null, memPrefs:null, memDraft:null,
  prefs:{speed:"fast", muted:false},
  lastError:null,                     // 直近の保存失敗の理由（UIが拾って知らせる）
  onSaveFail:null,                    // UI側が差し込む通知口

  /* ---------- 低レベル ---------- */
  ls(){ try{ return window.localStorage; }catch(e){ return null; } },
  bytes(s){ try{ return new Blob([s]).size; }catch(e){ return String(s).length*2; } },
  isQuota(e){
    if(!e) return false;
    return e.name==="QuotaExceededError"||e.name==="NS_ERROR_DOM_QUOTA_REACHED"||e.code===22||e.code===1014;
  },
  writeRaw(key,raw){
    const s=this.ls();
    if(!s) return {ok:false,reason:"unavailable"};
    try{ s.setItem(key,raw); return {ok:true}; }
    catch(e){ return {ok:false,reason:this.isQuota(e)?"quota":"error",error:e}; }
  },

  loadPrefs(){
    let raw=null;
    try{ raw=window.localStorage.getItem(this.PKEY); }catch(e){}
    if(!raw) raw=this.memPrefs;
    if(!raw) return;
    try{ Object.assign(this.prefs,JSON.parse(raw)); }catch(e){}
  },
  savePrefs(){
    const raw=JSON.stringify(this.prefs);
    this.memPrefs=raw;
    this.writeRaw(this.PKEY,raw);
  },

  load(){
    let raw=null;
    try{ raw = window.localStorage.getItem(this.KEY); }catch(e){ raw=null; }
    if(!raw) raw=this.mem;
    if(!raw) return;
    try{ this.apply(this.migrate(JSON.parse(raw))); }
    catch(e){ console.warn("保存データを読めませんでした",e); }
  },
  /* 古い形（配列・v1）を今の形に寄せる。読めなくなる事故を防ぐための吸収層。 */
  migrate(data){
    if(!data||typeof data!=="object") return {characters:{},skills:{}};
    const toMap=(x,prefix)=>{
      if(!x) return {};
      if(Array.isArray(x)){
        const m={};
        x.forEach((v,i)=>{ if(v&&typeof v==="object"){ const id=v.id||(prefix+i); v.id=id; m[id]=v; } });
        return m;
      }
      return x;
    };
    const out={characters:toMap(data.characters,"c_"),skills:toMap(data.skills,"s_")};
    Object.keys(out.characters).forEach(k=>{
      const c=out.characters[k];
      if(!c||typeof c!=="object") { delete out.characters[k]; return; }
      c.id=c.id||k; c.custom=true;
      if(!c.stats) c.stats={hp:1200,atk:130,def:85,spd:100};
      if(!Array.isArray(c.skills)) c.skills=[];
      // 覚醒がまるごと無い古いデータでも落ちないようにする
      if(!c.awakening) c.awakening={enabled:false,name:"覚醒形態",conditionMode:"ANY",
        conditions:[{type:"HP_BELOW",value:0.4,label:"HPが40%以下になる"}],
        form:{stats:{...c.stats},skills:c.skills.slice(),effects:[]},
        duration:4,oneTime:true,cost:{hpPerTurn:0,label:""},afterEffects:[]};
      if(!c.awakening.form) c.awakening.form={stats:{...c.stats},skills:[],effects:[]};
      if(!Array.isArray(c.awakening.conditions)||!c.awakening.conditions.length)
        c.awakening.conditions=[{type:"HP_BELOW",value:0.4,label:"HPが40%以下になる"}];
    });
    Object.keys(out.skills).forEach(k=>{
      const s=out.skills[k];
      if(!s||typeof s!=="object"||!s.name){ delete out.skills[k]; return; }
      s.id=s.id||k; s.custom=true;
      if(!Array.isArray(s.effects)) s.effects=[];
    });
    return out;
  },
  apply(data){
    if(data.skills) Object.keys(data.skills).forEach(k=>{ SKILLS[k]=data.skills[k]; });
    if(data.characters) Object.keys(data.characters).forEach(k=>{ CHARACTERS[k]=data.characters[k]; });
  },

  /* 保存。戻り値 {ok,reason,bytes} — 呼び出し側は必ず ok を見ること。 */
  save(){
    const custom={skills:{},characters:{}};
    Object.keys(SKILLS).forEach(k=>{ if(SKILLS[k].custom) custom.skills[k]=SKILLS[k]; });
    Object.keys(CHARACTERS).forEach(k=>{ if(CHARACTERS[k].custom) custom.characters[k]=CHARACTERS[k]; });
    const raw=JSON.stringify(custom);
    this.mem=raw;                                  // 端末に書けなくても今回の起動中は残る
    const res=this.writeRaw(this.KEY,raw);
    res.bytes=this.bytes(raw);
    this.lastError=res.ok?null:res.reason;
    if(!res.ok&&this.onSaveFail) this.onSaveFail(res);
    return res;
  },
  /* いま端末に置かれている量（目安）と重いキャラ */
  usage(){
    const raw=this.mem||"";
    const per=Object.values(CHARACTERS).filter(c=>c.custom).map(c=>({
      id:c.id,name:c.name,bytes:this.bytes(JSON.stringify(c))
    })).sort((a,b)=>b.bytes-a.bytes);
    return {bytes:this.bytes(raw), limit:5*1024*1024, heavy:per.slice(0,3), all:per};
  },

  /* ---------- 下書き（作りかけ） ----------
     形は {at, draft:<キャラ>, editingId, step} で平らに持つ。
     以前は {at, draft:{draft,...}} と二重に包んでいたので、読むときにほどく。 */
  saveDraft(d){
    if(!d||!d.draft){ this.clearDraft(); return {ok:true}; }
    const raw=JSON.stringify({at:Date.now(),draft:d.draft,
      editingId:d.editingId||null,step:d.step||0});
    this.memDraft=raw;
    return this.writeRaw(this.DKEY,raw);
  },
  loadDraft(){
    let raw=null;
    try{ raw=window.localStorage.getItem(this.DKEY); }catch(e){}
    if(!raw) raw=this.memDraft;
    if(!raw) return null;
    let o=null;
    try{ o=JSON.parse(raw); }catch(e){ return null; }
    if(!o||typeof o!=="object"||!o.draft||typeof o.draft!=="object") return null;
    // 旧形式（二重包み）をほどく
    if(o.draft.draft&&typeof o.draft.draft==="object")
      o={at:o.at,draft:o.draft.draft,editingId:o.draft.editingId||null,step:o.draft.step||0};
    if(!o.draft.stats&&!("name" in o.draft)) return null;   // 中身が壊れていたら無かったことにする
    o.step=Math.max(0,Math.min(20,Number(o.step)||0));
    return o;
  },
  clearDraft(){
    this.memDraft=null;
    const s=this.ls(); if(s) try{ s.removeItem(this.DKEY); }catch(e){}
  },

  /* 自分で作った分だけを書き出す（元から入っているキャラと技はアプリ側にある） */
  exportData(opt){
    opt=opt||{};
    const out={format:this.FORMAT, version:this.VERSION,
      exportedAt:new Date().toISOString(), characters:{}, skills:{}};
    Object.keys(CHARACTERS).forEach(k=>{
      if(!CHARACTERS[k].custom) return;
      const c=CHARACTERS[k];
      if(!opt.stripMedia){ out.characters[k]=c; return; }
      // 共有用の軽い形：立ち絵・音の実体をぜんぶ落とす（覚醒形態の立ち絵も含む）
      const lite=Object.assign({},c,{portraitImage:null,bgmAudio:null,bgmAudioName:null});
      if(lite.awakening&&lite.awakening.form)
        lite.awakening=Object.assign({},lite.awakening,
          {form:Object.assign({},lite.awakening.form,{portraitImage:null})});
      out.characters[k]=lite;
    });
    Object.keys(SKILLS).forEach(k=>{
      if(!SKILLS[k].custom) return;
      out.skills[k]=opt.stripMedia?Object.assign({},SKILLS[k],{sfxId:null}):SKILLS[k];
    });
    return out;
  },
  /* 音の実体まで含めた書き出し。IndexedDB を読むので非同期。
     opt.media が真なら {media:{id:base64}, mediaMeta:{id:{...}}} を足す。 */
  exportBundle(opt){
    opt=opt||{};
    const base=this.exportData(opt);
    if(!opt.media||typeof Media==="undefined") return Promise.resolve(base);
    return Promise.all([Media.exportAll(),Media.exportMeta()]).then(([m,meta])=>{
      if(m&&Object.keys(m).length){ base.media=m; base.mediaMeta=meta||{}; }
      return base;
    }).catch(()=>base);
  },
  exportAll(){ return JSON.stringify(this.exportData(),null,2); },
  /* 書き出しの重さを先に知らせるための見積り（KB） */
  sizeOf(data){ return Math.round(this.bytes(JSON.stringify(data))/1024); },
  counts(d){ return {characters:Object.keys(d.characters||{}).length, skills:Object.keys(d.skills||{}).length}; },

  /* ---------- 読み込み ----------
     失敗は必ず例外の message に「何が起きたか」を日本語で入れる。 */
  parse(text){
    const t=String(text||"").trim();
    if(!t) throw new Error("中身が空です。全文を貼り付けてください。");
    if(t[0]!=="{"&&t[0]!=="["){
      const d=this.decode(t);                       // 合言葉コードかもしれない
      if(d) return d;
      throw new Error("読み込める形式ではありません。書き出したJSONか、共有コードを貼り付けてください。");
    }
    try{ return JSON.parse(t); }
    catch(e){ throw new Error("JSONとして壊れています（"+String(e.message).slice(0,40)+"）。全文がそろっているか確認してください。"); }
  },
  importData(data){
    if(!data||typeof data!=="object") throw new Error("形式が違います。");
    if(data.format&&data.format!==this.FORMAT)
      throw new Error("別のアプリのデータのようです（"+esc(String(data.format).slice(0,24))+"）。");
    const src=this.migrate(data);
    const chars=src.characters, skills=src.skills;
    let nc=0, ns=0, skipped=0;
    Object.keys(skills).forEach(k=>{
      const s=skills[k];
      if(!s||!s.name||k==="basic_attack"){ skipped++; return; }
      s.custom=true; s.id=k; SKILLS[k]=s; ns++;
    });
    Object.keys(chars).forEach(k=>{
      const c=chars[k];
      if(!c||!c.name||!c.stats||!Array.isArray(c.skills)){ skipped++; return; }
      // 存在しない技IDを持っていても戦えるように落としておく
      c.skills=c.skills.filter(id=>SKILLS[id]);
      if(c.awakening&&c.awakening.form&&Array.isArray(c.awakening.form.skills))
        c.awakening.form.skills=c.awakening.form.skills.filter(id=>SKILLS[id]);
      if(!c.skills.length) c.skills=["basic_attack"];
      c.custom=true; c.id=k; CHARACTERS[k]=c; nc++;
    });
    if(!nc&&!ns) throw new Error("読み込めるキャラクターも技もありませんでした。");
    const res=this.save();
    // 音の実体は IndexedDB へ。落ちても本体の読み込みは成立させる。
    let media=0, mediaPromise=Promise.resolve();
    if(data.media&&typeof data.media==="object"&&typeof Media!=="undefined"){
      media=Object.keys(data.media).length;
      if(!Media.supported()) media=-1;                     // 使えない環境だと知らせる
      else mediaPromise=Media.importAll(data.media,data.mediaMeta||{}).catch(()=>{});
    }
    return {characters:nc, skills:ns, skipped, saved:res.ok, saveReason:res.reason, media, mediaPromise};
  },

  /* ---------- 共有コード（短い文字列） ----------
     LZW で縮めて base64url にする。外部ライブラリは使わない。 */
  compress(str){
    const dictInit=()=>{ const d=new Map(); for(let i=0;i<256;i++) d.set(String.fromCharCode(i),i); return d; };
    const bytes=unescape(encodeURIComponent(str));   // UTF-8 のバイト列を1文字1バイトで持つ
    let dict=dictInit(), next=256, w="", out=[];
    for(let i=0;i<bytes.length;i++){
      const c=bytes[i], wc=w+c;
      if(dict.has(wc)) w=wc;
      else{
        out.push(dict.get(w));
        if(next<65536) dict.set(wc,next++);
        else { dict=dictInit(); next=256; }
        w=c;
      }
    }
    if(w!=="") out.push(dict.get(w));
    let bin="";
    for(let i=0;i<out.length;i++){ const v=out[i]; bin+=String.fromCharCode(v>>8,v&255); }
    return btoa(bin).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  },
  decompress(code){
    let b64=String(code).trim().replace(/-/g,"+").replace(/_/g,"/");
    while(b64.length%4) b64+="=";
    const bin=atob(b64);
    const codes=[];
    for(let i=0;i+1<bin.length;i+=2) codes.push((bin.charCodeAt(i)<<8)|bin.charCodeAt(i+1));
    const dictInit=()=>{ const d=[]; for(let i=0;i<256;i++) d.push(String.fromCharCode(i)); return d; };
    let dict=dictInit(), next=256;
    if(!codes.length) return "";
    let w=dict[codes[0]], out=w;
    for(let i=1;i<codes.length;i++){
      const k=codes[i];
      let entry;
      if(k<dict.length) entry=dict[k];
      else if(k===next) entry=w+w[0];
      else throw new Error("コードが壊れています。");
      out+=entry;
      if(next<65536) dict[next++]=w+entry[0];
      else { dict=dictInit(); next=256; }
      w=entry;
    }
    return decodeURIComponent(escape(out));
  },
  b64(str){
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
  },
  unb64(code){
    let b64=String(code).replace(/-/g,"+").replace(/_/g,"/");
    while(b64.length%4) b64+="=";
    return decodeURIComponent(escape(atob(b64)));
  },
  /* 小さいデータでは素の base64 のほうが短い。短いほうを選んで前置きで見分ける。 */
  encodeString(json){
    const lz="AWK1."+this.compress(json), raw="AWK0."+this.b64(json);
    return lz.length<=raw.length?lz:raw;
  },
  encode(opt){ return this.encodeString(JSON.stringify(this.exportData(opt))); },
  decode(text){
    const t=String(text||"").trim().replace(/\s+/g,"");
    const tag=t.slice(0,5);
    if(tag!=="AWK1."&&tag!=="AWK0.") return null;
    let json;
    try{ json=tag==="AWK1."?this.decompress(t.slice(5)):this.unb64(t.slice(5)); }
    catch(e){ throw new Error("共有コードが壊れています。全文がそろっているか確認してください。"); }
    try{ return JSON.parse(json); }
    catch(e){ throw new Error("共有コードを展開できませんでした。"); }
  },

  /* 端末のファイルとして保存する */
  fileName(){
    const d=new Date(), p=n=>String(n).padStart(2,"0");
    return `覚醒_キャラクター_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}.json`;
  },
  /* opt: {media:true で音も入れる, stripMedia:true で画像も抜く} */
  download(opt){
    return this.exportBundle(opt).then(data=>{
      const json=JSON.stringify(data,null,2);
      const blob=new Blob([json],{type:"application/json"});
      const url=URL.createObjectURL(blob);
      const a=document.createElement("a");
      a.href=url; a.download=this.fileName();
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2000);
      return json.length;
    });
  }
};
