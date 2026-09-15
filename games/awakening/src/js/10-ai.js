/* =========================================================================
   07b. AI — カスタムマッチ用の思考ルーチン。エンジンの公開情報だけを見る。
   ========================================================================= */
const AI = {
  LEVELS:{
    easy:{label:"ひかえめ",noise:0.55,awaken:0.35,defend:0.9},
    normal:{label:"ふつう",noise:0.20,awaken:0.75,defend:1.0},
    hard:{label:"本気",noise:0.03,awaken:1.0,defend:1.15}
  },
  choose(engine, side, level){
    const cfg=this.LEVELS[level]||this.LEVELS.normal;
    const me=engine.fighters[side], foe=engine.foe(side);
    const o=engine.options(side);
    const hpRate=me.hp/me.maxHp, foeRate=foe.hp/foe.maxHp;
    const cand=[];

    // 覚醒：条件を満たしていて、勝負どころだと判断したら切る
    if(o.canAwaken){
      const worth = hpRate<=0.6 || foeRate<=0.45 || me.char.awakening.duration>=5;
      if(worth && Math.random()<cfg.awaken) return {type:"AWAKEN"};
    }

    // 基本攻撃
    cand.push({action:{type:"ATTACK"},score:engine.preview(me,foe,engine.SK.basic_attack)});

    // 防御：相手の最大火力の半分を受け止める価値 ＋ SP回復
    const foeBest=Math.max(0,...engine.options(foe.side).skills
      .filter(x=>x.usable).map(x=>engine.preview(foe,me,x.skill)),
      engine.preview(foe,me,engine.SK.basic_attack));
    let defScore=foeBest*0.35+18;
    if(me.sp<=1) defScore+=40;
    if(hpRate<0.25) defScore+=30;
    cand.push({action:{type:"DEFEND"},score:defScore*cfg.defend});

    const eff=x=>BattleEngine.effectiveSkill(x.skill,x.maxSpend);
    const myBest=Math.max(engine.preview(me,foe,engine.SK.basic_attack),
      ...o.skills.filter(x=>x.usable).map(x=>engine.preview(me,foe,eff(x))));

    o.skills.forEach(x=>{
      if(!x.usable) return;
      const s=eff(x);
      const damaging=(s.type==="ATTACK"||s.type==="SPECIAL");
      let score=engine.preview(me,foe,s);
      if(damaging&&score>=foe.hp) score+=10000;
      if(s.healPercent){
        const heal=Math.min(me.maxHp-me.hp,me.maxHp*s.healPercent/100);
        score+=heal*(hpRate<0.45?1.7:0.3);
        if(s.cleanse){
          const bad=me.effects.filter(e=>(e.kind==="STAT"&&e.mult<1)||e.kind==="DOT"||e.kind==="ACC").length;
          const good=me.effects.filter(e=>(e.kind==="STAT"&&e.mult>=1)||e.kind==="PIERCE").length;
          score+=bad*50-good*70;
        }
      }
      (s.effects||[]).forEach(e=>{
        const tgt=(e.target==="enemy")?foe:me;
        if(tgt.effects.some(x2=>x2.name===e.name)){ score-=45; return; }
        const ch=(e.chance!=null?e.chance:1);
        const w=v=>{ score+=v*ch; };
        if(e.kind==="STUN"){ w(foeBest*1.1); return; }
        if(e.kind==="TIMESTOP"){ w(foeBest*1.05*Math.max(1,e.duration)); return; }
        if(e.kind==="SLEEP"){ w(foeBest*0.8); return; }
        if(e.kind==="PETRIFY"){ w(foeBest*0.6*Math.max(1,e.duration)); return; }
        if(e.kind==="EXTRA"){ w(myBest*0.55*Math.max(1,e.duration)); return; }
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
        if(e.kind==="PARALYZE"){ w(foeBest*(e.value||30)/100*Math.max(1,e.duration)); return; }
        if(e.kind==="SILENCE"){ w(foeBest*0.45*Math.max(1,e.duration)); return; }
        if(e.kind==="CONFUSE"){ w(foeBest*(e.value||30)/120*Math.max(1,e.duration)); return; }
        if(e.kind==="SHIELD"){ w(Math.min(e.value||0,foeBest*Math.max(1,e.duration))*0.7); return; }
        if(e.kind==="HEALBLOCK"){ w(60); return; }
        if(e.kind==="CRIT"){ w(myBest*0.2*Math.max(1,e.duration)); return; }
        if(e.kind==="DOT"&&e.percent){ w(foe.maxHp*e.percent/100*Math.min(e.duration,4)*0.8); return; }
        if(e.kind==="REGEN"){ w((e.percent?me.maxHp*e.percent/100:e.value)*Math.min(e.duration,4)*(hpRate<0.6?1:0.5)); return; }
        if(e.kind==="PIERCE") score+=myBest*0.5;
        else if(e.kind==="NEGATE") score+=foeBest*0.6;
        else if(e.kind==="COUNTER") score+=foeBest*(e.ratio||0.5)*0.8;
        else if(e.kind==="DOT") score+=e.value*Math.min(e.duration,3)*0.8;
        else if(e.kind==="ACC") score+=45;
        else if(e.kind==="STAT"){
          const d=Math.max(1,e.duration);
          if(e.target==="self"){
            if(e.stat==="atk") score+=myBest*(e.mult-1)*d*0.8;
            else if(e.stat==="def") score+=foeBest*(1-1/e.mult)*d*0.7;
            else score+=30*d;
          }else{
            if(e.stat==="atk") score+=foeBest*(1-e.mult)*d*0.8;
            else if(e.stat==="def") score+=myBest*(1/e.mult-1)*d*0.5;
            else score+=28*d;
          }
        }else score+=25;
      });
      if(!damaging) score-=myBest*0.5;                     // 攻撃しないターンの損
      if(me.lastSkillId===s.id&&!damaging) score-=70;      // 同じ構えの繰り返しを避ける
      if(s.drain) score+=engine.preview(me,foe,s)*s.drain*(hpRate<0.6?0.9:0.4);
      if(s.selfHpCost) score-=me.hp*(s.selfHpCost.maxPercent/100)*(hpRate<0.3?1.8:0.6);
      if(s.cost>me.sp-1) score-=10;
      cand.push({action:{type:"SKILL",skillId:x.skill.id,spend:x.maxSpend},score});
    });

    if(Math.random()<cfg.noise){
      return cand[Math.floor(Math.random()*cand.length)].action;
    }
    cand.sort((a,b)=>b.score-a.score);
    return cand[0].action;
  }
};

