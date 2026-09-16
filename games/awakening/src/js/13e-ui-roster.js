/* ===== UI：キャラクター一覧（探す・並べ替える・複製する・取り消せる） ===== */
Object.assign(UI, {
  rosterQuery:"", rosterSort:"new", rosterTab:"all", _undo:null,

  /* ---------- 一覧 ---------- */
  renderRoster(){
    this.initRoster();
    this.renderDraftBanner();
    this.renderRosterList();
    this.renderSkillList();
    this.renderStorage();
  },
  /* 起動時の配線を一度だけ上書きする（トーストや取り消しに寄せるため） */
  initRoster(){
    if(this._rosterReady) return;
    this._rosterReady=true;
    Store.onSaveFail=res=>{
      if(res.reason==="quota") Kit.toast("端末の空きが足りず保存できませんでした。ファイルに書き出してから整理してください。",{tone:"bad",ms:6000});
      else if(res.reason==="unavailable") Kit.toast("この環境では端末に保存できません。ファイルに書き出して残してください。",{tone:"bad",ms:6000});
      else Kit.toast("保存できませんでした。",{tone:"bad"});
    };
    const q=$("#roster-q");
    if(q) q.oninput=()=>{ this.rosterQuery=q.value.trim(); this.renderRosterList(); };
    const clr=$("#roster-qclear");
    if(clr) clr.onclick=()=>{ this.rosterQuery=""; if(q){ q.value=""; q.focus(); } this.renderRosterList(); };
    $$("#roster-tabs .fchip").forEach(b=>b.onclick=()=>{
      $$("#roster-tabs .fchip").forEach(o=>o.classList.remove("on"));
      b.classList.add("on"); this.rosterTab=b.dataset.tab; Kit.buzz(5); this.renderRosterList();
    });
    $$("#roster-sort button").forEach(b=>b.onclick=()=>{
      $$("#roster-sort button").forEach(o=>o.classList.remove("on"));
      b.classList.add("on"); this.rosterSort=b.dataset.sort; Kit.buzz(5); this.renderRosterList();
    });
    const back=$("#roster-back");
    if(back) back.onclick=()=>this.show("title");

    /* データの持ち運び。失敗したら必ず理由を出す。 */
    $("#btn-save-file").onclick=()=>this.chooseExport();
    $("#data-file").onchange=ev=>{
      const f=ev.target.files&&ev.target.files[0];
      ev.target.value="";
      if(!f) return;
      if(f.size>20*1024*1024){ Kit.toast("ファイルが大きすぎます（20MBまで）。",{tone:"bad"}); return; }
      const r=new FileReader();
      r.onerror=()=>Kit.toast("ファイルを読み込めませんでした。",{tone:"bad"});
      r.onload=()=>this.runImport(r.result);
      r.readAsText(f);
    };
    $("#btn-text-io").onclick=()=>this.toggleTextIo();
  },

  /* 立ち絵と効果音を含めるかどうかを選ばせる。重さを数字で見せてから選ばせること。 */
  chooseExport(){
    const c=Store.counts(Store.exportData());
    if(!c.characters&&!c.skills){
      Kit.toast("保存するデータがまだありません。まずキャラクターか技を作ってください。",{tone:"bad"}); return;
    }
    const full=Store.sizeOf(Store.exportData());
    const lite=Store.sizeOf(Store.exportData({stripMedia:true}));
    const run=opt=>{
      Kit.toast("書き出しています…");
      Store.download(opt).then(()=>{
        Kit.toast(`キャラクター${c.characters}体・技${c.skills}個をファイルに保存しました。`,{tone:"ok"});
      }).catch(()=>Kit.toast("ファイルに書き出せませんでした。ブラウザの設定をご確認ください。",{tone:"bad"}));
    };
    const canMedia=typeof Media!=="undefined"&&Media.supported();
    const paint=(sfx)=>{
      Kit.sheet({title:"ファイルに保存",sub:"何を一緒に持ち出すか選べます",
        html:`<div class="stack">
          <button class="pickcard" data-x="full"><b>まるごと（バックアップ用）</b>
            <span>立ち絵${sfx.count?`・効果音${sfx.count}個`:""}も入れます。ふつうはこちら。</span>
            <em>約${full+Math.round(sfx.bytes*1.37/1024)}KB</em></button>
          <button class="pickcard" data-x="lite"><b>軽く（人に渡す用）</b>
            <span>立ち絵と音を抜きます。相手の端末では絵と音は出ません。</span>
            <em>約${lite}KB</em></button>
        </div>
        <p class="note" style="margin-top:10px">どちらも、あとから「ファイルから読み込む」で戻せます。</p>`,
        onMount:(body,close)=>{
          body.querySelectorAll("[data-x]").forEach(b=>b.onclick=()=>{
            close();
            run(b.dataset.x==="full"?{media:canMedia}:{stripMedia:true});
          });
        }});
    };
    if(canMedia) Media.usage().then(paint).catch(()=>paint({count:0,bytes:0}));
    else paint({count:0,bytes:0});
  },

  renderDraftBanner(){
    const box=$("#roster-draft");
    if(!box) return;
    const saved=Store.loadDraft();
    if(!saved||!saved.draft){ box.innerHTML=""; return; }
    const d=saved.draft;
    const when=new Date(saved.at||Date.now());
    const p=n=>String(n).padStart(2,"0");
    box.innerHTML=`<div class="draftcard">
      ${this.avatar(d,"44")}
      <div class="dc-t"><b>作りかけ「${esc(d.name||"名もなき者")}」</b>
        <span>${p(when.getMonth()+1)}/${p(when.getDate())} ${p(when.getHours())}:${p(when.getMinutes())}　${(Editor.STEPS[saved.step||0]||{}).label||""}まで</span></div>
      <div class="dc-b"><button class="btn btn-gold" id="draft-go">続ける</button>
        <button class="btn btn-ghost" id="draft-drop">捨てる</button></div></div>`;
    $("#draft-go").onclick=()=>Editor.resumeDraft(saved);
    $("#draft-drop").onclick=async()=>{
      if(!await Kit.confirm({title:"下書きを捨てますか",body:`「${d.name||"名もなき者"}」の作りかけは元に戻せません。`,
        ok:"捨てる",cancel:"やめる",danger:true})) return;
      Store.clearDraft(); this.renderDraftBanner(); Kit.toast("下書きを捨てました。");
    };
  },

  rosterList(){
    const q=this.rosterQuery.toLowerCase();
    let list=Object.values(CHARACTERS).filter(c=>{
      if(this.rosterTab==="mine"&&!c.custom) return false;
      if(this.rosterTab==="preset"&&c.custom) return false;
      if(!q) return true;
      return (c.name+" "+(c.description||"")).toLowerCase().indexOf(q)>=0;
    });
    const score=c=>Editor.powerScore(c.stats||{hp:1,atk:1,def:1,spd:1});
    if(this.rosterSort==="name") list.sort((a,b)=>String(a.name).localeCompare(String(b.name),"ja"));
    else if(this.rosterSort==="power") list.sort((a,b)=>score(b)-score(a));
    else list.sort((a,b)=>(b.custom?1:0)-(a.custom?1:0)||String(b.id).localeCompare(String(a.id)));
    return list;
  },
  renderRosterList(){
    const wrap=$("#edit-roster");
    const list=this.rosterList();
    const cnt=$("#roster-count");
    if(cnt) cnt.textContent=`${list.length}体`;
    if(!list.length){
      wrap.innerHTML=`<div class="empty">
        <div class="emo">◇</div>
        <b>${this.rosterQuery?"見つかりませんでした":"まだ誰もいません"}</b>
        <span>${this.rosterQuery?"別の言葉で探してみてください。":"下の「新しいキャラクターを作る」から始められます。"}</span></div>`;
      return;
    }
    wrap.innerHTML=list.map(c=>{
      const st=c.stats||{hp:0,atk:0,def:0,spd:0};
      const bars=["hp","atk","def","spd"].map(k=>
        `<span class="mini" title="${k.toUpperCase()}"><i style="transform:scaleX(${Math.min(1,st[k]/STAT_MAX[k]).toFixed(3)})"></i></span>`).join("");
      const chips=[];
      if(c.custom) chips.push("自作");
      if(c.awakening&&c.awakening.enabled) chips.push("覚醒あり");
      chips.push("技"+((c.skills||[]).length)+"個");
      return `<div class="rcard" data-id="${c.id}">
        <button class="rc-main" data-act="open">
          ${this.avatar(c,"44")}
          <span class="rc-t"><b>${esc(c.name)}</b>
            <span class="rc-d">${esc(c.description||"")}</span>
            <span class="rc-chips">${chips.map(x=>`<span class="mchip">${esc(x)}</span>`).join("")}</span>
            <span class="rc-bars">${bars}</span></span>
        </button>
        <button class="rc-more" data-act="more" aria-label="${esc(c.name)}の操作">⋯</button>
      </div>`;
    }).join("");
    wrap.querySelectorAll(".rcard").forEach(card=>{
      const c=CHARACTERS[card.dataset.id];
      card.querySelector('[data-act="open"]').onclick=()=>this.openCharMenu(c);
      card.querySelector('[data-act="more"]').onclick=()=>this.openCharMenu(c);
    });
  },
  /* 1体ぶんの操作をまとめたシート。confirm は使わない。 */
  openCharMenu(c){
    Kit.buzz(6);
    const host=Kit.layer();
    const old=host.querySelector(".kit-menu"); if(old) old.remove();
    const el=document.createElement("div");
    el.className="kit-menu";
    el.innerHTML=`<div class="km-scrim"></div>
      <div class="km-panel" role="dialog" aria-label="${esc(c.name)}の操作">
        <div class="km-head">${this.avatar(c,"44")}<div><b>${esc(c.name)}</b>
          <span>${esc(c.description||"")}</span></div></div>
        <div class="km-acts">
          <button class="btn btn-gold" data-m="fight"><span class="ic">⚔</span>このキャラで戦う</button>
          ${c.custom?`<button class="btn btn-line" data-m="edit"><span class="ic">✎</span>編集する</button>`:""}
          <button class="btn btn-line" data-m="copy"><span class="ic">⧉</span>複製してつくる</button>
          ${c.custom?`<button class="btn btn-line" data-m="share"><span class="ic">⤓</span>共有コードを出す</button>`:""}
          ${c.custom?`<button class="btn btn-ghost danger" data-m="del">削除する</button>`:""}
          <button class="btn btn-ghost" data-m="close">閉じる</button>
        </div></div>`;
    host.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("on"));
    const close=()=>{ el.classList.remove("on"); setTimeout(()=>el.remove(),240); };
    el.querySelector(".km-scrim").onclick=close;
    el.querySelectorAll("[data-m]").forEach(b=>b.onclick=()=>{
      const m=b.dataset.m;
      close();
      if(m==="fight") this.startWith(c.id);
      else if(m==="edit") Editor.openCharacter(c.id,null);
      else if(m==="copy") Editor.openCharacter(null,c);
      else if(m==="share") this.shareOne(c);
      else if(m==="del") this.deleteChar(c);
    });
  },
  /* 削除は確認ではなく「消してから取り消せる」形にする */
  deleteChar(c){
    const id=c.id, snapshot=JSON.parse(JSON.stringify(c));
    delete CHARACTERS[id];
    [0,1].forEach(i=>{ if(this.pick[i]===id) this.pick[i]=null; });
    const res=Store.save();
    this.renderRosterList(); this.renderStorage();
    Kit.buzz([8,30,8]);
    Kit.toast(`「${c.name}」を削除しました。`,{tone:res.ok?null:"bad",action:{label:"取り消す",fn:()=>{
      CHARACTERS[id]=snapshot;
      const r2=Store.save();
      this.renderRosterList(); this.renderStorage();
      Kit.toast(r2.ok?`「${snapshot.name}」を戻しました。`:"戻しましたが端末に保存できませんでした。",{tone:r2.ok?"ok":"bad"});
    }}});
  },
  shareOne(c){
    const json=JSON.stringify({format:Store.FORMAT,version:Store.VERSION,
      characters:{[c.id]:c},skills:(c.skills||[]).concat((c.awakening&&c.awakening.form&&c.awakening.form.skills)||[])
        .reduce((m,id)=>{ if(SKILLS[id]&&SKILLS[id].custom) m[id]=SKILLS[id]; return m; },{})});
    const code=Store.encodeString(json);
    this.openTextIo(code,`「${c.name}」の共有コード`);
  },
  startWith(id){
    const c=CHARACTERS[id];
    if(!c){ Kit.toast("そのキャラクターが見つかりません。",{tone:"bad"}); return; }
    const foes=Object.values(CHARACTERS).filter(x=>x.id!==id);
    const foe=foes.length?foes[Math.floor(Math.random()*foes.length)]:c;
    this.mode="ai";
    this.aiLevel=this.aiLevel||"normal";
    this.pick=[id,foe.id];
    this.slotFocus=0;
    this.mySide=0;
    this.controllers=["local","ai"];
    this.chars=[c,foe];
    Music.unlock();
    this.startBattle(c,foe,null,null);
    Kit.toast(`「${foe.name}」との試し斬りです。`);
  },

  /* ---------- 自作の技 ---------- */
  renderSkillList(){
    const box=$("#roster-skills");
    if(!box) return;
    const mine=Object.values(SKILLS).filter(s=>s.custom);
    if(!mine.length){
      box.innerHTML=`<p class="note">自分で作った技はまだありません。状態異常を組み合わせて作れます。</p>`;
      return;
    }
    box.innerHTML=mine.map(s=>`<div class="skrow" data-id="${s.id}">
      <span class="sk-t"><b>${esc(s.name)}</b>
        <span>${TYPE_LABEL[s.type]||"技"}・SP${s.cost}${s.power>0?"・威力"+s.power:""}${s.sfxId?"・♪":""}</span></span>
      <button class="btn btn-line" data-act="edit">直す</button>
      <button class="btn btn-ghost" data-act="del" aria-label="${esc(s.name)}を削除">削除</button></div>`).join("");
    box.querySelectorAll(".skrow").forEach(row=>{
      const id=row.dataset.id;
      row.querySelector('[data-act="edit"]').onclick=()=>{ Editor.returnTo="roster"; Editor.openSkill(id); };
      row.querySelector('[data-act="del"]').onclick=()=>this.deleteSkill(id);
    });
  },
  deleteSkill(id){
    const s=SKILLS[id];
    if(!s) return;
    const users=Object.values(CHARACTERS).filter(c=>(c.skills||[]).indexOf(id)>=0
      ||((c.awakening&&c.awakening.form&&c.awakening.form.skills)||[]).indexOf(id)>=0);
    if(users.length){
      Kit.toast(`「${s.name}」は${users.map(u=>u.name).join("・")}が使っています。先に外してください。`,{tone:"bad",ms:5000});
      return;
    }
    const snap=JSON.parse(JSON.stringify(s));
    delete SKILLS[id];
    Store.save(); Editor._ref=null;
    if(snap.sfxId&&typeof Media!=="undefined") Editor.releaseSfx(snap.sfxId);
    this.renderSkillList(); this.renderStorage();
    Kit.toast(`「${s.name}」を削除しました。`,{action:{label:"取り消す",fn:()=>{
      SKILLS[id]=snap; Store.save(); Editor._ref=null;
      this.renderSkillList(); this.renderStorage(); Kit.toast(`「${snap.name}」を戻しました。`,{tone:"ok"});
    }}});
  },

  /* ---------- 端末の空き ---------- */
  renderStorage(){
    const box=$("#roster-usage");
    if(!box) return;
    const u=Store.usage();
    if(!u.bytes){ box.innerHTML=""; return; }
    const kb=(u.bytes/1024).toFixed(0);
    const pct=Math.min(100,u.bytes/u.limit*100);
    const warn=pct>70;
    box.innerHTML=`<div class="usage${warn?" warn":""}">
      <div class="us-top"><span>端末に置いている量</span><b>${kb} KB</b></div>
      <div class="us-track"><div class="us-fill" style="transform:scaleX(${(pct/100).toFixed(4)})"></div></div>
      <div class="note" id="us-note">${warn?`残りが少なくなっています。重いのは ${u.heavy.map(h=>esc(h.name)+"（"+(h.bytes/1024).toFixed(0)+"KB）").join("・")} です。ファイルに書き出してから整理してください。`
        :"目安の上限は5MBです。立ち絵つきのキャラは1体あたり20KB前後です。"}</div>
      <div class="note" id="us-media"></div></div>`;
    /* 効果音は別の置き場（IndexedDB）なので、別立てで知らせる */
    if(typeof Media==="undefined"||!Media.supported()){
      const m=$("#us-media");
      if(m) m.textContent="効果音はこの環境では保存できません。";
      return;
    }
    Media.usage().then(mu=>{
      const m=$("#us-media");
      if(!m) return;
      m.textContent=mu.count?`効果音 ${mu.count}個（${(mu.bytes/1024).toFixed(0)}KB）は別の置き場にあります。`:"";
    }).catch(()=>{});
  },

  /* ---------- 文字でやりとり ---------- */
  toggleTextIo(){
    const area=$("#io-area");
    if(area.innerHTML.trim()){ area.innerHTML=""; return; }
    this.openTextIo(null,null);
  },
  openTextIo(code,title){
    const area=$("#io-area");
    const d=Store.exportData();
    const c=Store.counts(d);
    const out=code!=null?code:Store.encode();
    area.innerHTML=`<div class="h-rule">${esc(title||"文字でやりとり")}</div>
      <p class="note">${code!=null?"このコードを渡せば、相手の端末に取り込めます。"
        :`自作のキャラクター${c.characters}体・技${c.skills}個ぶんです。コピーして渡せます。`}</p>
      <textarea id="io-out" readonly rows="4" aria-label="共有コード">${esc(out)}</textarea>
      <div class="rowbtns" style="margin-top:8px">
        <button class="btn btn-line" id="io-copy">コピーする</button>
        <button class="btn btn-ghost" id="io-close">閉じる</button></div>
      <div class="h-rule">受け取る</div>
      <textarea id="io-in" rows="3" placeholder="共有コードかJSONを貼り付け" aria-label="読み込む内容"></textarea>
      <button class="btn btn-line" id="io-run" style="margin-top:8px">貼り付けた内容を読み込む</button>
      <div id="io-err" class="err"></div>`;
    $("#io-copy").onclick=async()=>{
      const el=$("#io-out");
      try{
        if(navigator.clipboard&&navigator.clipboard.writeText) await navigator.clipboard.writeText(el.value);
        else { el.select(); document.execCommand("copy"); }
        Kit.toast(`コピーしました（${el.value.length}文字）。`,{tone:"ok"});
      }catch(e){
        el.select();
        Kit.toast("コピーできませんでした。手で選んでコピーしてください。",{tone:"bad"});
      }
    };
    $("#io-close").onclick=()=>{ area.innerHTML=""; };
    $("#io-run").onclick=()=>this.runImport($("#io-in").value);
    area.scrollIntoView({block:"nearest",behavior:Kit.reduced()?"auto":"smooth"});
  },
  /* 読み込みの入口はここ1つ。何が起きたかを必ず言葉にする。 */
  runImport(text){
    const err=$("#io-err");
    const fail=msg=>{ if(err) err.textContent=msg; Kit.toast(msg,{tone:"bad",ms:5000}); };
    let data;
    try{ data=Store.parse(text); }
    catch(e){ fail(e.message||"読み込めませんでした。"); return; }
    let res;
    try{ res=Store.importData(data); }
    catch(e){ fail(e.message||"読み込めませんでした。"); return; }
    if(err) err.textContent="";
    this.renderRoster();
    const bits=[];
    if(res.characters) bits.push(`キャラクター${res.characters}体`);
    if(res.skills) bits.push(`技${res.skills}個`);
    if(res.skipped) bits.push(`読めなかったもの${res.skipped}件`);
    if(res.media>0) bits.push(`効果音${res.media}個`);
    if(res.media<0) Kit.toast("効果音が入っていましたが、この環境では端末に置けませんでした。",{tone:"bad",ms:5000});
    if(res.mediaPromise) res.mediaPromise.then(()=>this.renderStorage());
    if(!res.saved){
      Kit.toast(`${bits.join("・")}を読み込みましたが、端末に保存できませんでした。閉じると消えます。`,{tone:"bad",ms:6000});
    }else{
      Kit.toast(`${bits.join("・")}を読み込みました。`,{tone:"ok"});
      Kit.buzz([10,40,16]);
    }
  }
});
