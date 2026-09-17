/* =========================================================================
   01b. Regulation（RC＝レギュレーションキャラクリ）

   自作の技とキャラクターに「SP消費に見合っているか」の物差しを与える。

   考え方
     技がもたらす利得を一つの点数（価値）に換算し、
     その技のSP消費から算出した許容量（allowance）と比べる。
       価値 <= 許容量  … 適合（RC）
       価値 >  許容量  … 超過（どれだけ削ればよいかを併せて返す）

   数字はすべてこの表に集約する。コード中に直接書かない。
   較正は tools/regulation.mjs で行い、既定の技が概ね 0.8〜1.1 に収まることを
   目安にしている（既定の技は手で調整された「ちょうどよさ」の基準だから）。
   ========================================================================= */
const RC = {
  /* ---- 許容量：SP1あたりいくらの価値を許すか ---- */
  allow:{
    base:55,            // SP0でも許される最低限（1手つかうこと自体の対価）
    perSP:38,           // SP1ごとに増える許容量
    kneeAt:4,           // ここまでは満額、これを超えたぶんは逓減させる
    kneeRate:0.75,      // 逓減の割合（急すぎると、強いが妥当な技がどのSPでも作れなくなる）
    awakenMult:1.45,    // 覚醒形態の技はこの倍率まで許す（覚醒自体に代償があるため）
    tolerance:0.08      // 端数の揺れを許す幅（8%）
  },
  /* 許容量を直線にすると、SPを盛るだけで既定のどの技より強い一撃が作れてしまう。
     既定の技は高SPほど割に合わない作りになっており、そちらが正しい。よって逓減させる。 */

  /* ---- 攻撃の価値 ----
     エンジンの標準式は「ATK + 威力 - DEF」で、威力は“加算”でしかない。
     だから威力だけを見ると、低威力の技と多段技を大きく見誤る。
     基準となる攻め手と受け手を置き、1発ぶんの実ダメージから価値を出す。 */
  ref:{ atk:130, def:85, spd:105 },
  atk:{
    perPower:1.0,       // 実ダメージ1につき
    guardBreak:1.25,    // 防御を無視する
    buffPierce:1.15,    // 防御バフまで無視する
    defPierceMax:0.5,   // defPierce=1.0 のときの上乗せ率
    perPriority:8,      // 先制1段につき
    critPerPoint:1.0,   // 基準を超えた会心率ぶんの期待値をそのまま足す
    multiHitBonus:0.06, // 多段は手数ぶん有利（1段増すごと）
    currentHpShare:0.75 // 現在HP割合は、平均すると最大HPより減った状態で当たる
  },

  /* ---- 継続・状態異常の価値 ----
     基準HP（refHp）に対する割合で効くものは、そこから点数に直す。 */
  refHp:1300,
  eff:{
    dotFactor:0.5,      // 継続ダメージは即効性が無いぶん割り引く
    regenFactor:0.55,
    healFactor:0.6,     // その場の回復（受け身なので攻撃より軽く見る）
    statPerTurn:52,     // 能力変化 |倍率-1|=1.0 を1ターンかけたときの価値
    shieldFactor:0.7,
    /* 行動を奪う系は、1ターンあたりの価値をまとめて置く（確率を掛ける） */
    holdPerTurn:{ STUN:52, SLEEP:44, PETRIFY:30, TIMESTOP:58, PARALYZE:30 },
    silencePerTurn:30,
    confusePerTurn:26,
    accPerPoint:1.1,    // 命中率±1%を1ターン
    critPerPoint:1.0,
    counterPerTurn:40,  // 受けた分の何倍を返すか × これ
    piercePerTurn:38,
    negatePerTurn:48,
    endurePerTurn:18,
    healBlockPerTurn:16,
    extraPerTurn:46,    // 行動後にもう一撃
    instant:{ TIMESKIP:30, INVERT:26 },   // その場で起きるもの（1段につき）
    enemyMult:1.0,      // 相手に付けるとき
    selfMult:0.95,      // 自分に付けるとき（受け身なぶん僅かに軽い）
    maxDuration:8       // これ以上長くても価値は頭打ちにする（永続の暴走を防ぐ）
  },

  /* ---- 使用回数の制限と自傷は価値を割り引く ---- */
  discount:{
    oncePerBattle:0.80,
    usesBase:0.62, usesPer:0.10,   // uses:n → usesBase + usesPer*n（上限1）
    selfHpPerPercent:1.6,          // 自分の最大HPの1%を失うごとに差し引く
    spGainPerPoint:17              // SP1回復ぶん（1手つかうので、許容量のSP単価より安く見る）
  },

  /* ---- キャラクター側の規定 ---- */
  chara:{
    statBudget:480,     // 通常形態に配れる合計（BALANCE.build.budget と揃える）
    awakenBonus:150,
    maxSkills:4
  },

  /* =====================================================================
     技の価値を出す。戻り値 {total, parts:[{label,points}]}
     ===================================================================== */
  valueOf(skill){
    const s=skill||{}, parts=[];
    const add=(label,points)=>{ if(points) parts.push({label,points:Math.round(points*10)/10}); };

    /* --- 攻撃 --- */
    const hits=Math.max(1,s.hits||1);
    const acc=Math.min(100,Math.max(0,s.accuracy==null?100:s.accuracy))/100;
    let dmg=this.hitDamage(s)*hits*acc*this.atk.perPower;
    if(dmg>0){
      if(s.guardBreak) dmg*=this.atk.guardBreak;
      if(s.buffPierce) dmg*=this.atk.buffPierce;
      if(s.defPierce) dmg*=1+this.atk.defPierceMax*Math.min(1,s.defPierce);
      if(hits>1) dmg*=1+this.atk.multiHitBonus*(hits-1);
      add("攻撃",dmg);
    }
    // 後手に回る（負の先制）ぶんを値引きとして認めると、そこが抜け道になる
    const 先制=Math.max(0,Number(s.priority)||0);
    if(先制) add("先制",this.atk.perPriority*先制);
    const crit=(s.critRate||0)-(BALANCE.baseCritRate||0.05);
    if(crit>0) add("会心",crit*this.hitDamage(s)*hits*((BALANCE.critMultiplier||1.5)-1)*this.atk.critPerPoint);

    /* --- その場の回復・解除・SP --- */
    if(s.healPercent) add("回復",this.refHp*(Math.abs(Number(s.healPercent)||0)/100)*this.eff.healFactor);
    if(s.cleanse) add("解除",30);

    /* --- 付与する効果 --- */
    (s.effects||[]).forEach(e=>{
      const v=this.effectValue(e);
      if(v) add(e.name||e.kind||"効果",v);
    });

    // ここまでの部品は、どれも 0 以上でなければならない（値引きは下の2つだけ）
    let total=parts.reduce((a,p)=>a+Math.max(0,p.points),0);

    /* --- 割り引き --- */
    if(s.selfHpCost){
      const pct=(Number(s.selfHpCost.maxPercent)||Number(s.selfHpCost.percent)||0);
      if(pct) add("自傷",-pct*this.discount.selfHpPerPercent), total-=pct*this.discount.selfHpPerPercent;
    }
    let mult=1;
    if(s.oncePerBattle) mult*=this.discount.oncePerBattle;
    if(s.uses) mult*=Math.min(1,this.discount.usesBase+this.discount.usesPer*s.uses);
    if(mult!==1){
      const before=total; total*=mult;
      parts.push({label:"回数制限",points:Math.round((total-before)*10)/10});
    }
    return {total:Math.max(0,Math.round(total*10)/10), parts};
  },

  /* 1発ぶんの実ダメージの目安。エンジンの式に合わせる。 */
  hitDamage(s){
    const R=this.ref, power=Math.max(0,s.power||0);
    let d;
    switch(s.formula||"standard"){
      case "fixed":          d=power; break;
      case "ignoreDef":      d=R.atk+power; break;
      case "maxHpRatio":     d=this.refHp*power/100; break;
      case "currentHpRatio": d=this.refHp*power/100*this.atk.currentHpShare; break;
      case "spdBased":       d=R.spd+power-R.def; break;
      default:               d=R.atk+power-R.def;
    }
    // 攻撃を伴わない技（防御・補助）は 0 とみなす
    if(s.type==="DEFENSE"||s.type==="SUPPORT"){ if(!s.power) return 0; }
    return Math.max(0,d);
  },

  /* 効果ひとつぶんの価値 */
  effectValue(e){
    if(!e||!e.kind) return 0;
    const E=this.eff;
    const dur=Math.min(E.maxDuration,Math.max(1,Number(e.duration)||1));
    const chance=(e.chance==null)?1:Math.min(1,Math.max(0,e.chance));
    const side=(e.target==="self")?E.selfMult:E.enemyMult;
    // 大きさは絶対値で見る。「-200%の毒」は毒として重いのであって、値引きではない。
    const amount=()=> Math.abs(e.percent?this.refHp*(e.percent/100):(Number(e.value)||0));
    let v=0;
    switch(e.kind){
      case "DOT":       v=amount()*dur*E.dotFactor; break;
      case "REGEN":     v=amount()*dur*E.regenFactor; break;
      case "SHIELD":    v=amount()*E.shieldFactor; break;
      case "STAT":      v=Math.abs((Number(e.mult)||1)-1)*E.statPerTurn*dur; break;
      case "STUN": case "SLEEP": case "PETRIFY": case "TIMESTOP": case "PARALYZE":
                        v=(E.holdPerTurn[e.kind]||40)*dur*chance; break;
      case "SILENCE":   v=E.silencePerTurn*dur; break;
      case "CONFUSE":   v=E.confusePerTurn*dur*Math.abs((Number(e.value)||35)/35); break;
      case "ACC":       v=Math.abs(Number(e.value)||0)*E.accPerPoint*Math.min(dur,4); break;
      case "CRIT":      v=Math.abs(Number(e.value)||0)*E.critPerPoint*dur; break;
      case "COUNTER":   v=Math.abs(Number(e.ratio)||0.5)*E.counterPerTurn*dur*2; break;
      case "PIERCE":    v=E.piercePerTurn*dur; break;
      case "NEGATE":    v=E.negatePerTurn*dur; break;
      case "ENDURE":    v=E.endurePerTurn*dur; break;
      case "HEALBLOCK": v=E.healBlockPerTurn*dur; break;
      case "EXTRA":     v=E.extraPerTurn*dur; break;
      case "SP":        v=Math.abs(Number(e.value)||0)*this.discount.spGainPerPoint; break;
      case "TIMESKIP":  v=E.instant.TIMESKIP*Math.abs(Number(e.value)||1); break;
      case "INVERT":    v=E.instant.INVERT; break;
      default:          v=0;
    }
    /* 負の値を入れて点数を削り、強い技を規定内に見せかける抜け道を塞ぐ。
       符号は効果の向き（上げるか下げるか）を表すものであって、値引きではない。
       よってどの効果も、価値としては 0 を下回らせない。 */
    return Math.max(0, v*side);
  },

  /* 許容量。awakened=true なら覚醒形態として甘くする */
  allowanceFor(skill,awakened){
    const cost=Math.max(0,Number(skill&&skill.cost)||0);
    const A=this.allow;
    const 満額=Math.min(cost,A.kneeAt), 逓減=Math.max(0,cost-A.kneeAt);
    let a=A.base+A.perSP*満額+A.perSP*A.kneeRate*逓減;
    if(awakened) a*=this.allow.awakenMult;
    return Math.round(a*10)/10;
  },

  /* 技ひとつの判定 */
  checkSkill(skill,awakened){
    const v=this.valueOf(skill);
    const a=this.allowanceFor(skill,awakened);
    const 比=a?v.total/a:0;
    const ok=v.total<=a*(1+this.allow.tolerance);
    return {ok, value:v.total, allowance:a, ratio:Math.round(比*100)/100,
            over:Math.max(0,Math.round((v.total-a)*10)/10), parts:v.parts};
  },

  /* 能力値が予算に収まっているか */
  statPoints(stats){
    const b=(typeof BALANCE!=="undefined"&&BALANCE.build)||{hpPerPoint:10};
    return Math.round((stats.hp||0)/(b.hpPerPoint||10)+(stats.atk||0)+(stats.def||0)+(stats.spd||0));
  },

  /* キャラクターまるごとの判定。戻り値 {ok, issues:[{where,text}], skills:[...]} */
  checkCharacter(char,skillTable){
    const SK=skillTable||(typeof SKILLS!=="undefined"?SKILLS:{});
    const issues=[], rows=[];
    if(!char) return {ok:false,issues:[{where:"キャラクター",text:"中身がありません。"}],skills:[]};

    const b=(typeof BALANCE!=="undefined"&&BALANCE.build)||{};
    const 予算=b.budget||this.chara.statBudget;
    const 使用=this.statPoints(char.stats||{});
    if(使用>予算) issues.push({where:"能力",text:`配分が ${使用-予算} 点ぶん超えています（${使用} / ${予算}）。`});

    const みる=(ids,awakened,ラベル)=>{
      (ids||[]).forEach(id=>{
        const s=SK[id]; if(!s) return;
        const r=this.checkSkill(s,awakened);
        rows.push(Object.assign({id,name:s.name,cost:s.cost||0,awakened},r));
        if(!r.ok) issues.push({where:ラベル,
          text:`「${s.name}」が ${r.over} 点ぶん強すぎます（価値 ${r.value} / SP${s.cost||0}の許容 ${r.allowance}）。`});
      });
    };
    みる(char.skills,false,"技");
    const af=char.awakening&&char.awakening.form;
    if(af) みる(af.skills,true,"覚醒の技");

    if((char.skills||[]).length>this.chara.maxSkills)
      issues.push({where:"技",text:`技は ${this.chara.maxSkills} つまでです。`});

    if(af&&af.stats){
      const 覚醒使用=(af.stats.atk||0)+(af.stats.def||0)+(af.stats.spd||0);
      const 通常=(char.stats&&((char.stats.atk||0)+(char.stats.def||0)+(char.stats.spd||0)))||0;
      const 上限=通常+(b.awakenBonus||this.chara.awakenBonus);
      if(覚醒使用>上限) issues.push({where:"覚醒",
        text:`覚醒形態が ${覚醒使用-上限} 点ぶん超えています（${覚醒使用} / ${上限}）。`});
    }
    return {ok:issues.length===0, issues, skills:rows};
  }
};
