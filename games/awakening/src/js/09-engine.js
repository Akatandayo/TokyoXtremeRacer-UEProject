/* =========================================================================
   07. BattleEngine — ルール・計算・状態管理。UIを一切知らない。
   ========================================================================= */
class BattleEngine{
  constructor(charA, charB, opts){
    this.opts=opts||{};
    this.SK=Object.assign({},SKILLS,this.opts.skills||{});
    this.seed=(this.opts.seed!=null)?this.opts.seed:Math.floor(Math.random()*4294967296);
    this.rng=BattleEngine.makeRng(this.seed);
    this.log=[];
    this.turn=1;
    this.over=false;
    this.winner=null;
    this.pending=[null,null];
    this.draw=false;           // 相打ち・判定引き分け
    this.timeUp=false;         // ターン上限による判定決着
    this.firstActor=null;      // 1ターン目に先に動いた側（バランス計測用）
    this.lastOrder=null;       // 直前のターンの行動順
    this.fighters=[this.makeFighter(charA,0),this.makeFighter(charB,1)];
    // 連戦モードなどで前の戦闘からHP／SPを持ち越す
    if(this.opts.startHp) this.opts.startHp.forEach((v,i)=>{
      if(v!=null&&this.fighters[i]) this.fighters[i].hp=Math.max(1,Math.min(this.fighters[i].maxHp,Math.round(v)));
    });
    if(this.opts.startSp) this.opts.startSp.forEach((v,i)=>{
      if(v!=null&&this.fighters[i]) this.fighters[i].sp=Math.max(0,Math.min(BALANCE.sp.max,Math.round(v)));
    });
    this.push("turn",`ターン ${this.turn}`);
    this.push("sys",`${this.fighters[0].name} と ${this.fighters[1].name} の戦闘を開始する。`);
  }
  static makeRng(seed){
    let a=seed>>>0;
    return function(){
      a=(a+0x6D2B79F5)>>>0;
      let t=Math.imul(a^(a>>>15),1|a);
      t=(t+Math.imul(t^(t>>>7),61|t))^t;
      return ((t^(t>>>14))>>>0)/4294967296;
    };
  }
  makeFighter(char, side){
    const f={
      side, char, name:char.name, portrait:char.portrait||"◆", portraitImage:char.portraitImage||null,
      base:{...char.stats}, maxHp:char.stats.hp, hp:char.stats.hp,
      sp:BALANCE.sp.start, effects:[], defending:false,
      skills:char.skills.slice(), usedOnce:{}, skillUse:{}, usedCount:{},
      damageTaken:0, turnCount:0,
      form:"NORMAL", formName:null,
      awaken:{state:(char.awakening&&char.awakening.enabled)?"LOCKED":"NONE",turnsLeft:0,used:false,
        bonusTurns:(this.opts.awakenBonusTurns&&this.opts.awakenBonusTurns[side])||0}
    };
    return f;
  }
  /* --- ログ：各行に状態のスナップショットを持たせ、UIが順番に再生できるようにする --- */
  push(kind, text, actor){
    this.log.push({kind,text,turn:this.turn,actor:(actor==null?null:actor),snap:this.snapshot()});
  }
  snapshot(){
    return this.fighters.map(f=>({
      hp:f.hp,maxHp:f.maxHp,sp:f.sp,form:f.form,formName:f.formName,
      awaken:f.awaken.state,defending:f.defending,
      effects:f.effects.map(e=>({name:e.name,kind:e.kind,stat:e.stat,mult:e.mult,duration:e.duration}))
    }));
  }
  foe(side){ return this.fighters[side===0?1:0]; }

  /* --- 選択可能なコマンドを返す（UIはこれを表示するだけ） --- */
  options(side){
    const f=this.fighters[side];
    return {
      canAwaken: AwakeningSystem.canAwaken(f),
      silenced: Effects.has(f,"SILENCE"),
      skills: f.skills.map(id=>{
        const s=this.SK[id]; if(!s) return null;
        let usable=true, reason="";
        if(Effects.has(f,"SILENCE")){ usable=false; reason="沈黙"; }
        if(s.cost>f.sp){ usable=false; reason="SP不足"; }
        if(s.oncePerBattle&&f.usedOnce[id]){ usable=false; reason="使用済み"; }
        if(s.uses){
          const left=s.uses-(f.usedCount[id]||0);
          if(left<=0){ usable=false; reason="使用済み"; } else reason="残り"+left+"回";
        }
        return {skill:s,usable,reason,
          variable:!!s.costMax, maxSpend:this.maxSpend(f,s)};
      }).filter(Boolean)
    };
  }
  submit(side, action){ this.pending[side]=action; }
  bothReady(){ return this.pending[0]&&this.pending[1]; }

  /* --- 行動の検証：撃てない技・持っていない技・切れない覚醒は通常攻撃に落とす ---
     UI・AI・通信のどこでずれても、エンジンだけは必ず筋の通った状態で進む。 */
  validate(side, action){
    const f=this.fighters[side];
    const fallback={type:"ATTACK"};
    if(!action||typeof action.type!=="string") return fallback;
    if(action.type==="AWAKEN") return AwakeningSystem.canAwaken(f) ? {type:"AWAKEN"} : fallback;
    if(action.type==="DEFEND") return {type:"DEFEND"};
    if(action.type!=="SKILL") return fallback;
    const s=this.SK[action.skillId];
    if(!s||f.skills.indexOf(action.skillId)<0) return fallback;
    if(Effects.has(f,"SILENCE")) return fallback;
    if(s.oncePerBattle&&f.usedOnce[action.skillId]) return fallback;
    if(s.uses&&(f.usedCount[action.skillId]||0)>=s.uses) return fallback;
    const spend=s.costMax
      ? Math.max(s.cost||0,Math.min(Effects.num(action.spend,this.maxSpend(f,s)),this.maxSpend(f,s)))
      : (s.cost||0);
    if(spend>f.sp) return fallback;
    return {type:"SKILL",skillId:action.skillId,spend};
  }

  /* --- ターン処理 --- */
  resolveTurn(){
    const from=this.log.length;
    if(this.over) return [];
    // 届いた行動は必ず検証する（通信の化け・AIの取り違え・改造対策）
    const acts=[0,1].map(s=>({side:s,f:this.fighters[s],a:this.validate(s,this.pending[s])}));

    // 防御宣言は行動順に関係なくターン開始時点で有効にする
    acts.forEach(x=>{ x.f.defending = (x.a.type==="DEFEND"); });

    // 行動順：技のpriority → SPD → ランダム
    acts.forEach(x=>{
      // 先制は上限で頭打ちにする。取り込んだデータや通信相手の技でも「優先度ゲー」にしない。
      const 上限=(BALANCE.maxPriority!=null)?BALANCE.maxPriority:3;
      const p=(this.SK[x.a.skillId]||{}).priority||0;
      x.prio = x.a.type==="AWAKEN" ? 9 : (x.a.type==="SKILL" ? Math.max(0,Math.min(上限,p)) : 0);
      x.spd = Effects.stat(x.f,"spd");
      x.tie = this.rng();
    });
    acts.sort((p,q)=> q.prio-p.prio || q.spd-p.spd || q.tie-p.tie);
    this.lastOrder=acts.map(x=>x.side);
    if(this.firstActor===null) this.firstActor=acts[0].side;

    for(const x of acts){
      if(this.over) break;
      if(x.f.hp<=0) continue;
      this.execute(x);
    }

    if(!this.over) this.endOfTurn();
    this.pending=[null,null];
    return this.log.slice(from);
  }

  execute(x){
    const f=x.f, a=x.a, enemy=this.foe(f.side);
    f.turnCount++;
    const stun=Effects.find(f,"STUN");
    if(stun){ this.push("status",`${f.name}は${stun.name}で動けない！`); Effects.remove(f,stun); return; }
    const hold=Effects.find(f,"TIMESTOP")||Effects.find(f,"SLEEP")||Effects.find(f,"PETRIFY");
    if(hold){ this.push("status",`${f.name}は${hold.name}で動けない！`); return; }
    const para=Effects.find(f,"PARALYZE");
    if(para&&this.rng()*100<(para.value||30)){
      this.push("status",`${f.name}は${para.name}で体が動かない！`); return;
    }
    const conf=Effects.find(f,"CONFUSE");
    if(conf&&a.type!=="AWAKEN"&&this.rng()*100<(conf.value||30)){
      const r=this.damage(f,f,this.SK.basic_attack,{selfHit:true});
      this.push("status",`${f.name}は${conf.name}で自分を攻撃した！ ${r.value}ダメージ！`);
      this.checkDeath(f);
      return;
    }

    if(a.type==="AWAKEN"){ AwakeningSystem.awaken(f,this); return; }   // 可否は validate 済み
    if(a.type==="DEFEND"){
      f.sp=Math.min(BALANCE.sp.max,f.sp+BALANCE.sp.defendBonus);
      this.push("sys",`${f.name}は身を固めた。`,f.side);
      return;
    }
    const raw = a.type==="ATTACK" ? this.SK.basic_attack : this.SK[a.skillId];
    if(!raw) return;
    const spend = raw.costMax
      ? Math.max(raw.cost||0, Math.min(a.spend!=null?a.spend:this.maxSpend(f,raw), this.maxSpend(f,raw)))
      : (raw.cost||0);
    const skill = BattleEngine.effectiveSkill(raw,spend);
    f.sp=Math.max(0,f.sp-spend);
    if(raw.oncePerBattle) f.usedOnce[raw.id]=true;
    if(raw.uses) f.usedCount[raw.id]=(f.usedCount[raw.id]||0)+1;
    f.skillUse[raw.id]=(f.skillUse[raw.id]||0)+1;
    f.lastSkillId=raw.id;
    this.push("action",`${f.name}は「${raw.name}」を使用した！${raw.costMax?`（SP${spend}）`:""}`,f.side);

    // 使用者自身が支払うHPコスト
    if(skill.selfHpCost){
      const c=skill.selfHpCost;
      const pool=(c.of==="max")?f.maxHp:f.hp;
      const pct=c.minPercent+this.rng()*(c.maxPercent-c.minPercent);
      const loss=Math.max(1,Math.floor(pool*pct/100));
      f.hp=Math.max(1,f.hp-loss); // 自傷では倒れない
      this.push("dmg",`${f.name}は代償として${loss}のHPを支払った。`);
    }
    // 効果の解除と回復
    if(skill.cleanse){
      const n=Effects.clear(f);
      this.push("sys", n?`${f.name}にかかっていた効果がすべて解除された。`:`${f.name}には解除する効果がなかった。`);
    }
    if(skill.healPercent){
      const block=Effects.find(f,"HEALBLOCK");
      if(block){
        this.push("sys",`${f.name}は「${block.name}」で回復できない！`);
      }else{
        const before=f.hp;
        f.hp=Math.min(f.maxHp,f.hp+Math.floor(f.maxHp*skill.healPercent/100));
        this.push("heal",`${f.name}はHPを${f.hp-before}回復した！`);
      }
    }

    let damaging = (skill.type==="ATTACK"||skill.type==="SPECIAL");
    let anyHit=false;
    // 迎撃効果：相手の攻撃を丸ごと無効化する
    const neg=Effects.find(enemy,"NEGATE");
    if(damaging&&neg){
      Effects.remove(enemy,neg);
      this.push("sys",`${enemy.name}の「${neg.name}」が${f.name}の攻撃を無効化した！`);
      damaging=false;
    }
    if(damaging){
      const hits=skill.hits||1;
      for(let i=0;i<hits;i++){
        if(this.over||enemy.hp<=0) break;
        if(!this.rollHit(f,skill)){ this.push("miss",`${enemy.name}は攻撃をかわした！`); continue; }
        anyHit=true;
        const r=this.damage(f,enemy,skill);
        if(r.crit) this.push("crit",`会心の一撃！`);
        this.push("dmg",`${enemy.name}に${r.value}ダメージ！`);
        this.checkDeath(enemy);
        if(this.over) break;
        this.counter(enemy,f,r.value);
        if(this.over) break;
      }
    }else{
      anyHit=true;
    }

    // 効果の適用：自分向けは常に、相手向けは命中時のみ
    (skill.effects||[]).forEach(e=>{
      if(e.chance!=null&&this.rng()>e.chance){
        if(e.target==="enemy"&&anyHit) this.push("miss",`${enemy.name}には効かなかった。`);
        return;
      }
      const tgt=(e.target==="enemy")?enemy:f;
      if(INSTANT_KINDS.indexOf(e.kind)>=0){
        if(e.target==="enemy"&&(!anyHit||enemy.hp<=0)) return;
        this.instantEffect(tgt,e);
        return;
      }
      if(e.target==="enemy"){
        if(!anyHit||enemy.hp<=0) return;
        Effects.apply(enemy,e,this.turn);
        this.push("status",`${enemy.name}は「${e.name}」状態になった。`);
      }else{
        const applied=Effects.apply(f,e,this.turn);
        this.push("status", applied ? `${f.name}に「${e.name}」の効果。` : `${f.name}はSPを回復した。`);
      }
    });
    if(damaging||a.type==="ATTACK") this.followUp(f,enemy);
  }

  /* 時飛ばし・反転重力のような、付与せずその場で起きる効果 */
  instantEffect(target, def){
    if(def.kind==="TIMESKIP"){
      const n=def.value||2;
      this.push("status",`${target.name}の時間が${n}ターンぶん進んだ！`);
      for(const e of target.effects.slice()){
        if(e.kind==="DOT"){
          const dmg=Effects.amount(target,e)*Math.min(n,e.duration);
          target.hp=Math.max(0,target.hp-dmg); target.damageTaken+=dmg;
          this.push("dmg",`${target.name}は「${e.name}」で${dmg}ダメージ！`);
        }
        e.duration-=n; e.fresh=false;
      }
      target.effects=target.effects.filter(e=>e.duration>0);
      this.checkDeath(target);
      return;
    }
    if(def.kind==="INVERT"){
      const list=target.effects.filter(e=>e.kind==="STAT");
      if(!list.length){ this.push("sys",`${target.name}には反転させる能力変化がなかった。`); return; }
      list.forEach(e=>{ e.mult=Math.round((1/e.mult)*1000)/1000; e.tone=e.mult>=1?"good":"bad"; e.icon=e.mult>=1?"▲":"▽"; });
      this.push("status",`${target.name}の能力変化が反転した！`);
    }
  }
  /* 加速：行動のあとにもう一撃 */
  followUp(f, enemy){
    if(this.over||f.hp<=0||enemy.hp<=0) return;
    const ex=Effects.find(f,"EXTRA");
    if(!ex) return;
    this.push("status",`${f.name}の「${ex.name}」による追撃！`,f.side);
    if(!this.rollHit(f,this.SK.basic_attack)){ this.push("miss",`${enemy.name}はかわした！`); return; }
    const r=this.damage(f,enemy,this.SK.basic_attack);
    if(r.crit) this.push("crit",`会心の一撃！`);
    this.push("dmg",`${enemy.name}に${r.value}ダメージ！`);
    this.checkDeath(enemy);
    if(!this.over) this.counter(enemy,f,r.value);
  }

  rollHit(attacker, skill){
    const raw=(skill.accuracy!=null?skill.accuracy:100)+Effects.accMod(attacker);
    const acc=Math.max(BALANCE.accuracyMin,Math.min(BALANCE.accuracyMax,raw));
    return this.rng()*100 < acc;
  }

  /* --- ダメージ計算：技ごとに計算式を差し替えられる --- */
  damage(attacker, target, skill, opt){
    opt=opt||{};
    const atk=Effects.stat(attacker,"atk");
    const spd=Effects.stat(attacker,"spd");
    const pierceBuff=Effects.find(attacker,"PIERCE");           // {upset} など
    const guardBreak=skill.guardBreak||!!pierceBuff;
    const ignoreBuff=skill.buffPierce||!!pierceBuff;
    // バフ貫通：防御バフは無視するが、デバフはそのまま効く
    const rawDef=ignoreBuff ? Math.min(target.base.def,Effects.stat(target,"def")) : Effects.stat(target,"def");
    const def=Math.round(rawDef*(1-(skill.defPierce||0)));
    const power=skill.power||0;
    let base;
    switch(skill.formula||"standard"){
      case "fixed":           base=power; break;
      case "ignoreDef":       base=atk+power; break;
      case "maxHpRatio":      base=target.maxHp*power/100; break;
      case "currentHpRatio":  base=target.hp*power/100; break;
      case "spdBased":        base=spd+power-def; break;
      default:                base=atk+power-def;
    }
    let critRate=(skill.critRate!=null?skill.critRate:BALANCE.baseCritRate);
    const critEff=Effects.find(attacker,"CRIT");
    if(critEff) critRate+=(critEff.value||0)/100;
    const crit=this.rng()<critRate;
    if(crit) base*=BALANCE.critMultiplier;
    if(target.defending&&!guardBreak) base*=BALANCE.defendMultiplier;
    if(Effects.has(target,"PETRIFY")) base*=0.5;
    if(skill.varyPercent>0) base*=1+(this.rng()*2-1)*Math.min(60,skill.varyPercent)/100;
    if(BALANCE.damageVariance>0){
      base*=1+(this.rng()*2-1)*BALANCE.damageVariance;
    }
    let value=Math.max(BALANCE.minDamage,Math.floor(base));
    // 眠り：殴られれば目を覚ます
    const sl=Effects.find(target,"SLEEP");
    if(sl&&!opt.selfHit){ Effects.remove(target,sl); this.push("status",`${target.name}は目を覚ました！`); }
    // 障壁：HPより先に削れる
    const shield=Effects.find(target,"SHIELD");
    if(shield){
      const absorbed=Math.min(shield.value,value);
      shield.value-=absorbed; value-=absorbed;
      if(absorbed>0) this.push("sys",`${target.name}の「${shield.name}」が${absorbed}を防いだ。`);
      if(shield.value<=0){ Effects.remove(target,shield); this.push("sys",`${target.name}の「${shield.name}」が砕けた。`); }
    }
    // 不屈：倒れる一撃を一度だけ耐える
    const end=Effects.find(target,"ENDURE");
    if(end&&value>=target.hp&&target.hp>1){
      value=target.hp-1;
      Effects.remove(target,end);
      this.push("status",`${target.name}は「${end.name}」で持ちこたえた！`);
    }
    target.hp=Math.max(0,target.hp-value);
    target.damageTaken+=value;
    // 吸収：与えたダメージの一部を自分のHPに変える
    if(skill.drain&&value>0&&!opt.selfHit&&!Effects.has(attacker,"HEALBLOCK")){
      const gain=Math.max(1,Math.floor(value*skill.drain));
      const before=attacker.hp;
      attacker.hp=Math.min(attacker.maxHp,attacker.hp+gain);
      if(attacker.hp>before) this.push("heal",`${attacker.name}は${attacker.hp-before}吸収した！`);
    }
    return {value,crit};
  }

  /* --- 可変SPの技：追加で払ったSPぶん威力と持続を伸ばす --- */
  static effectiveSkill(skill, spend){
    const base=skill.cost||0;
    const extra=Math.max(0,(spend!=null?spend:base)-base);
    if(!extra||(!skill.powerPerSp&&!skill.durationPerSp)) return skill;
    const s2=Object.assign({},skill);
    if(skill.powerPerSp) s2.power=(skill.power||0)+extra*skill.powerPerSp;
    if(skill.durationPerSp&&skill.effects){
      s2.effects=skill.effects.map(e=>Object.assign({},e,{duration:(e.duration||1)+extra*skill.durationPerSp}));
    }
    return s2;
  }
  maxSpend(fighter, skill){
    if(!skill.costMax) return skill.cost||0;
    return Math.max(skill.cost||0, Math.min(skill.costMax, fighter.sp));
  }

  /* --- AIや表示用の期待ダメージ（状態を変えない） --- */
  preview(attacker, target, skill){
    if(!skill||(skill.type!=="ATTACK"&&skill.type!=="SPECIAL")) return 0;
    const atk=Effects.stat(attacker,"atk");
    const spd=Effects.stat(attacker,"spd");
    const pierceBuff=Effects.find(attacker,"PIERCE");
    const ignoreBuff=skill.buffPierce||!!pierceBuff;
    const rawDef=ignoreBuff?Math.min(target.base.def,Effects.stat(target,"def")):Effects.stat(target,"def");
    const def=Math.round(rawDef*(1-(skill.defPierce||0)));
    const power=skill.power||0;
    let base;
    switch(skill.formula||"standard"){
      case "fixed": base=power; break;
      case "ignoreDef": base=atk+power; break;
      case "maxHpRatio": base=target.maxHp*power/100; break;
      case "currentHpRatio": base=target.hp*power/100; break;
      case "spdBased": base=spd+power-def; break;
      default: base=atk+power-def;
    }
    const acc=Math.max(BALANCE.accuracyMin,Math.min(BALANCE.accuracyMax,
      (skill.accuracy!=null?skill.accuracy:100)+Effects.accMod(attacker)));
    return Math.max(BALANCE.minDamage,Math.floor(base))*(skill.hits||1)*acc/100;
  }

  counter(defender, attacker, dmg){
    const c=Effects.find(defender,"COUNTER");
    if(!c||defender.hp<=0) return;
    const value=Math.max(1,Math.floor(dmg*c.ratio));
    attacker.hp=Math.max(0,attacker.hp-value);
    attacker.damageTaken+=value;
    this.push("dmg",`${defender.name}の「${c.name}」！ ${attacker.name}に${value}ダメージ！`);
    this.checkDeath(attacker);
  }

  /* ターン終わりの処理。両者ぶんをそろえてから生死を見るので、
     継続ダメージや覚醒の代償で同時に倒れれば相討ちになる。 */
  endOfTurn(){
    // 継続ダメージ・回復
    for(const f of this.fighters){
      if(f.hp<=0) continue;
      for(const e of f.effects.slice()){
        if(Effects.isFresh(e,this.turn)) continue;
        if(e.kind==="DOT"){
          const dmg=Effects.amount(f,e);
          if(dmg<=0) continue;
          f.hp=Math.max(0,f.hp-dmg); f.damageTaken+=dmg;
          this.push("dmg",`${f.name}は「${e.name}」で${dmg}ダメージ！`);
          if(f.hp<=0) break;
        }else if(e.kind==="REGEN"){
          if(Effects.has(f,"HEALBLOCK")) continue;
          const before=f.hp; f.hp=Math.min(f.maxHp,f.hp+Effects.amount(f,e));
          if(f.hp>before) this.push("heal",`${f.name}は${f.hp-before}回復した。`);
        }
      }
    }
    this.settle(); if(this.over) return;
    // 覚醒の代償 → まとめて生死判定 → 持続ターン
    for(const f of this.fighters) AwakeningSystem.drain(f,this);
    this.settle(); if(this.over) return;
    for(const f of this.fighters) AwakeningSystem.tick(f,this);
    // 効果の持続ターン・防御解除・SP回復
    for(const f of this.fighters){
      Effects.tickDurations(f,this.turn);
      f.defending=false;
      f.sp=Math.min(BALANCE.sp.max,Math.max(0,f.sp+BALANCE.sp.regenPerTurn));
    }
    // 覚醒条件の確認
    for(const f of this.fighters) AwakeningSystem.update(f,this);
    // ターン上限：ここを越えたら必ず決着させる
    if(BALANCE.turnLimit>0&&this.turn>=BALANCE.turnLimit){ this.judgeByHp(); return; }
    this.turn++;
    this.push("turn",`ターン ${this.turn}`);
    const left=BALANCE.turnLimit-this.turn+1;
    if(BALANCE.turnLimit>0&&left>0&&left<=BALANCE.turnLimitWarn)
      this.push("sys",`残り${left}ターンで判定になる。`);
  }

  /* 倒れている者がいれば決着させる（両者なら相討ち） */
  settle(){
    if(this.over) return;
    const dead=this.fighters.filter(f=>f.hp<=0);
    if(!dead.length) return;
    this.checkDeath(dead[0]);
  }

  checkDeath(f){
    if(f.hp>0||this.over) return;
    const other=this.foe(f.side);
    this.over=true;
    this.push("sys",`${f.name}は戦闘不能になった。`);
    if(other.hp<=0){        // 同時に倒れた：相討ち
      this.winner=null; this.draw=true;
      this.push("sys",`${other.name}もまた倒れた。`);
      this.push("win",`相討ち — 引き分け`);
      return;
    }
    this.winner=other;
    this.push("win",`${this.winner.name} の勝利`);
  }

  /* --- ターン上限：防御し合って終わらない試合を必ず終わらせる --- */
  judgeByHp(){
    const a=this.fighters[0], b=this.fighters[1];
    const ra=a.hp/a.maxHp, rb=b.hp/b.maxHp;
    this.over=true; this.timeUp=true;
    this.push("sys",`規定の${BALANCE.turnLimit}ターンが過ぎた。残りHPの割合で決める。`);
    this.push("sys",`${a.name} ${Math.round(ra*100)}%　／　${b.name} ${Math.round(rb*100)}%`);
    if(Math.abs(ra-rb)<0.005){
      this.winner=null; this.draw=true;
      this.push("win",`引き分け`);
      return;
    }
    this.winner=(ra>rb)?a:b;
    this.push("win",`${this.winner.name} の勝利（判定）`);
  }
}

