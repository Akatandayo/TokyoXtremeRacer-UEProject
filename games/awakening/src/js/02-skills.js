/* =========================================================================
   02. SkillData — 技はすべてデータ。エンジンは技IDを知らない。
   formula: standard / fixed / ignoreDef / maxHpRatio / currentHpRatio / spdBased
   ========================================================================= */
const SKILLS = {
  /* --- 共通 --- */
  basic_attack:{id:"basic_attack",name:"攻撃",type:"ATTACK",power:0,accuracy:95,cost:0,priority:0,
    description:"基本の一撃。コストなしで撃てる。",effects:[]},

  /* --- 剣士 通常形態 --- */
  sw_slash:{id:"sw_slash",name:"斬撃",type:"ATTACK",power:40,accuracy:95,cost:1,priority:0,
    description:"踏み込んで斬る。安定した主力。",effects:[]},
  sw_helm:{id:"sw_helm",name:"兜割り",type:"SPECIAL",power:68,accuracy:85,cost:3,priority:0,
    guardBreak:true,defPierce:0.3,
    description:"防御ごと断ち割る。相手の防御を半ば無視する。",effects:[]},
  sw_read:{id:"sw_read",name:"見切り",type:"DEFENSE",power:0,accuracy:100,cost:2,priority:1,
    description:"構えて相手の一撃を待つ。このターン防御が上がり、殴られると斬り返す。",
    effects:[{target:"self",kind:"STAT",stat:"def",mult:1.5,duration:1,name:"見切り",icon:"◆",tone:"good"},
             {target:"self",kind:"COUNTER",ratio:0.5,duration:1,name:"斬り返し",icon:"↩",tone:"good"}]},
  sw_swift:{id:"sw_swift",name:"疾風突き",type:"ATTACK",power:22,accuracy:100,cost:2,priority:2,
    description:"必ず先に届く刺突。威力は低い。",effects:[]},

  /* --- 剣士 覚醒形態 --- */
  sw_issen:{id:"sw_issen",name:"絶刀・一閃",type:"ATTACK",power:95,accuracy:90,cost:3,priority:0,
    guardBreak:true,critRate:0.15,
    description:"防御を意味のないものにする一閃。",effects:[]},
  sw_rensan:{id:"sw_rensan",name:"連斬",type:"ATTACK",power:30,accuracy:90,cost:4,priority:0,hits:3,
    description:"三連撃。命中判定は一回ずつ行う。",effects:[]},
  sw_stance:{id:"sw_stance",name:"無音の構え",type:"DEFENSE",power:0,accuracy:100,cost:2,priority:3,
    description:"呼吸を消す。受けた攻撃をそのまま返す。",
    effects:[{target:"self",kind:"STAT",stat:"def",mult:1.6,duration:1,name:"無音",icon:"◆",tone:"good"},
             {target:"self",kind:"COUNTER",ratio:1.0,duration:1,name:"返し刃",icon:"↩",tone:"good"}]},
  sw_shuen:{id:"sw_shuen",name:"終焉斬",type:"SPECIAL",power:150,accuracy:85,cost:6,priority:0,
    oncePerBattle:true,guardBreak:true,
    description:"残った力を一太刀に乗せる。戦闘中1回だけ。",effects:[]},

  /* --- 魔法使い 通常形態 --- */
  mg_bolt:{id:"mg_bolt",name:"魔力弾",type:"SPECIAL",power:55,accuracy:95,cost:1,priority:0,
    description:"素早く撃ち出す魔力の弾。",effects:[]},
  mg_flame:{id:"mg_flame",name:"炎撃",type:"SPECIAL",power:68,accuracy:85,cost:3,priority:0,
    description:"当たれば3ターン燃え続ける。",
    effects:[{target:"enemy",kind:"DOT",value:55,duration:3,name:"火傷",icon:"✹",tone:"bad"}]},
  mg_ice:{id:"mg_ice",name:"氷結",type:"SPECIAL",power:25,accuracy:90,cost:2,priority:0,
    description:"相手の速度を奪う。行動順を取り返す一手。",
    effects:[{target:"enemy",kind:"STAT",stat:"spd",mult:0.6,duration:3,name:"凍結",icon:"❄",tone:"bad"}]},
  mg_focus:{id:"mg_focus",name:"魔力集中",type:"SUPPORT",power:0,accuracy:100,cost:1,priority:1,
    description:"2ターン攻撃力が上がり、SPも2回復する。隙は大きい。",
    effects:[{target:"self",kind:"STAT",stat:"atk",mult:1.25,duration:2,name:"集中",icon:"▲",tone:"good"},
             {target:"self",kind:"SP",value:2,name:"魔力回復"}]},

  /* --- 魔法使い 覚醒形態 --- */
  mg_stardust:{id:"mg_stardust",name:"星屑の雨",type:"SPECIAL",power:28,accuracy:90,cost:4,priority:0,hits:4,
    description:"四発の流星。防御されても手数で削る。",effects:[]},
  mg_gravity:{id:"mg_gravity",name:"重力崩壊",type:"SPECIAL",power:30,accuracy:90,cost:4,priority:0,
    formula:"currentHpRatio",guardBreak:true,
    description:"相手の現在HPの30%を直接削る。防御も無視する。",effects:[]},
  mg_barrier:{id:"mg_barrier",name:"魔弾障壁",type:"DEFENSE",power:0,accuracy:100,cost:2,priority:3,
    description:"障壁を張る。このターンの被弾を跳ね返す。",
    effects:[{target:"self",kind:"STAT",stat:"def",mult:2.0,duration:1,name:"障壁",icon:"⛨",tone:"good"},
             {target:"self",kind:"COUNTER",ratio:0.5,duration:1,name:"反射",icon:"↩",tone:"good"}]},
  /* --- 電子 独 通常形態 --- */
  dd_glitch:{id:"dd_glitch",name:"Glitch",type:"ATTACK",power:76,accuracy:95,cost:1,priority:0,
    selfHpCost:{minPercent:1,maxPercent:4,of:"current"},
    description:"自身を代償に捧げ、相手を喰らい尽くす。使用時に自分の現在HPの1〜4%を失う。",effects:[]},
  dd_upset:{id:"dd_upset",name:"{upset}",type:"SUPPORT",power:0,accuracy:100,cost:3,priority:0,
    description:"執念が生み出した【番狂わせ】。3ターンのあいだ、相手の防御・防御バフを無視して攻撃が通る。",
    effects:[{target:"self",kind:"PIERCE",duration:3,name:"{upset}",icon:"➶",tone:"good"}]},
  dd_setup:{id:"dd_setup",name:"SETUP",type:"DEFENSE",power:0,accuracy:100,cost:4,priority:1,
    cleanse:true,healPercent:24,
    description:"自分にかかった効果を良い物も悪い物もすべて解除し、最大HPの24%を回復する。",effects:[]},
  dd_ramune:{id:"dd_ramune",name:"ラムネ",type:"SUPPORT",power:0,accuracy:100,cost:0,priority:0,
    uses:3,healPercent:11,
    description:"彼の大好物。最大HPの11%を回復する。戦闘中3回まで。",effects:[]},

  /* --- 電子 独 覚醒形態 --- */
  dd_jiga:{id:"dd_jiga",name:"自我",type:"ATTACK",power:115,accuracy:85,cost:4,priority:0,
    guardBreak:true,
    description:"幻想郷の名残。防御を貫通する。",effects:[]},
  dd_origin:{id:"dd_origin",name:"オリジンオブエラー",type:"SPECIAL",power:40,accuracy:80,cost:3,priority:0,hits:3,
    description:"三連撃。命中した相手に【欠如】を刻む。以後その相手は命中率が10%下がり、ターン経過では消えない。",
    effects:[{target:"enemy",kind:"ACC",value:-10,duration:99,name:"欠如",icon:"◐",tone:"bad"}]},
  dd_aegis:{id:"dd_aegis",name:"AEGIS",type:"ATTACK",power:-40,accuracy:100,cost:2,priority:3,hits:3,
    description:"神の盾よ、迎撃せよ。このターンの相手の攻撃を無効化し、通常攻撃を3回叩き込む。",
    effects:[{target:"self",kind:"NEGATE",duration:1,name:"AEGIS",icon:"⛉",tone:"good"}]},
  dd_genten:{id:"dd_genten",name:"原点",type:"SPECIAL",power:160,accuracy:75,cost:5,priority:0,
    oncePerBattle:true,guardBreak:true,buffPierce:true,
    description:"彼そのもの。防御もバフも意味をなさない。戦闘中1回だけ。",effects:[]},

  mg_end:{id:"mg_end",name:"終焉の理",type:"SPECIAL",power:140,accuracy:80,cost:6,priority:0,
    oncePerBattle:true,formula:"ignoreDef",
    description:"理を書き換える。防御力を無視。戦闘中1回だけ。",effects:[]}
};


