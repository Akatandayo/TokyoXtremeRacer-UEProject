/* =========================================================================
   09d. RC — レギュレーションキャラクリを作成画面に持ち込む。

        RC.checkSkill / checkCharacter は 01b-regulation.js が持つ物差し。
        ここは「読んで、見せて、収める手伝いをする」だけで、判定はしない。
        数値をこちらに書かないこと。収まるかどうかは必ず RC に聞く。
   ========================================================================= */
Object.assign(Editor,{

  /* ---------- 共通の言い回し ---------- */
  rcAvailable(){ return typeof RC!=="undefined"&&RC&&typeof RC.checkSkill==="function"; },
  rcPct(r){ return Math.round((r.ratio||0)*100); },

  /* 内訳のうち重いものから。マイナス（自傷・回数制限）は割り引きとして後ろに回す。 */
  rcParts(parts){
    const plus=(parts||[]).filter(p=>p.points>0).sort((a,b)=>b.points-a.points);
    const minus=(parts||[]).filter(p=>p.points<0);
    return plus.concat(minus);
  },

  /* =====================================================================
     収めかたを探す。値は総当たりで RC に聞いて決める（式を写さない）。
     戻り値は [{key,label,done,detail,next}]。next は直したあとの技そのもの。
     ここでは何も書き換えない。適用する側が next を受け取って反映する。
     ===================================================================== */
  rcFixes(skill,awakened){
    if(!this.rcAvailable()||!skill) return [];
    const s=skill;
    const ok=o=>RC.checkSkill(o,awakened).ok;
    const clone=extra=>Object.assign({},s,extra);
    const out=[];

    /* 1) SPを上げる — いちばん意味を壊さない収めかた */
    const spMax=(typeof BALANCE!=="undefined"&&BALANCE.sp&&BALANCE.sp.max)||0;
    for(let c=(Number(s.cost)||0)+1;c<=spMax;c++){
      if(ok(clone({cost:c}))){
        /* SPを上げると撃てるようになるのが遅れる。そこまで言ってから選ばせる。 */
        const t=(typeof this.firstTurn==="function")?this.firstTurn(c):1;
        out.push({key:"cost",label:`SPを${c}にする`,done:`SPを${c}にしました`,
          detail:`威力も効果もそのまま。${t>1?`${t}ターン目から`:"最初から"}撃てる技になります。`,
          next:clone({cost:c})});
        break;
      }
    }

    /* 2) 威力を下げる — 攻撃技のとき */
    const pow=Number(s.power)||0;
    if(pow>0&&ok(clone({power:0}))){         // 威力を0にしても収まらないなら、下げても無駄
      let lo=0,hi=pow;                       // ok になる最大の威力を二分探索
      while(lo<hi){
        const mid=Math.ceil((lo+hi)/2);
        if(ok(clone({power:mid}))) lo=mid; else hi=mid-1;
      }
      if(lo<pow) out.push({key:"power",label:`威力を${lo}まで下げる`,done:`威力を${lo}まで下げました`,
        detail:`SP${Number(s.cost)||0}の技として通る上限です。`,
        next:clone({power:lo})});
    }

    /* 3) 持続を縮める — 効果が長いとき。長い効果すべてに上限をかける */
    const durs=(s.effects||[]).map(e=>Number(e.duration)||0).filter(n=>n>1);
    if(durs.length){
      const cap=d=>clone({effects:s.effects.map(e=>
        (Number(e.duration)>d)?Object.assign({},e,{duration:d}):e)});
      const longest=Math.max.apply(null,durs);
      for(let d=longest-1;d>=1;d--){
        if(ok(cap(d))){
          out.push({key:"duration",label:`効果の持続を${d}ターンまでにする`,
            done:`効果の持続を${d}ターンまでにしました`,
            detail:"長く効くほど重く見られます。短くすると通ります。",
            cap:d,next:cap(d)});
          break;
        }
      }
    }
    return out;
  },

  /* 規定内なのに余っているとき、どこまで盛れるかを返す（技づくりを楽しくするため）。
     上限は RC に聞いて探す。ここでも数値を書かない。 */
  rcRoom(skill,awakened){
    if(!this.rcAvailable()||!skill) return null;
    const s=skill, ok=p=>RC.checkSkill(Object.assign({},s,{power:p}),awakened).ok;
    const pow=Math.max(0,Number(s.power)||0);       // 負の数を渡されても探索が止まるように
    const 天井=100000;
    if(!RC.checkSkill(s,awakened).ok||!ok(pow)) return null;
    if(!(pow>0||s.type==="ATTACK"||s.type==="SPECIAL")) return null;
    /* 上限を倍々で探してから、二分探索で詰める */
    let lo=pow, hi=pow+1, n=0;
    while(hi<天井&&ok(hi)&&n++<40){ lo=hi; hi=Math.min(天井,hi*2||1); }
    if(hi>=天井) return null;                        // 上限が見えない技（威力が効かない形）
    while(lo<hi-1){
      const mid=Math.floor((lo+hi)/2);
      if(ok(mid)) lo=mid; else hi=mid;
    }
    if(lo<=pow) return null;
    return {key:"power",boost:true,label:`威力を${lo}まで上げる`,done:`威力を${lo}にしました`,
      detail:"このSPで許される上限いっぱいの一撃になります。",
      next:Object.assign({},s,{power:lo})};
  },

  /* =====================================================================
     技エディタの「適合ぐあい」。入力のたびに描き直す。
     ===================================================================== */
  paintRC(s){
    const box=$("#k-rc");
    if(!box) return;
    if(!this.rcAvailable()){ box.innerHTML=""; return; }
    s=s||this.collectSkill();
    const r=RC.checkSkill(s,false);
    const 覚醒 =RC.checkSkill(s,true);
    const pct=this.rcPct(r);
    const fixes=r.ok?[]:this.rcFixes(s,false);
    /* 余っているなら、余りを活かす一手も出す（削るだけの物差しにしない） */
    const room=r.ok?this.rcRoom(s,false):null;
    if(room) fixes.push(room);
    this._rcFixes=fixes;

    /* 中身が変わっていないなら描き直さない。
       数値欄から指を離した瞬間にも change が飛んでくるので、ここで作り直すと
       押そうとしたボタンが入れ替わり、最初の一回が効かなくなる。 */
    const sig=JSON.stringify([r.ok,r.value,r.allowance,Number(s.cost)||0,r.parts,
      覚醒.ok,fixes.map(f=>f.label)]);
    if(sig===this._rcSig&&box.innerHTML) return;
    this._rcSig=sig;

    const parts=this.rcParts(r.parts);
    const 山=parts.length?Math.max.apply(null,parts.map(p=>Math.abs(p.points))):1;
    const lines=parts.slice(0,5).map(p=>{
      const w=Math.max(.04,Math.min(1,Math.abs(p.points)/山));
      return `<div class="rcline"><span class="rcn">${esc(p.label)}</span>
        <span class="rcw"><i style="transform:scaleX(${w.toFixed(3)})"></i></span>
        <span class="rcv">${p.points>0?"+":""}${p.points}</span></div>`;
    }).join("");

    let note;
    if(r.ok){
      const 余り=Math.max(0,Math.round((r.allowance-r.value)*10)/10);
      note=pct>=90
        ? `ぎりぎり規定内です。これ以上足すとRC外になります。`
        : `あと ${余り} 点ぶん余っています。威力を上げるか、効果を足せます。`;
    }else{
      const 重い=parts.length?parts[0]:null;
      note=`${r.over} 点ぶん重すぎます。`+
        (重い?`いちばん重いのは「${esc(重い.label)}」（${重い.points}点）です。`:"")+
        (fixes.length?"":"SPを最大にしても収まりません。効果を減らしてください。");
    }
    const awkNote=(!r.ok&&覚醒.ok)
      ? `<div class="rc-awk">覚醒形態の技としてなら収まります（許容 ${覚醒.allowance}）。通常形態では使えません。</div>`:"";

    box.className="rcpanel"+(r.ok?" ok":" over");
    box.innerHTML=`
      <div class="rc-head">
        <span class="rc-badge">${r.ok?"RC適合":"RC外"}</span>
        <span class="rc-sum">価値 <b>${r.value}</b> ／ SP${Number(s.cost)||0}の許容 <b>${r.allowance}</b></span>
        <span class="rc-pct">${pct}%</span>
      </div>
      <div class="rcbar${r.ok?"":" over"}"><i style="transform:scaleX(${Math.min(1,(r.ratio||0)).toFixed(3)})"></i></div>
      <div class="rc-parts">${lines||`<div class="rcline"><span class="rcn">まだ何も起きない技です</span></div>`}</div>
      <div class="rcnote${r.ok?" ok":""}">${note}</div>
      ${awkNote}
      ${fixes.length?`<div class="rc-fix">${fixes.map((f,i)=>
        `<button type="button" class="rcfix${f.boost?" up":""}" data-fix="${i}">
          <b>${esc(f.label)}</b><span>${esc(f.detail)}</span></button>`
        ).join("")}</div>`:""}`;

    box.querySelectorAll(".rcfix").forEach(b=>b.onclick=()=>this.applyRcFix(+b.dataset.fix));
  },
  applyRcFix(i){
    const f=(this._rcFixes||[])[i];
    if(!f) return;
    this.skill=Object.assign({},f.next);
    /* 持続を縮めたときは、効果の行の値も合わせる（画面と中身をずらさない） */
    if(f.key==="duration") this.effects.forEach(ef=>{
      const cur=ef.duration!=null?ef.duration:((STATUS[ef.key]||{}).duration||1);
      if(cur>f.cap) ef.duration=f.cap;
    });
    Kit.buzz(12);
    this.renderSkill();
    this.rcReveal();
    Kit.toast(f.boost?`${f.done}。RCの規定いっぱいの一撃です。`
                     :`${f.done||f.label}。これでRCの規定に収まります。`,{tone:"ok"});
  },

  /* 適合ぐあいの枠を、貼り付いた技の札に隠れない位置まで持ってくる */
  rcReveal(){
    const box=$("#k-rc"), fg=$("#k-forge");
    if(!box) return;
    try{
      const 上=box.getBoundingClientRect().top+window.scrollY;
      const 札=fg?fg.getBoundingClientRect().height:0;
      window.scrollTo({top:Math.max(0,上-札-14),behavior:Kit.reduced()?"auto":"smooth"});
    }catch(e){}
  },

  /* =====================================================================
     保存済みの技を、意味を保ったまま規定内に収める。
     一覧からも確認の段からも同じ入口を使う。
     ===================================================================== */
  rcFitSaved(id,onDone){
    const s=SKILLS[id];
    if(!s||!this.rcAvailable()) return;
    const r=RC.checkSkill(s,false);
    if(r.ok){ Kit.toast(`「${s.name}」はもうRCの規定に収まっています。`,{tone:"ok"}); return; }
    const fixes=this.rcFixes(JSON.parse(JSON.stringify(s)),false);
    const 使う=Object.values(CHARACTERS).filter(c=>(c.skills||[]).indexOf(id)>=0
      ||(((c.awakening||{}).form||{}).skills||[]).indexOf(id)>=0);
    if(!fixes.length){
      Kit.toast("SPを最大にしても収まりません。効果を減らしてから、もう一度お試しください。",{tone:"bad",ms:5000});
      this.openSkill(id);
      return;
    }
    const html=`<div class="rcpanel over" style="margin-bottom:12px">
        <div class="rc-head"><span class="rc-badge">RC外</span>
          <span class="rc-sum">価値 <b>${r.value}</b> ／ SP${s.cost||0}の許容 <b>${r.allowance}</b></span>
          <span class="rc-pct">${this.rcPct(r)}%</span></div>
        <div class="rcbar over"><i style="transform:scaleX(1)"></i></div>
        <div class="rcnote">${r.over} 点ぶん重すぎます。どれか一つを選ぶと、その場で規定内に収まります。</div>
      </div>
      <div class="rc-fix">${fixes.map((f,i)=>
        `<button type="button" class="rcfix" data-fit="${i}"><b>${esc(f.label)}</b><span>${esc(f.detail)}</span></button>`
      ).join("")}</div>
      ${使う.length?`<p class="note" style="margin-top:10px">この技は
        ${使う.map(c=>esc(c.name)).join("・")} が使っています。直すとそちらにも効きます。</p>`:""}`;
    Kit.sheet({title:"RCに収める",sub:`「${s.name}」を規定内にします`,html,
      onMount:(body,close)=>{
        body.querySelectorAll("[data-fit]").forEach(b=>b.onclick=()=>{
          const f=fixes[+b.dataset.fit];
          close();
          const prev=SKILLS[id];
          SKILLS[id]=Object.assign({},f.next,{id});
          const res=Store.save();
          if(!res.ok){ SKILLS[id]=prev; this.reportSaveFail(res,null); return; }
          this._ref=null;
          Kit.buzz([10,40,16]);
          Kit.toast(`${f.done}。「${s.name}」はRCの規定に収まりました。`,{tone:"ok",
            action:{label:"取り消す",fn:()=>{
              SKILLS[id]=prev; Store.save(); this._ref=null; onDone&&onDone();
              Kit.toast(`「${s.name}」を元に戻しました。`);
            }}});
          onDone&&onDone();
        });
      }});
  },

  /* =====================================================================
     確認の段に出す「RC適合 / RC外」。
     ===================================================================== */
  rcJump(where){
    if(where==="能力") return 1;
    if(where==="覚醒"||where==="覚醒の技") return 3;
    return 2;
  },
  rcCharacterHtml(){
    if(!this.rcAvailable()) return "";
    let r;
    /* 古い形式や壊れた下書きでも、確認の段そのものが死なないようにする */
    try{ r=RC.checkCharacter(this.draft); }
    catch(e){ return `<div class="status">このキャラクターはRCの判定ができませんでした。
      技や覚醒の設定を見直すと出ます。</div>`; }
    if(!r) return "";
    const rows=(r.skills||[]).map(x=>{
      const pct=this.rcPct(x);
      return `<div class="rcrow${x.ok?"":" over"}">
        <div class="rcline"><span class="rcn">${esc(x.name)}${x.awakened?"<em>覚醒</em>":""}</span>
          <span class="rcv">SP${x.cost}・${pct}%</span></div>
        <div class="rcbar${x.ok?"":" over"}"><i style="transform:scaleX(${Math.min(1,x.ratio||0).toFixed(3)})"></i></div>
        ${x.ok?"":`<div class="rcnote">価値 ${x.value} ／ 許容 ${x.allowance}（${x.over}点ぶん超過）</div>
          <div class="rc-acts">${SKILLS[x.id]&&SKILLS[x.id].custom
            ?`<button type="button" class="btn btn-gold rcfit" data-sk="${esc(x.id)}">RCに収める</button>
              <button type="button" class="btn btn-line rcedit" data-sk="${esc(x.id)}">この技を直す</button>`
            :`<span class="note">最初からある技です。付け替えてください。</span>`}</div>`}
      </div>`;
    }).join("");
    return `<div class="rcverdict ${r.ok?"ok":"ng"}" id="e-rc">
      <div class="rcv-head"><span class="rc-badge">${r.ok?"RC適合":"RC外"}</span>
        <span>${r.ok?"このキャラクターはRC戦に出られます。"
                    :"このままではRC戦に出られません。直すところは下のとおりです。"}</span></div>
      ${r.ok?"":`<div class="rcissues">${r.issues.map(i=>
        `<button type="button" class="rcissue" data-jump="${this.rcJump(i.where)}">
          <span class="ri-w">${esc(i.where)}</span><span class="ri-t">${esc(i.text)}</span><em>直す</em></button>`).join("")}</div>`}
      ${rows?`<div class="rcrows">${rows}</div>`:""}
      <p class="note">RCは「技の強さがSP消費に見合っているか」の物差しです。外れていても、
        ふつうの対戦には出せます。</p>
    </div>`;
  },
  bindRcCheck(){
    const box=$("#e-rc");
    if(!box) return;
    box.querySelectorAll(".rcissue").forEach(b=>b.onclick=()=>this.goStep(+b.dataset.jump));
    box.querySelectorAll(".rcfit").forEach(b=>b.onclick=()=>{
      this.returnTo="edit";                      // 技エディタに逃げたときの戻り先
      this.rcFitSaved(b.dataset.sk,()=>{ this.touch(); this.renderStep(); });
    });
    box.querySelectorAll(".rcedit").forEach(b=>b.onclick=()=>{
      this.touch();
      this.returnTo="edit";
      this.openSkill(b.dataset.sk);
    });
  }
});
