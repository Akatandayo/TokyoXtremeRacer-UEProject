/* =========================================================================
   05. Effects — 状態効果の共通システム
   kind: STAT / DOT / REGEN / STUN / COUNTER / SP ほか（03-status.js を参照）

   重ねがけの規則（ここに集約する）
   ・同名の効果は「上書き」。持続だけが伸び、効果量は多重にならない。
   ・同じ kind の能力変化（STAT）は名前が違えば共存するが、
     同じ stat に対しては強い方だけを残す（1.25倍と1.3倍を掛け算させない）。
   ・duration が BALANCE.permanentDuration 以上のものは永続。ターン経過で減らない。
   ========================================================================= */
const Effects = {
  /* 数値が壊れた定義を持ち込まれてもエンジンを落とさない */
  num(v, dflt){ const n=Number(v); return Number.isFinite(n) ? n : dflt; },
  _seq:0,   // 効果の識別子。乱数を使わないのでオンライン対戦でも両端末で一致する

  /* かけたターンを記録し、そのターンは持続ターンを減らさない。
     ただし duration=1 の効果は「このターンだけ」の構えなので、その場で切れる。 */
  apply(fighter, def, turn){
    if(def.kind==="SP"){ fighter.sp=Math.min(BALANCE.sp.max, fighter.sp+this.num(def.value,0)); return null; }
    const e={
      id:def.name+"_"+(++Effects._seq),
      name:def.name||"効果", kind:def.kind, stat:def.stat||null,
      mult:this.num(def.mult,1), add:this.num(def.add,0),
      value:this.num(def.value,0), ratio:this.num(def.ratio,0), percent:this.num(def.percent,0),
      icon:def.icon||null, tone:def.tone||null,
      duration:Math.max(0,Math.min(999,Math.round(this.num(def.duration,1)))),
      appliedTurn:(turn!=null?turn:-1)
    };
    if(e.kind==="STAT"&&!(e.mult>0)) e.mult=1;   // 0倍や負の倍率は無効化（ATK0で詰むのを防ぐ）
    e.fresh = (e.duration>1);
    // 同名効果は上書き（重ねがけによる無限強化を防ぐ）
    const i=fighter.effects.findIndex(x=>x.name===e.name);
    if(i>=0){ fighter.effects[i]=e; return e; }
    // 同じ能力への同方向の変化は、強い方だけを残す（掛け算で暴走させない）
    if(e.kind==="STAT"){
      const j=fighter.effects.findIndex(x=>x.kind==="STAT"&&x.stat===e.stat&&(x.mult>=1)===(e.mult>=1));
      if(j>=0){
        const old=fighter.effects[j];
        const keep = (e.mult>=1) ? (e.mult>=old.mult) : (e.mult<=old.mult);
        if(keep) fighter.effects[j]=e; else old.duration=Math.max(old.duration,e.duration);
        return keep?e:old;
      }
    }
    fighter.effects.push(e);
    return e;
  },
  stat(fighter, stat){
    let v=this.num(fighter.base[stat],0);
    fighter.effects.forEach(e=>{ if(e.kind==="STAT"&&e.stat===stat){ v=v*e.mult+e.add; } });
    if(!Number.isFinite(v)) v=this.num(fighter.base[stat],1);
    return Math.max(1, Math.round(v));
  },
  amount(fighter, e){
    const v = e.percent ? Math.max(1,Math.floor(fighter.maxHp*e.percent/100)) : this.num(e.value,0);
    return Math.max(0, Math.floor(v));
  },
  has(fighter, kind){ return fighter.effects.some(e=>e.kind===kind); },
  accMod(fighter){
    let v=0; fighter.effects.forEach(e=>{ if(e.kind==="ACC") v+=this.num(e.value,0); }); return v;
  },
  remove(fighter, effect){
    const i=fighter.effects.indexOf(effect); if(i>=0) fighter.effects.splice(i,1);
  },
  clear(fighter){ const n=fighter.effects.length; fighter.effects=[]; return n; },
  find(fighter, kind){ return fighter.effects.find(e=>e.kind===kind)||null; },
  isFresh(e, turn){ return e.fresh && e.appliedTurn===turn; },
  isPermanent(e){ return e.duration>=BALANCE.permanentDuration; },
  tickDurations(fighter, turn){
    fighter.effects.forEach(e=>{
      if(Effects.isPermanent(e)) return;                      // 永続は減らさない
      if(Effects.isFresh(e,turn)){ e.fresh=false; return; }   // かけたターンは減らさない
      e.duration--;
    });
    fighter.effects=fighter.effects.filter(e=>e.duration>0);
  }
};
