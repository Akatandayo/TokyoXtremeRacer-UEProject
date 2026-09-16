/* =========================================================================
   06. AwakeningSystem — 覚醒条件の判定・覚醒形態への移行・代償の処理

   代償と持続ターンは drain()／tick() に分けてある。エンジンは両者ぶんの
   代償をまとめて処理してから生死を判定するので、同時に倒れると相打ちになる。
   ========================================================================= */
const AwakeningSystem = {
  conditionMet(fighter, c){
    switch(c.type){
      case "HP_BELOW":      return fighter.hp <= fighter.maxHp*c.value;
      case "DAMAGE_TAKEN":  return fighter.damageTaken >= c.value;
      case "SKILL_USED":    return (fighter.skillUse[c.skillId]||0) >= c.value;
      case "TURN_REACHED":  return fighter.turnCount >= c.value;
      case "HAS_EFFECT":    return fighter.effects.some(e=>e.name===c.name||e.kind===c.kind);
      default: return false;
    }
  },
  ready(fighter){
    const a=fighter.char.awakening;
    if(!a||!a.enabled) return false;
    const list=a.conditions||[];
    if(!list.length) return false;
    return (a.conditionMode==="ALL") ? list.every(c=>this.conditionMet(fighter,c))
                                     : list.some(c=>this.conditionMet(fighter,c));
  },
  update(fighter, engine){
    if(fighter.hp<=0) return;
    if(fighter.awaken.state!=="LOCKED") return;
    if(this.ready(fighter)){
      fighter.awaken.state="AVAILABLE";
      engine.push("sys",`${fighter.name}の覚醒条件を満たした。`);
      engine.push("awaken",`【覚醒可能】${fighter.name}`);
    }
  },
  /* 覚醒できるか。倒れていたり、すでに使い切っていたら不可 */
  canAwaken(fighter){
    return fighter.hp>0 && fighter.awaken.state==="AVAILABLE";
  },
  awaken(fighter, engine){
    if(!this.canAwaken(fighter)){
      engine.push("sys",`${fighter.name}は覚醒できなかった。`);
      return false;
    }
    const a=fighter.char.awakening, form=a.form||{};
    fighter.form="AWAKENED";
    fighter.formName=a.name||"覚醒形態";
    // ステータス変更（HPは引き継ぐ。最大HPを変える形態も設定可能）
    if(form.stats){
      Object.keys(form.stats).forEach(k=>{
        const v=Effects.num(form.stats[k],null); if(v===null) return;
        if(k==="hp"){ const d=v-fighter.maxHp; fighter.maxHp=Math.max(1,v); fighter.hp=Math.min(fighter.maxHp,fighter.hp+Math.max(0,d)); }
        else fighter.base[k]=v;
      });
    }
    // 技セットを丸ごと差し替える
    if(form.skills&&form.skills.length) fighter.skills=form.skills.slice();
    (form.effects||[]).forEach(e=>Effects.apply(fighter,e,engine.turn));
    fighter.awaken.state="ACTIVE";
    fighter.awaken.used=true;
    fighter.awaken.turnsLeft=this.duration(fighter);
    fighter.awaken.startTurn=engine.turn;
    engine.push("awaken",`【AWAKENING】${fighter.name}が${fighter.formName}へ移行した！`,fighter.side);
    if(a.cost&&a.cost.label) engine.push("sys",`代償：${a.cost.label}`);
    return true;
  },
  /* 恩恵などで持続ターンを伸ばせるようにしておく（連戦モードで使う） */
  duration(fighter){
    const a=fighter.char.awakening||{};
    return Math.max(0,(a.duration||0)+(fighter.awaken.bonusTurns||0));
  },
  /* 代償のHP減少だけを処理する（生死の判定はエンジン側でまとめて行う） */
  drain(fighter, engine){
    if(fighter.awaken.state!=="ACTIVE"||fighter.hp<=0) return;
    if(fighter.awaken.startTurn===engine.turn) return;   // 覚醒したそのターンは進まない
    const a=fighter.char.awakening;
    let drain=Effects.num(a.cost&&a.cost.hpPerTurn,0);
    const pc=a.cost&&a.cost.hpPercentPerTurn;
    if(pc){
      const lo=Effects.num(pc.minPercent,0), hi=Effects.num(pc.maxPercent,lo);
      const pct=lo+engine.rng()*Math.max(0,hi-lo);
      drain=Math.max(1,Math.floor(fighter.maxHp*pct/100));
    }
    if(drain>0){
      fighter.hp=Math.max(0,fighter.hp-drain);
      fighter.damageTaken+=drain;
      engine.push("dmg",`${fighter.name}は覚醒の代償で${drain}ダメージ！`);
    }
  },
  /* 持続ターンを進め、切れたら元に戻す */
  tick(fighter, engine){
    if(fighter.awaken.state!=="ACTIVE"||fighter.hp<=0) return;
    if(fighter.awaken.startTurn===engine.turn) return;
    if(this.duration(fighter)>0){
      fighter.awaken.turnsLeft--;
      if(fighter.awaken.turnsLeft<=0) this.revert(fighter,engine);
      else if(fighter.awaken.turnsLeft<=2) engine.push("sys",`${fighter.name}の覚醒はあと${fighter.awaken.turnsLeft}ターン。`);
    }
  },
  /* 旧来の呼び出し口（代償→生死→持続の順） */
  endTurn(fighter, engine){
    this.drain(fighter,engine);
    engine.checkDeath(fighter);
    if(fighter.hp<=0) return;
    this.tick(fighter,engine);
  },
  revert(fighter, engine){
    const a=fighter.char.awakening;
    fighter.form="NORMAL"; fighter.formName=null;
    fighter.base={...fighter.char.stats};
    fighter.skills=fighter.char.skills.slice();
    fighter.awaken.state = (a.oneTime||fighter.awaken.used) ? "SPENT" : "LOCKED";
    engine.push("sys",`${fighter.name}の覚醒が解けた。`);
    (a.afterEffects||[]).forEach(e=>{
      Effects.apply(fighter,e,engine.turn);
      engine.push("sys",`${fighter.name}は「${e.name}」状態になった。`);
    });
  }
};
