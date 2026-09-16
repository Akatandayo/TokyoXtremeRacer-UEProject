/* =========================================================================
   07b. AI — 対AI戦の思考ルーチン。エンジンの公開情報だけを見る。

   難易度は「強さのつまみ」ではなく別の人格として書いてある。
     ひかえめ … 削って守る。SPを抱えこみ、止めを逃す。覚醒は追い詰められてから。
     ふつう   … 素直に期待ダメージが高い手を取る。倒しきれる手は取るが、読み合いはしない。
     本気     … 倒しきれる手を逃さない。相手の覚醒を警戒し、自分の覚醒は
                「覚醒中に倒しきれるか」で切る。反撃と一度きりの技も勘定に入れる。
     鬼       … 連戦モード終盤の相手。本気からブレを完全に取り除いたもの（難易度選択には出さない）。

   弱い難易度は「わざと弱い」。判断そのものを間引いてあるだけで、
   計算違いやバグで弱くしているところは一つもない。

   乱数はすべて engine.rng() を通す。Math.random() は使わない。
   同じ seed なら何度やっても同じ試合になり、tools/sim.mjs で再現性を検査している。
   ========================================================================= */
const AI = {
  /* 難易度選択に出すのはこの3つ（UIは Object.keys(AI.LEVELS) を並べる） */
  LEVELS:{
    easy:{label:"ひかえめ",
      noise:0.42,            // でたらめな手を選ぶ確率
      lethal:0,              // 倒しきれる手を見つける精度（0=見ない）
      defendBias:1.45,       // 防御の評価倍率
      skillBias:0.80,        // 技の評価倍率（＝技をあまり撃たない）
      spHoard:2,             // これだけSPを残そうとする（＝強い技が撃てない）
      readCounter:0,         // 反撃持ちへの警戒
      readFoeAwaken:0,       // 相手の覚醒への警戒
      awakenBias:-260,       // 覚醒に踏み切る閾値の補正（高いほど渋る）
      awakenPanicHp:0.3,     // ここまで削られたら理屈抜きで覚醒する
      saveOnce:0,            // 一度きりの技を温存する度合い
      favour:60},            // 直前と同じ技を選びたがる（人間くさい癖）
    normal:{label:"ふつう",
      noise:0.14, lethal:0.9, defendBias:1.0, skillBias:1.0, spHoard:0,
      readCounter:0.5, readFoeAwaken:0.35, awakenBias:-40, awakenPanicHp:0.4,
      saveOnce:0.4, favour:0},
    hard:{label:"本気",
      noise:0, lethal:0.55, defendBias:0.95, skillBias:1.05, spHoard:0,
      readCounter:1, readFoeAwaken:1, awakenBias:0, awakenPanicHp:0.5,
      saveOnce:1, favour:0}
  },
  /* 難易度選択には出さない相手（連戦モードの終盤） */
  EXTRA:{
    ruthless:{label:"鬼",
      noise:0, lethal:0.4, defendBias:1.0, skillBias:1.1, spHoard:0,
      readCounter:1, readFoeAwaken:1.3, awakenBias:60, awakenPanicHp:0.6,
      saveOnce:1, favour:0}
  },
  cfg(level){ return this.LEVELS[level]||this.EXTRA[level]||this.LEVELS.normal; },
  label(level){ return this.cfg(level).label; },

  /* --- 見積もり：命中を込めた期待値と、全部当たったときの最大値 --- */
  estimate(engine, attacker, target, skill){
    const avg=engine.preview(attacker,target,skill);
    if(!avg) return {avg:0,max:0,chance:0};
    const acc=Math.max(BALANCE.accuracyMin,Math.min(BALANCE.accuracyMax,
      (skill.accuracy!=null?skill.accuracy:100)+Effects.accMod(attacker)))/100;
    const hits=skill.hits||1;
    return {avg, max:avg/acc, chance:Math.pow(acc,hits)};
  },
  /* 覚醒形態の自分を仮に組み立てて、何ができるようになるかを見る（状態は変えない） */
  ghost(fighter, form){
    return {name:fighter.name, base:Object.assign({},fighter.base,form&&form.stats||{}),
      effects:[], hp:fighter.hp, maxHp:(form&&form.stats&&form.stats.hp)||fighter.maxHp,
      base_def:fighter.base.def};
  },
  bestOf(engine, attacker, target, ids, sp){
    let best=engine.preview(attacker,target,engine.SK.basic_attack);
    (ids||[]).forEach(id=>{
      const s=engine.SK[id]; if(!s) return;
      if(sp!=null&&(s.cost||0)>sp) return;
      const v=engine.preview(attacker,target,s);
      if(v>best) best=v;
    });
    return best;
  },
  /* 相手が今このターンに出せる最大火力（防御の値踏みに使う） */
  foeBest(engine, foe, me){
    const o=engine.options(foe.side);
    return Math.max(engine.preview(foe,me,engine.SK.basic_attack),
      ...o.skills.filter(x=>x.usable).map(x=>engine.preview(foe,me,BattleEngine.effectiveSkill(x.skill,x.maxSpend))));
  },
  /* 相手が覚醒したら、どれだけ殴られるようになるか */
  foeAwakenBest(engine, foe, me){
    const a=foe.char.awakening;
    if(!a||!a.enabled||!a.form) return 0;
    return this.bestOf(engine,this.ghost(foe,a.form),me,a.form.skills,BALANCE.sp.max);
  },
  /* 覚醒の代償（1ターンあたりの見込み） */
  drainPerTurn(fighter){
    const c=(fighter.char.awakening&&fighter.char.awakening.cost)||{};
    if(c.hpPercentPerTurn){
      const p=(Effects.num(c.hpPercentPerTurn.minPercent,0)+Effects.num(c.hpPercentPerTurn.maxPercent,0))/2;
      return fighter.maxHp*p/100;
    }
    return Effects.num(c.hpPerTurn,0);
  },

  /* --- 覚醒を切るかどうか。このゲームで一番大事な判断 --- */
  awakenScore(engine, me, foe, cfg){
    const a=me.char.awakening; if(!a) return -9999;
    const dur=Math.max(1,AwakeningSystem.duration(me));
    const nowBest=this.bestOf(engine,me,foe,me.skills,me.sp);
    const ghost=this.ghost(me,a.form);
    const awkBest=this.bestOf(engine,ghost,foe,(a.form&&a.form.skills)||[],BALANCE.sp.max);
    const drain=this.drainPerTurn(me), total=drain*dur;
    const gain=Math.max(0,awkBest-nowBest)*dur;

    let v=gain-total*1.15+cfg.awakenBias;
    if(awkBest*dur>=foe.hp) v+=380;                 // 覚醒中に倒しきれる
    if(awkBest>=foe.hp) v+=260;                     // いきなり届く
    if(me.hp-total<=1) v-=900;                      // 代償で自滅する
    if(me.hp-total<=this.foeBest(engine,foe,me)) v-=240;  // 覚醒しても押し切られる
    if(foe.hp<=nowBest) v-=500;                     // 覚醒しなくても倒せる。取っておく
    ((a.afterEffects||[]).length) && (v-=70);       // 反動が残る
    // 相手がまだ覚醒していないなら、先に切ると覚醒返しを食らう
    if(cfg.readFoeAwaken&&foe.awaken&&foe.awaken.state!=="SPENT"&&foe.awaken.state!=="NONE"&&!foe.awaken.used){
      v-=140*cfg.readFoeAwaken;
      if(foe.awaken.state==="AVAILABLE") v-=110*cfg.readFoeAwaken;
    }
    // 追い詰められたら理屈抜きで切る
    if(me.hp/me.maxHp<=cfg.awakenPanicHp) v+=300;
    return v;
  },

  /* ------------------------------------------------------------------ */
  choose(engine, side, level){
    const cfg=this.cfg(level);
    const me=engine.fighters[side], foe=engine.foe(side);
    const rng=()=>engine.rng();
    const o=engine.options(side);
    const hpRate=me.hp/me.maxHp, foeRate=foe.hp/foe.maxHp;
    const foeBest=this.foeBest(engine,foe,me);
    const foeCounter=Effects.find(foe,"COUNTER");
    const cand=[];

    /* 覚醒：条件を満たしていて、切る価値があると判断したら切る */
    if(o.canAwaken&&this.awakenScore(engine,me,foe,cfg)>0) return {type:"AWAKEN"};

    /* 基本攻撃 */
    const basic=this.estimate(engine,me,foe,engine.SK.basic_attack);
    cand.push({action:{type:"ATTACK"},score:basic.avg,lethal:basic.max>=foe.hp?basic.chance:0});

    /* 防御：相手の最大火力を半分にする価値 ＋ SP回復 */
    let defScore=foeBest*0.34+16;
    if(me.sp<=1) defScore+=38;
    if(hpRate<0.25) defScore+=26;
    if(cfg.readFoeAwaken&&foe.awaken&&foe.awaken.state==="AVAILABLE")
      defScore+=this.foeAwakenBest(engine,foe,me)*0.18*cfg.readFoeAwaken;   // 覚醒返しに備える
    if(foeRate<0.15) defScore-=60;                 // ここで守っても仕方ない
    cand.push({action:{type:"DEFEND"},score:defScore*cfg.defendBias,lethal:0});

    const eff=x=>BattleEngine.effectiveSkill(x.skill,x.maxSpend);
    const myBest=Math.max(basic.avg,...o.skills.filter(x=>x.usable).map(x=>engine.preview(me,foe,eff(x))));

    o.skills.forEach(x=>{
      if(!x.usable) return;
      const s=eff(x);
      const damaging=(s.type==="ATTACK"||s.type==="SPECIAL");
      const est=this.estimate(engine,me,foe,s);
      let score=est.avg*(damaging?cfg.skillBias:1);
      let lethal=(damaging&&est.max>=foe.hp)?est.chance:0;

      /* 回復・解除 */
      if(s.healPercent){
        const heal=Math.min(me.maxHp-me.hp,me.maxHp*s.healPercent/100);
        score+=heal*(hpRate<0.45?1.7:0.3);
        if(heal<me.maxHp*0.03) score-=90;           // 満タンで飲まない
        if(s.cleanse){
          const bad=me.effects.filter(e=>(e.kind==="STAT"&&e.mult<1)||e.kind==="DOT"||e.kind==="ACC").length;
          const good=me.effects.filter(e=>(e.kind==="STAT"&&e.mult>=1)||e.kind==="PIERCE"||e.kind==="SHIELD").length;
          score+=bad*55-good*80;
        }
      }
      /* 付与する効果の値踏み */
      (s.effects||[]).forEach(e=>{
        const tgt=(e.target==="enemy")?foe:me;
        if(tgt.effects.some(x2=>x2.name===e.name)){ score-=45; return; }
        const ch=(e.chance!=null?e.chance:1);
        const w=v=>{ score+=v*ch; };
        const d=Math.max(1,e.duration||1);
        if(e.kind==="STUN"){ w(foeBest*1.1); return; }
        if(e.kind==="TIMESTOP"){ w(foeBest*1.05*d); return; }
        if(e.kind==="SLEEP"){ w(foeBest*0.8); return; }
        if(e.kind==="PETRIFY"){ w(foeBest*0.6*d); return; }
        if(e.kind==="EXTRA"){ w(myBest*0.55*d); return; }
        if(e.kind==="ENDURE"){ w(me.hp*0.25); return; }
        if(e.kind==="TIMESKIP"){
          const good=foe.effects.filter(z=>(z.kind==="STAT"&&z.mult>=1)||z.kind==="PIERCE").length;
          const dots=foe.effects.filter(z=>z.kind==="DOT").length;
          w(good*70+dots*90+20); return;
        }
        if(e.kind==="INVERT"){
          const good=foe.effects.filter(z=>z.kind==="STAT"&&z.mult>=1).length;
          w(good?good*120:10); return;
        }
        if(e.kind==="PARALYZE"){ w(foeBest*(e.value||30)/100*d); return; }
        if(e.kind==="SILENCE"){ w(foeBest*0.45*d); return; }
        if(e.kind==="CONFUSE"){ w(foeBest*(e.value||30)/120*d); return; }
        if(e.kind==="SHIELD"){ w(Math.min(e.value||0,foeBest*d)*0.7); return; }
        if(e.kind==="HEALBLOCK"){ w(60); return; }
        if(e.kind==="CRIT"){ w(myBest*0.2*d); return; }
        if(e.kind==="DOT"){ w((e.percent?foe.maxHp*e.percent/100:(e.value||0))*Math.min(d,4)*0.85); return; }
        if(e.kind==="REGEN"){ w((e.percent?me.maxHp*e.percent/100:e.value)*Math.min(d,4)*(hpRate<0.6?1:0.5)); return; }
        if(e.kind==="PIERCE"){ w(myBest*0.5*d); return; }
        if(e.kind==="NEGATE"){ w(foeBest*0.75); return; }
        if(e.kind==="COUNTER"){ w(foeBest*(e.ratio||0.5)*0.8); return; }
        if(e.kind==="ACC"){ w(Effects.isPermanent(e)?90:45); return; }
        if(e.kind==="STAT"){
          if(e.target==="self"){
            if(e.stat==="atk") score+=myBest*(e.mult-1)*d*0.85;
            else if(e.stat==="def") score+=foeBest*(1-1/e.mult)*d*0.7;
            else score+=30*d;
          }else{
            if(e.stat==="atk") score+=foeBest*(1-e.mult)*d*0.85;
            else if(e.stat==="def") score+=myBest*(1/e.mult-1)*d*0.5;
            else score+=28*d;
          }
          return;
        }
        w(25);
      });

      if(!damaging) score-=myBest*0.5;                      // 攻撃しないターンの損
      if(me.lastSkillId===s.id&&!damaging) score-=70;       // 同じ構えの繰り返しを避ける
      if(me.lastSkillId===s.id) score+=cfg.favour;          // ひかえめは好きな技を繰り返す
      if(s.drain) score+=est.avg*s.drain*(hpRate<0.6?0.9:0.4);
      if(s.selfHpCost){
        const risk=me.hp*(s.selfHpCost.maxPercent/100);
        score-=risk*(hpRate<0.3?1.8:0.6);
      }
      /* 反撃を張っている相手に多段技で突っ込まない */
      if(cfg.readCounter&&foeCounter&&damaging){
        score-=est.avg*(foeCounter.ratio||0.5)*(s.hits||1)*0.55*cfg.readCounter;
      }
      /* 一度きりの技・回数制限の技は、決め手になるときまで取っておく */
      if(cfg.saveOnce&&s.oncePerBattle&&!lethal&&foeRate>0.45) score-=180*cfg.saveOnce;
      if(cfg.saveOnce&&s.uses&&!s.healPercent&&foeRate>0.6) score-=40*cfg.saveOnce;
      /* SPを抱えこむ癖（弱い相手ほど強い技を撃てない） */
      if(cfg.spHoard&&(s.cost||0)>Math.max(0,me.sp-cfg.spHoard)) score-=120;
      /* 次のターンに主力が撃てなくなる手は少しだけ渋る */
      if((s.cost||0)>me.sp-1) score-=10;
      cand.push({action:{type:"SKILL",skillId:x.skill.id,spend:x.maxSpend},score,lethal});
    });

    /* 倒しきれる手を逃さない。確率が高いものを優先し、同率なら確実な方 */
    if(cfg.lethal){
      const kills=cand.filter(c=>c.lethal>=cfg.lethal);
      if(kills.length){
        kills.sort((a,b)=>b.lethal-a.lethal||b.score-a.score);
        return kills[0].action;
      }
    }

    /* 人間くささ：たまに素直でない手を選ぶ */
    if(cfg.noise>0&&rng()<cfg.noise){
      const top=cand.slice().sort((a,b)=>b.score-a.score);
      const pool=top.slice(0,Math.max(2,Math.ceil(top.length*0.7)));   // 論外の手までは選ばない
      return pool[Math.floor(rng()*pool.length)].action;
    }
    cand.sort((a,b)=>b.score-a.score);
    return cand[0].action;
  }
};
