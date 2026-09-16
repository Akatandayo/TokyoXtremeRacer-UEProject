/* =========================================================================
   09f. Tryout — 作りかけの技を「その場で試し斬り」する。
        数字の平均だけでは、作った技が実戦でどう振る舞うか分からない。
        エンジンに本当に戦わせ、出てきた戦闘ログをそのまま見せる。
        （UIは戦闘計算をしない。計算は 09-engine.js が行う。）
   ========================================================================= */
Object.assign(Editor,{
  /* ログの下ごしらえ。ターンの見出しと「身を固めた」は毎回出るので省く。 */
  TRY_MUTE:/^ターン|身を固めた/,

  /* 1回だけ本気で戦わせて、ターンごとのログと残HPを返す。 */
  sampleRun(skill,turns){
    turns=turns||3;
    const id=skill.id||"__try_skill";
    const sk=Object.assign({},skill,{id});
    const me=this.dummyChar("あなた",88); me.skills=[id];
    const foe=this.dummyChar("相手",this.DUMMY.mid.def);
    let eng;
    try{
      eng=new BattleEngine(me,foe,{skills:{[id]:sk},seed:20260916,
        startSp:[BALANCE.sp.max,BALANCE.sp.max]});
    }catch(e){ return null; }
    const out=[];
    let prevFoe=eng.fighters[1].hp, prevMe=eng.fighters[0].hp;
    for(let t=0;t<turns;t++){
      if(eng.over) break;
      /* 1ターン目に技を撃ち、あとは様子を見る（継続ダメージの効きまで見える） */
      eng.submit(0,t===0?{type:"SKILL",skillId:id,spend:sk.cost}:{type:"DEFEND"});
      eng.submit(1,{type:"DEFEND"});
      let lines;
      try{ lines=eng.resolveTurn(); }catch(e){ return out.length?out:null; }
      const foeHp=eng.fighters[1].hp, meHp=eng.fighters[0].hp;
      out.push({
        turn:t+1,
        lines:(lines||[]).map(l=>String(l.text||"")).filter(x=>x&&!this.TRY_MUTE.test(x)).slice(0,5),
        dmg:Math.max(0,prevFoe-foeHp),
        self:meHp-prevMe,
        hp:foeHp, maxHp:eng.fighters[1].maxHp
      });
      prevFoe=foeHp; prevMe=meHp;
    }
    return out;
  },
  /* 試し斬りの見た目。ログはそのまま、HPの残りは帯で見せる。 */
  tryoutHtml(skill){
    const runs=this.sampleRun(skill,3);
    if(!runs||!runs.length)
      return `<div class="status bad">この設定では戦わせられませんでした。数値を見直してください。</div>`;
    const rows=runs.map(r=>{
      const pct=Math.max(0,Math.min(1,r.hp/Math.max(1,r.maxHp)));
      const badge=r.dmg>0?`<b class="ty-d">-${Math.round(r.dmg)}</b>`
        :(r.self>0?`<b class="ty-h2">+${Math.round(r.self)}</b>`:`<b class="ty-z">—</b>`);
      return `<li class="tyr">
        <span class="ty-t">${r.turn}</span>
        <div class="ty-b">
          <div class="ty-l">${r.lines.map(t=>`<span>${esc(t)}</span>`).join("")||"<span>何も起きなかった。</span>"}</div>
          <div class="ty-bar"><i style="transform:scaleX(${pct.toFixed(3)})"></i></div>
        </div>
        ${badge}</li>`;
    }).join("");
    const last=runs[runs.length-1];
    return `<div class="tryout">
      <div class="ty-h">ためし斬り<em>HP${this.SIM_HP}・DEF${this.DUMMY.mid.def}の相手（毎ターン防御）に、1ターン目にこの技を撃つ</em></div>
      <ol class="ty-list">${rows}</ol>
      <div class="ty-f">${runs.length}ターン後、相手の残りHPは
        <b>${Math.max(0,Math.round(last.hp))}</b>／${last.maxHp}（${Math.round(Math.max(0,last.hp)/last.maxHp*100)}%）</div>
    </div>`;
  },

  /* 長い説明を切り詰める。切ったことが分かるように「…」を足す。 */
  clip(text,n){
    const t=String(text||"");
    return t.length>n?t.slice(0,n)+"…":t;
  },

  /* ---------- もとにする技を全部から選ぶ ---------- */
  openPresetPicker(){
    const list=Object.values(SKILLS).filter(s=>s.id!=="basic_attack");
    const groups=["ATTACK","SPECIAL","DEFENSE","SUPPORT"].map(t=>({
      label:TYPE_LABEL[t]||t, keys:list.filter(s=>s.type===t)
    })).filter(g=>g.keys.length);
    const card=s=>`<button class="effpick t-${s.type==="DEFENSE"||s.type==="SUPPORT"?"good":"bad"}"
      data-preset="${s.id}" data-q="${esc(s.name+" "+(s.description||""))}">
      <span class="ep-i">${s.custom?"✎":"◈"}</span>
      <span class="ep-t"><b>${esc(s.name)}</b><span>${esc(this.clip(s.description,34))}</span></span>
      <span class="ep-side">SP${s.cost}</span></button>`;
    Kit.sheet({title:"もとにする技を選ぶ",sub:"土台にして作り替える",
      html:`<div class="effsearch"><input type="search" id="pp-q" placeholder="技を探す（斬・炎・守り…）"
          aria-label="技を探す" autocomplete="off"></div>
        <div id="pp-list">${groups.map(g=>`<div class="epgrp">
          <div class="epg-h">${esc(g.label)}</div>
          <div class="epg-b">${g.keys.map(card).join("")}</div></div>`).join("")}</div>
        <p class="note" id="pp-empty" style="display:none">見つかりませんでした。</p>`,
      onMount:(body,close)=>{
        body.querySelectorAll("[data-preset]").forEach(b=>b.onclick=()=>{
          close();
          this.applyPreset(b.dataset.preset);
        });
        const q=body.querySelector("#pp-q");
        q.oninput=()=>{
          const t=q.value.trim().toLowerCase();
          let hit=0;
          body.querySelectorAll("[data-preset]").forEach(b=>{
            const ok=!t||b.dataset.q.toLowerCase().indexOf(t)>=0;
            b.style.display=ok?"":"none";
            if(ok) hit++;
          });
          body.querySelectorAll(".epgrp").forEach(g=>{
            g.style.display=Array.from(g.querySelectorAll("[data-preset]"))
              .some(b=>b.style.display!=="none")?"":"none";
          });
          body.querySelector("#pp-empty").style.display=hit?"none":"";
        };
      }});
  }
});
