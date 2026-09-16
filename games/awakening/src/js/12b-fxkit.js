/* =========================================================================
   07e. FxKit — 「技のデータ」から「演出」を導く辞書。
   ここには技のIDも技の名前も一切書かない。type / power / hits / effects /
   guardBreak / formula ... といったデータだけを見て絵と音を決める。
   そうしておけば、利用者が自分で作った技や、知らない状態異常が来ても
   破綻せず、必ず何かしら意味のある絵が出る。
   ========================================================================= */
const FxKit = {
  /* 技の系統ごとの色相。数値なので、そのまま hsl() に差し込める */
  TYPE_HUE:{ATTACK:352, DEFENSE:166, SUPPORT:44, SPECIAL:274},
  TONE_HUE:{good:166, bad:288},

  /* 状態異常の kind を「絵の系統」にまとめる。
     ここに無い kind（＝利用者が足した新しい異常）は sigil に落ちて、
     その異常のアイコンを刻んだ紋が出る。 */
  FAMILY:{
    DOT:"mote", REGEN:"mote",
    STAT:"arrow", ACC:"arrow", SP:"spark", CRIT:"edge", PIERCE:"edge",
    COUNTER:"edge", EXTRA:"edge",
    SHIELD:"ward", NEGATE:"ward", ENDURE:"ward",
    STUN:"lock", SLEEP:"lock", PETRIFY:"lock", TIMESTOP:"lock", TIMESKIP:"lock",
    PARALYZE:"hex", CONFUSE:"hex", SILENCE:"hex", HEALBLOCK:"hex", INVERT:"hex"
  },
  /* 行動を奪う系。かかっているあいだ立ち姿の呼吸を止める */
  HOLD:["STUN","SLEEP","PETRIFY","TIMESTOP"],

  /* 状態異常の色。kind から引き、利用者が選んだ記号がはっきり何かを示しているときは
     そちらを優先する（自作の「氷牙」でも ❄ を選んでいれば青くなる）。 */
  KIND_HUE:{
    DOT:96, REGEN:150, STUN:196, SLEEP:226, PETRIFY:34, TIMESTOP:190, TIMESKIP:190,
    PARALYZE:52, CONFUSE:308, SILENCE:272, HEALBLOCK:330, INVERT:286,
    SHIELD:166, NEGATE:176, ENDURE:44, CRIT:44, PIERCE:16, COUNTER:274, EXTRA:180,
    ACC:262, SP:172
  },
  GLYPH_HUE:{
    "❄":198,"✹":18,"🔥":14,"⚡":52,"☠":96,"☣":104,"☾":226,"✚":150,"⛨":166,"✦":44,
    "◐":262,"⊘":330,"✖":272,"⏳":190,"⏩":190,"◘":34,"✜":44,"➶":16,"↩":274,"⛉":176
  },
  num(v,d){ const n=Number(v); return Number.isFinite(n)?n:d; },
  family(kind){ return this.FAMILY[kind]||"sigil"; },
  /* 効果ひとつぶんの色相 */
  hueOf(e,tone,glyph){
    if(glyph&&this.GLYPH_HUE[glyph]!=null) return this.GLYPH_HUE[glyph];
    if(e&&this.KIND_HUE[e.kind]!=null) return this.KIND_HUE[e.kind];
    return tone==="good"?this.TONE_HUE.good:this.TONE_HUE.bad;
  },
  /* 記号の動き方。何が起きているかを、動きでも言う */
  markMotion(family,tone){
    if(family==="lock") return "still";       // 止まっている
    if(family==="hex") return "orbit";        // 絡みつく
    if(family==="ward") return "shell";       // 包む
    return tone==="good"?"rise":"sink";       // 立ちのぼる／滴る
  },

  /* 状態異常ひとつぶんの絵。tone と icon は効果の定義から来るので、
     自作の異常でも色と字が決まる。 */
  effectFx(e){
    e=e||{};
    const tone=(typeof effTone==="function")?effTone(e):(e.tone||"bad");
    const glyph=(typeof effIcon==="function")?effIcon(e):(e.icon||"◆");
    const family=this.family(e.kind);
    return {
      family, tone, glyph,
      hue:this.hueOf(e,tone,glyph),
      motion:this.markMotion(family,tone),
      name:e.name||"効果"
    };
  },
  /* いま体にかかっているものを「立ち姿の見た目」にまとめる。
     どれか一つを主役（オーラの色と体の扱い）にし、最大3つを記号として体の周りに出す。
     利用者が自分で足した異常でも、kind と記号から必ず何かしらの絵になる。 */
  bodyState(list){
    const es=list||[];
    if(!es.length) return {aura:false,hue:288,held:false,family:"",tone:"bad",marks:[]};
    // 主役の決め方：行動を奪うもの＞絡みつくもの＞継続するもの＞守り＞その他
    const weight=fam=>fam==="lock"?5:fam==="hex"?4:fam==="mote"?3:fam==="ward"?2:1;
    let bad=0, good=0, held=false, lead=null, leadW=-1;
    const marks=[];
    es.forEach(e=>{
      const fx=this.effectFx(e);
      if(this.HOLD.indexOf(e.kind)>=0) held=true;
      if(fx.tone==="good") good++; else bad++;
      const w=weight(fx.family)+(fx.tone==="good"?0:0.5);
      if(w>leadW){ leadW=w; lead=fx; }
      if(marks.length<3) marks.push(fx);
    });
    return {
      aura:true,
      hue:lead?lead.hue:(bad>=good?this.TONE_HUE.bad:this.TONE_HUE.good),
      held, family:lead?lead.family:"sigil", tone:lead?lead.tone:"bad", marks
    };
  },

  /* --- 技ひとつぶんの演出設計図 --------------------------------------------
     skill: エンジンが使ったのと同じ技データ（SP消費で強化された後のものでもよい）
     返り値はすべて「見た目と音の指示」で、ゲームの計算には一切関与しない。 */
  plan(skill){
    const s=skill||{};
    const type=(s.type==="ATTACK"||s.type==="DEFENSE"||s.type==="SUPPORT"||s.type==="SPECIAL")?s.type:"ATTACK";
    const power=Math.max(0,this.num(s.power,0));
    const hits=Math.max(1,Math.min(12,Math.round(this.num(s.hits,1))));
    const acc=this.num(s.accuracy,100);
    const formula=s.formula||"standard";
    const effects=Array.isArray(s.effects)?s.effects:[];
    const damaging=(type==="ATTACK"||type==="SPECIAL");
    const breaker=!!s.guardBreak||this.num(s.defPierce,0)>0||!!s.buffPierce;
    const heal=this.num(s.healPercent,0)>0||!!s.cleanse;
    const drain=this.num(s.drain,0)>0;
    const selfCost=!!s.selfHpCost;
    const ratio=(formula==="maxHpRatio"||formula==="currentHpRatio");
    // 「重い技」の判定は威力そのものではなく、割合技・固定値技も含めて見る
    const heavy=power>=85||ratio||(formula==="fixed"&&power>=120);
    const magic=(type==="SPECIAL"||type==="SUPPORT"||formula==="ignoreDef"||ratio);
    const swift=this.num(s.priority,0)>0||formula==="spdBased";

    let motion, impact, timbre;
    if(!damaging){
      // 殴らない技。相手に向けるものは詠唱、自分に向けるものは構え
      const outward=effects.some(e=>e&&e.target==="enemy");
      motion=(type==="DEFENSE"&&!outward)?"brace":"cast";
      impact=outward?"hex":"aura";
      timbre=(type==="DEFENSE")?"ward":(heal?"bless":"cast");
    }else if(swift){
      motion="dash"; impact="pierce"; timbre="pierce";
    }else if(hits>=3){
      motion="lunge"; impact="wave"; timbre="wave";
    }else if(heavy){
      motion="heavy"; impact=ratio?"crush":"burst"; timbre=ratio?"crush":(magic?"magic":"blunt");
    }else if(magic){
      motion="cast"; impact="burst"; timbre="magic";
    }else{
      motion="lunge"; impact="slash"; timbre="metal";
    }
    if(drain){ impact="drain"; timbre="drain"; }
    // 攻撃でも癒やす技・守る技は、音の性格をそちらに寄せる
    if(damaging&&heal) timbre="bless";
    if(damaging&&type==="DEFENSE") timbre="ward";

    // 色：基本は技の系統。相手に状態異常を乗せる技はその異常の色に寄せる
    let hue=this.TYPE_HUE[type];
    const mark=effects.find(e=>e&&e.target==="enemy")||effects.find(e=>e&&e.name);
    if(mark&&damaging){ const f=this.effectFx(mark); hue=Math.round((hue+f.hue)/2); }
    if(!damaging&&mark) hue=this.effectFx(mark).hue;
    if(heal) hue=150;

    return {
      type, hue, motion, impact, timbre, hits, breaker, drain, heal, selfCost,
      ranged:(motion==="cast"), heavy,
      // 命中率が低い・威力が高い技ほど、振りかぶりを長く取る
      windup:Math.max(0,Math.min(1,(100-acc)/40*0.6+Math.min(1,power/160)*0.6)),
      // 連撃の刻み。手数が多いほど速く刻む
      cadence:hits>=5?90:hits>=3?130:170
    };
  },

  /* ログ行「〜は「技名」を使用した！」から、その技のデータを引き当てる。
     見つからなければ null（演出は通常攻撃として出す）。 */
  skillFromLog(engine,text,fallbackId){
    if(!engine) return null;
    const m=/「(.+?)」/.exec(text||"");
    if(m){
      const name=m[1];
      const ids=Object.keys(engine.SK||{});
      for(let i=0;i<ids.length;i++){ const s=engine.SK[ids[i]]; if(s&&s.name===name) return s; }
    }
    if(fallbackId&&engine.SK&&engine.SK[fallbackId]) return engine.SK[fallbackId];
    return null;
  }
};
