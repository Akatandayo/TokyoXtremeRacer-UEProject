/* =========================================================================
   05. Effects — 状態効果の共通システム
   kind: STAT / DOT / REGEN / STUN / COUNTER / SP
   ========================================================================= */
const Effects = {
  /* かけたターンを記録し、そのターンは持続ターンを減らさない。
     ただし duration=1 の効果は「このターンだけ」の構えなので、その場で切れる。 */
  apply(fighter, def, turn){
    if(def.kind==="SP"){ fighter.sp=Math.min(BALANCE.sp.max, fighter.sp+(def.value||0)); return null; }
    const e={
      id:def.name+"_"+Math.random().toString(36).slice(2,7),
      name:def.name||"効果", kind:def.kind, stat:def.stat||null,
      mult:def.mult!=null?def.mult:1, add:def.add||0,
      value:def.value||0, ratio:def.ratio||0, percent:def.percent||0,
      icon:def.icon||null, tone:def.tone||null,
      duration:def.duration!=null?def.duration:1,
      appliedTurn:(turn!=null?turn:-1)
    };
    e.fresh = (e.duration>1);
    // 同名効果は上書き（重ねがけによる無限強化を防ぐ）
    const i=fighter.effects.findIndex(x=>x.name===e.name);
    if(i>=0) fighter.effects[i]=e; else fighter.effects.push(e);
    return e;
  },
  stat(fighter, stat){
    let v=fighter.base[stat]||0;
    fighter.effects.forEach(e=>{ if(e.kind==="STAT"&&e.stat===stat){ v=v*e.mult+e.add; } });
    return Math.max(1, Math.round(v));
  },
  amount(fighter, e){
    return e.percent ? Math.max(1,Math.floor(fighter.maxHp*e.percent/100)) : (e.value||0);
  },
  has(fighter, kind){ return fighter.effects.some(e=>e.kind===kind); },
  accMod(fighter){
    let v=0; fighter.effects.forEach(e=>{ if(e.kind==="ACC") v+=e.value; }); return v;
  },
  remove(fighter, effect){
    const i=fighter.effects.indexOf(effect); if(i>=0) fighter.effects.splice(i,1);
  },
  clear(fighter){ const n=fighter.effects.length; fighter.effects=[]; return n; },
  find(fighter, kind){ return fighter.effects.find(e=>e.kind===kind)||null; },
  isFresh(e, turn){ return e.fresh && e.appliedTurn===turn; },
  tickDurations(fighter, turn){
    fighter.effects.forEach(e=>{
      if(Effects.isFresh(e,turn)){ e.fresh=false; return; }   // かけたターンは減らさない
      e.duration--;
    });
    fighter.effects=fighter.effects.filter(e=>e.duration>0);
  }
};

