/* =========================================================================
   03. CharacterData — キャラクター固有データ。エンジンから完全に独立。
   ========================================================================= */
const CHARACTERS = {
  swordsman:{
    id:"swordsman", name:"剣士", portrait:"⚔", bgm:"resolve",
    description:"追い詰められてから本気を出す前衛。",
    stats:{hp:1400,atk:114,def:88,spd:95},
    skills:["sw_slash","sw_helm","sw_read","sw_swift"],
    passives:[],
    awakening:{
      enabled:true, name:"剣聖・開眼", conditionMode:"ANY",
      conditions:[
        {type:"HP_BELOW",value:0.45,label:"HPが45%以下になる"},
        {type:"DAMAGE_TAKEN",value:650,label:"累計650ダメージを受ける"}
      ],
      form:{
        stats:{atk:180,def:100,spd:130},
        skills:["sw_issen","sw_rensan","sw_stance","sw_shuen"],
        effects:[]
      },
      duration:5, oneTime:true,
      cost:{hpPerTurn:55, label:"5ターン持続／毎ターンHP-55／戦闘中1回だけ"},
      afterEffects:[{kind:"STAT",stat:"atk",mult:0.7,duration:3,name:"燃え尽き"}]
    }
  },
  mage:{
    id:"mage", name:"魔法使い", portrait:"✦", bgm:"grand",
    description:"準備を積めば積むほど届く後衛。",
    stats:{hp:1300,atk:138,def:76,spd:105},
    skills:["mg_bolt","mg_flame","mg_ice","mg_focus"],
    passives:[],
    awakening:{
      enabled:true, name:"大魔導・開門", conditionMode:"ANY",
      conditions:[
        {type:"SKILL_USED",skillId:"mg_focus",value:2,label:"「魔力集中」を2回使う"},
        {type:"HP_BELOW",value:0.35,label:"HPが35%以下になる"}
      ],
      form:{
        stats:{atk:215,def:85,spd:120},
        skills:["mg_stardust","mg_gravity","mg_barrier","mg_end"],
        effects:[]
      },
      duration:4, oneTime:true,
      cost:{hpPerTurn:50, label:"4ターン持続／毎ターンHP-50／戦闘中1回だけ"},
      afterEffects:[{kind:"STAT",stat:"spd",mult:0.6,duration:3,name:"反動"}]
    }
  },
  denshi_doku:{
    id:"denshi_doku", name:"電子 独", portrait:"⑂", bgm:"chaos",
    description:"【神の失敗作】自分を削るほど強くなる、番狂わせの専門家。",
    stats:{hp:1250,atk:155,def:85,spd:102},
    skills:["dd_glitch","dd_upset","dd_setup","dd_ramune"],
    passives:[],
    awakening:{
      enabled:true, name:"自我の使者", conditionMode:"ANY",
      conditions:[
        {type:"HP_BELOW",value:0.7,label:"HPが70%以下になる"},
        {type:"SKILL_USED",skillId:"dd_glitch",value:4,label:"「Glitch」を4回使う"}
      ],
      form:{
        stats:{atk:215,def:45,spd:115},
        skills:["dd_jiga","dd_origin","dd_aegis","dd_genten"],
        effects:[]
      },
      duration:3, oneTime:true,
      cost:{hpPercentPerTurn:{minPercent:12,maxPercent:28},
            label:"3ターン持続／毎ターン最大HPの12〜28%を失う／戦闘中1回だけ"},
      afterEffects:[{kind:"STAT",stat:"atk",mult:0.7,duration:3,name:"灼き切れ"}]
    }
  }
};

