/* =========================================================================
   06. AwakeningSystem — 覚醒条件の判定・覚醒形態への移行・代償の処理
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
    if(fighter.awaken.state!=="LOCKED") return;
    if(this.ready(fighter)){
      fighter.awaken.state="AVAILABLE";
      engine.push("sys",`${fighter.name}の覚醒条件を満たした。`);
      engine.push("awaken",`【覚醒可能】${fighter.name}`);
    }
  },
  awaken(fighter, engine){
    const a=fighter.char.awakening, form=a.form||{};
    fighter.form="AWAKENED";
    fighter.formName=a.name||"覚醒形態";
    // ステータス変更（HPは引き継ぐ。最大HPを変える形態も設定可能）
    if(form.stats){
      Object.keys(form.stats).forEach(k=>{
        if(k==="hp"){ const d=form.stats.hp-fighter.maxHp; fighter.maxHp=form.stats.hp; fighter.hp=Math.min(fighter.maxHp,fighter.hp+Math.max(0,d)); }
        else fighter.base[k]=form.stats[k];
      });
    }
    // 技セットを丸ごと差し替える
    if(form.skills&&form.skills.length) fighter.skills=form.skills.slice();
    (form.effects||[]).forEach(e=>Effects.apply(fighter,e,engine.turn));
    fighter.awaken.state="ACTIVE";
    fighter.awaken.used=true;
    fighter.awaken.turnsLeft=a.duration||0;
    fighter.awaken.startTurn=engine.turn;
    engine.push("awaken",`【AWAKENING】${fighter.name}が${fighter.formName}へ移行した！`,fighter.side);
    if(a.cost&&a.cost.label) engine.push("sys",`代償：${a.cost.label}`);
  },
  endTurn(fighter, engine){
    if(fighter.awaken.state!=="ACTIVE") return;
    // 覚醒したそのターンは、持続ターンもHPの代償も進まない
    if(fighter.awaken.startTurn===engine.turn) return;
    const a=fighter.char.awakening;
    let drain=(a.cost&&a.cost.hpPerTurn)||0;
    const pc=a.cost&&a.cost.hpPercentPerTurn;
    if(pc){
      const pct=pc.minPercent+engine.rng()*(pc.maxPercent-pc.minPercent);
      drain=Math.max(1,Math.floor(fighter.maxHp*pct/100));
    }
    if(drain>0&&fighter.hp>0){
      fighter.hp=Math.max(0,fighter.hp-drain);
      engine.push("dmg",`${fighter.name}は覚醒の代償で${drain}ダメージ！`);
      engine.checkDeath(fighter);
    }
    if(fighter.hp<=0) return;
    if(a.duration>0){
      fighter.awaken.turnsLeft--;
      if(fighter.awaken.turnsLeft<=0) this.revert(fighter,engine);
      else if(fighter.awaken.turnsLeft<=2) engine.push("sys",`${fighter.name}の覚醒はあと${fighter.awaken.turnsLeft}ターン。`);
    }
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

