/* =========================================================================
   09g. Vault — 端末に置いたもの（立ち絵・覚醒立ち絵・キャラBGM・効果音）の内訳。
        上限が大きくなったぶん、「何にどれだけ使っているか」が見えないと不安になる。
        ここでは数えて見せることと、要らないものを消すことだけを行う。
        実体の置き場は Media（IndexedDB）。差し札の付け外しは Store に任せる。
   ========================================================================= */
Object.assign(UI,{
  /* IndexedDB の鍵の作り方は Store.stash と同じ決まりで作る */
  mediaKeys(c){ return {face:`c_${c.id}_face`,bgm:`c_${c.id}_bgm`,awk:`c_${c.id}_awk`}; },
  MEDIA_LABEL:{face:"立ち絵",awk:"覚醒の立ち絵",bgm:"キャラBGM"},

  mb(n){
    if(!(n>0)) return "0";
    if(n<1024) return n+"B";
    if(n<1048576) return (n/1024).toFixed(0)+"KB";
    return (n/1048576).toFixed(1)+"MB";
  },

  /* 一覧の「端末に置いている量」から開く。中身は開くたびに数え直す。 */
  openVault(){
    const sheet=Kit.sheet({title:"置いているもの",sub:"内訳と整理",
      html:`<div id="vault"><div class="status">数えています…</div></div>`,
      onMount:(body)=>{ this._vaultBody=body; this.paintVault(); }});
    this._vault=sheet;
    return sheet;
  },
  closeVault(){ if(this._vault){ this._vault.close(); this._vault=null; } },

  paintVault(){
    const box=this._vaultBody&&this._vaultBody.querySelector("#vault");
    if(!box) return;
    if(typeof Media==="undefined"||!Media.supported()){
      const why=typeof Media!=="undefined"?Media.reason():"この環境では立ち絵や音を端末に残せません。";
      box.innerHTML=`<div class="status bad">${esc(why)}</div>
        <p class="note">立ち絵や音は端末に残せませんが、ファイルに書き出せば別の端末で戻せます。</p>`;
      return;
    }
    Promise.all([Media.list(),Media.estimate()]).then(([rows,est])=>{
      const rec={};
      (rows||[]).forEach(r=>{ rec[r.id]=r; });
      const used=Media.used();
      const chars=Object.values(CHARACTERS).filter(c=>c.custom);
      const skills=Object.values(SKILLS).filter(s=>s.custom&&s.sfxId);
      let total=0;
      (rows||[]).forEach(r=>{ total+=r.bytes||0; });
      const orphan=(rows||[]).filter(r=>!used[r.id]);
      const orphanBytes=orphan.reduce((a,r)=>a+(r.bytes||0),0);

      /* --- キャラクターごとの内訳 --- */
      const charRows=chars.map(c=>{
        const k=this.mediaKeys(c);
        const parts=["face","awk","bgm"].map(t=>({t,r:rec[k[t]]})).filter(x=>x.r);
        const sum=parts.reduce((a,x)=>a+(x.r.bytes||0),0);
        if(!parts.length) return "";
        return `<div class="vrow" data-c="${esc(c.id)}">
          <div class="vr-h">${this.avatar(c,"44")}
            <div class="vr-t"><b>${esc(c.name)}</b><span>${this.mb(sum)}</span></div></div>
          <div class="vr-b">${parts.map(x=>
            `<button class="vchip" data-drop="${x.t}" data-id="${esc(c.id)}">
              <b>${this.MEDIA_LABEL[x.t]}</b><span>${this.mb(x.r.bytes||0)}</span><em>外す</em></button>`).join("")}</div>
        </div>`;
      }).filter(Boolean).join("");

      /* --- 技の効果音 --- */
      const sfxRows=skills.map(s=>{
        const r=rec[s.sfxId];
        return `<div class="vrow" data-s="${esc(s.id)}">
          <div class="vr-h"><span class="vr-i">♪</span>
            <div class="vr-t"><b>${esc(r?r.name:"見つかりません")}</b>
              <span>${esc(s.name)}${r?`　${this.mb(r.bytes||0)}${r.durationMs?"／"+(r.durationMs/1000).toFixed(1)+"秒":""}`:"　実体がありません"}</span></div></div>
          <div class="vr-b">
            ${r&&typeof Music!=="undefined"&&Music.previewSfx?`<button class="vchip" data-play="${esc(s.sfxId)}"><b>試聴</b><em>▶</em></button>`:""}
            <button class="vchip danger" data-sfxdrop="${esc(s.id)}"><b>音を外す</b><em>✕</em></button></div>
        </div>`;
      }).join("");

      /* 端末側の集計は少し遅れて追いつくので、いま数えた量のほうが大きければそちらを採る */
      const q=est&&est.quota?est.quota:0;
      const u=Math.max(est&&est.usage?est.usage:0,total);
      const pct=q?Math.max(1,Math.min(100,u/q*100)):0;
      box.innerHTML=`
        ${q?`<div class="vgauge">
          <div class="vg-top"><span>端末で使える保存領域</span><b>残り ${this.mb(Math.max(0,q-u))}</b></div>
          <div class="vg-track"><i style="transform:scaleX(${(pct/100).toFixed(4)})"></i></div>
          <div class="note">このゲームが置いているのは ${this.mb(total)}（ほかのアプリと合わせて ${this.mb(u)} / ${this.mb(q)}）。
            立ち絵も音も、この端末の中だけに残ります。</div>
        </div>`:`<div class="status">端末の空き容量は取得できませんでした。置いている量は ${this.mb(total)} です。</div>`}
        ${charRows?`<div class="h-rule">キャラクターごと</div>${charRows}`:""}
        ${sfxRows?`<div class="h-rule">技の効果音</div>${sfxRows}`:""}
        ${!charRows&&!sfxRows?`<p class="note" style="margin-top:12px">端末にはまだ何も置いていません。
          立ち絵や効果音を付けると、ここに内訳が出ます。</p>`:""}
        ${orphan.length?`<div class="h-rule">どこからも使われていないもの</div>
          <div class="status">${orphan.length}件・${this.mb(orphanBytes)}。消したキャラや、付け替えた音の残りです。</div>
          <button class="btn btn-line" id="v-sweep" style="margin-top:9px">まとめて消す（${this.mb(orphanBytes)}）</button>`:""}
        <p class="note" style="margin-top:12px">ここで消したものは元に戻せません。
          残したいものは先に「ファイルに保存」でまるごと書き出してください。</p>`;
      this.bindVault();
    }).catch(()=>{
      box.innerHTML=`<div class="status bad">内訳を読み取れませんでした。</div>`;
    });
  },

  bindVault(){
    const box=this._vaultBody&&this._vaultBody.querySelector("#vault");
    if(!box) return;
    box.querySelectorAll("[data-play]").forEach(b=>b.onclick=()=>{
      try{ Music.previewSfx(b.dataset.play); }catch(e){ Kit.toast("音を鳴らせませんでした。",{tone:"bad"}); }
    });
    box.querySelectorAll("[data-drop]").forEach(b=>b.onclick=()=>
      this.dropCharMedia(b.dataset.id,b.dataset.drop));
    box.querySelectorAll("[data-sfxdrop]").forEach(b=>b.onclick=()=>
      this.dropSkillSfx(b.dataset.sfxdrop));
    const sw=box.querySelector("#v-sweep");
    if(sw) sw.onclick=async()=>{
      if(!await Kit.confirm({title:"使われていないものを消しますか",
        body:"どのキャラ・どの技からも参照されていないファイルだけを消します。元に戻せません。",
        ok:"消す",cancel:"やめる",danger:true})) return;
      Media.sweep().then(n=>{
        Kit.toast(n?`${n}件を消しました。`:"消せるものはありませんでした。",{tone:n?"ok":null});
        this.paintVault(); this.renderStorage();
      });
    };
  },

  /* 立ち絵・覚醒立ち絵・キャラBGM を1つだけ外す */
  async dropCharMedia(id,which){
    const c=CHARACTERS[id];
    if(!c) return;
    const label=this.MEDIA_LABEL[which]||"メディア";
    if(!await Kit.confirm({title:`${label}を外しますか`,
      body:`「${c.name}」の${label}を端末から消します。元に戻せません。`,
      ok:"外す",cancel:"やめる",danger:true})) return;
    if(which==="face") c.portraitImage=null;
    else if(which==="bgm"){ c.bgmAudio=null; c.bgmAudioName=null; }
    else if(which==="awk"&&c.awakening&&c.awakening.form) c.awakening.form.portraitImage=null;
    const res=Store.save();
    await Media.remove(this.mediaKeys(c)[which]);
    Kit.toast(res.ok?`「${c.name}」の${label}を外しました。`:"外しましたが端末に保存できませんでした。",
      {tone:res.ok?"ok":"bad"});
    this.paintVault(); this.renderRosterList(); this.renderStorage();
  },
  /* 技から効果音を外す（実体も消す） */
  async dropSkillSfx(id){
    const s=SKILLS[id];
    if(!s) return;
    if(!await Kit.confirm({title:"効果音を外しますか",
      body:`「${s.name}」の音を端末から消します。元に戻せません。`,
      ok:"外す",cancel:"やめる",danger:true})) return;
    const old=s.sfxId;
    s.sfxId=null;
    const res=Store.save();
    if(old) await Media.remove(old);
    Kit.toast(res.ok?`「${s.name}」の効果音を外しました。`:"外しましたが端末に保存できませんでした。",
      {tone:res.ok?"ok":"bad"});
    this.paintVault(); this.renderSkillList(); this.renderStorage();
  }
});
