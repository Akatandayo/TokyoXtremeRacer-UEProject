/* =========================================================================
   04. Store — 追加キャラ／技の保存。localStorage が使えない環境では
       メモリ上に保持し、JSONの書き出し／読み込みで持ち運ぶ。
   ========================================================================= */
const Store = {
  KEY:"awakening_trpg_battle_v1",
  PKEY:"awakening_trpg_prefs_v1",
  mem:null, memPrefs:null,
  prefs:{speed:"fast", muted:false},
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
    try{ window.localStorage.setItem(this.PKEY,raw); }catch(e){}
  },
  load(){
    let raw=null;
    try{ raw = window.localStorage.getItem(this.KEY); }catch(e){ raw=null; }
    if(!raw) raw=this.mem;
    if(!raw) return;
    try{ this.apply(JSON.parse(raw)); }catch(e){ console.warn("保存データを読めませんでした",e); }
  },
  apply(data){
    if(data.skills) Object.keys(data.skills).forEach(k=>{ SKILLS[k]=data.skills[k]; });
    if(data.characters) Object.keys(data.characters).forEach(k=>{ CHARACTERS[k]=data.characters[k]; });
  },
  save(){
    const custom={skills:{},characters:{}};
    Object.keys(SKILLS).forEach(k=>{ if(SKILLS[k].custom) custom.skills[k]=SKILLS[k]; });
    Object.keys(CHARACTERS).forEach(k=>{ if(CHARACTERS[k].custom) custom.characters[k]=CHARACTERS[k]; });
    const raw=JSON.stringify(custom);
    this.mem=raw;
    try{ window.localStorage.setItem(this.KEY,raw); }catch(e){ /* メモリ保持のみ */ }
  },
  /* 自分で作った分だけを書き出す（元から入っているキャラと技はアプリ側にある） */
  exportData(){
    const out={format:"awakening-battle", version:1,
      exportedAt:new Date().toISOString(), characters:{}, skills:{}};
    Object.keys(CHARACTERS).forEach(k=>{ if(CHARACTERS[k].custom) out.characters[k]=CHARACTERS[k]; });
    Object.keys(SKILLS).forEach(k=>{ if(SKILLS[k].custom) out.skills[k]=SKILLS[k]; });
    return out;
  },
  exportAll(){ return JSON.stringify(this.exportData(),null,2); },

  /* 読み込み。件数を返し、壊れたデータは弾く */
  importData(data){
    if(!data||typeof data!=="object") throw new Error("形式が違います");
    const chars=data.characters||{}, skills=data.skills||{};
    let nc=0, ns=0;
    Object.keys(skills).forEach(k=>{
      const s=skills[k];
      if(!s||!s.name||k==="basic_attack") return;
      s.custom=true; s.id=k; SKILLS[k]=s; ns++;
    });
    Object.keys(chars).forEach(k=>{
      const c=chars[k];
      if(!c||!c.name||!c.stats||!Array.isArray(c.skills)) return;
      c.custom=true; c.id=k; CHARACTERS[k]=c; nc++;
    });
    if(!nc&&!ns) throw new Error("読み込めるデータがありませんでした");
    this.save();
    return {characters:nc, skills:ns};
  },

  /* 端末のファイルとして保存する */
  fileName(){
    const d=new Date(), p=n=>String(n).padStart(2,"0");
    return `覚醒_キャラクター_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}.json`;
  },
  download(){
    const json=JSON.stringify(this.exportData(),null,2);
    const blob=new Blob([json],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url; a.download=this.fileName();
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
    return json.length;
  }
};

