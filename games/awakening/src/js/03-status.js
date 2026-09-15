/* =========================================================================
   02b. STATUS — 状態異常カタログ。技エディタの選択肢もここから作られる。
   新しい状態異常を足したいときは、この表に1行足すだけでよい。
   ========================================================================= */
const STATUS = {
  poison:   {name:"毒",      icon:"☠", kind:"DOT",      tone:"bad",  percent:7, duration:3, note:"毎ターン最大HPの{percent}%のダメージ"},
  burn:     {name:"火傷",    icon:"✹", kind:"DOT",      tone:"bad",  value:55,  duration:3, note:"毎ターン{value}の固定ダメージ"},
  bleed:    {name:"出血",    icon:"❦", kind:"DOT",      tone:"bad",  percent:4, duration:5, note:"長く続く弱い継続ダメージ"},
  regen:    {name:"再生",    icon:"✚", kind:"REGEN",    tone:"good", percent:7, duration:3, note:"毎ターン最大HPの{percent}%を回復"},
  stun:     {name:"スタン",  icon:"✸", kind:"STUN",     tone:"bad",  duration:1, chance:0.35, note:"そのターン行動できない"},
  freeze:   {name:"氷漬け",  icon:"❄", kind:"STUN",     tone:"bad",  duration:1, chance:0.3,  note:"そのターン行動できない"},
  paralyze: {name:"麻痺",    icon:"⚡", kind:"PARALYZE", tone:"bad",  value:35,  duration:3, note:"毎ターン{value}%の確率で行動できない"},
  silence:  {name:"沈黙",    icon:"✖", kind:"SILENCE",  tone:"bad",  duration:2, note:"技が使えず、攻撃と防御しか選べない"},
  confuse:  {name:"混乱",    icon:"✧", kind:"CONFUSE",  tone:"bad",  value:35,  duration:2, note:"{value}%の確率で自分を殴ってしまう"},
  blind:    {name:"目くらまし",icon:"◐", kind:"ACC",     tone:"bad",  value:-20, duration:3, note:"命中率が{value}%される"},
  curse:    {name:"呪縛",    icon:"⊘", kind:"HEALBLOCK",tone:"bad",  duration:3, note:"回復ができなくなる"},
  shield:   {name:"障壁",    icon:"⛨", kind:"SHIELD",   tone:"good", value:250, duration:3, note:"合計{value}ダメージを肩代わりする"},
  focus:    {name:"研ぎ澄まし",icon:"✦", kind:"CRIT",    tone:"good", value:25,  duration:2, note:"クリティカル率が{value}%上がる"},
  counter:  {name:"反撃",    icon:"↩", kind:"COUNTER",  tone:"good", ratio:0.5, duration:1, note:"受けたダメージの{ratio}倍を返す"},
  pierce:   {name:"貫通",    icon:"➶", kind:"PIERCE",   tone:"good", duration:2, note:"相手の防御と防御バフを無視する"},
  negate:   {name:"無効化",  icon:"⛉", kind:"NEGATE",   tone:"good", duration:1, note:"次に受ける攻撃を丸ごと打ち消す"},
  atkUp:    {name:"攻撃上昇",icon:"▲", kind:"STAT", stat:"atk", tone:"good", mult:1.3, duration:3, note:"攻撃力が{mult}倍"},
  atkDown:  {name:"攻撃低下",icon:"▽", kind:"STAT", stat:"atk", tone:"bad",  mult:0.7, duration:3, note:"攻撃力が{mult}倍"},
  defUp:    {name:"防御上昇",icon:"◆", kind:"STAT", stat:"def", tone:"good", mult:1.4, duration:3, note:"防御力が{mult}倍"},
  defDown:  {name:"防御低下",icon:"◇", kind:"STAT", stat:"def", tone:"bad",  mult:0.65,duration:3, note:"防御力が{mult}倍"},
  spdUp:    {name:"俊敏",    icon:"≫", kind:"STAT", stat:"spd", tone:"good", mult:1.35,duration:3, note:"素早さが{mult}倍"},
  spdDown:  {name:"鈍足",    icon:"≪", kind:"STAT", stat:"spd", tone:"bad",  mult:0.65,duration:3, note:"素早さが{mult}倍"},
  /* --- 時間と重力にまつわる特殊な状態 --- */
  timestop: {name:"時止め",  icon:"⏳", kind:"TIMESTOP",tone:"bad", duration:2, chance:0.3,
             note:"止まっているあいだ、ずっと行動できない"},
  timeskip: {name:"時飛ばし",icon:"⏩", kind:"TIMESKIP",tone:"bad", value:2, duration:0,
             note:"相手の時間を{value}ターン進める。バフは早く切れ、継続ダメージは即座に起きる"},
  haste:    {name:"加速",    icon:"⇉", kind:"EXTRA",   tone:"good",duration:2,
             note:"行動したあとに通常攻撃をもう1回叩き込む"},
  gravity:  {name:"反転重力",icon:"⇅", kind:"INVERT",  tone:"bad", duration:0,
             note:"かかっている能力変化の上下をひっくり返す"},
  sleep:    {name:"眠り",    icon:"☾", kind:"SLEEP",   tone:"bad", duration:3, chance:0.45,
             note:"行動できないが、ダメージを受けると目を覚ます"},
  petrify:  {name:"石化",    icon:"◘", kind:"PETRIFY", tone:"bad", duration:2, chance:0.3,
             note:"行動できないが、受けるダメージが半分になる"},
  endure:   {name:"不屈",    icon:"✜", kind:"ENDURE",  tone:"good",duration:3,
             note:"倒れるはずの一撃を一度だけHP1で耐える"},
  venom:    {name:"猛毒",    icon:"☣", kind:"DOT",     tone:"bad", percent:14, duration:2,
             note:"毎ターン最大HPの{percent}%のダメージ"}
};
/* 付与ではなくその場で起こる効果 */
const INSTANT_KINDS = ["TIMESKIP","INVERT"];
function statusNote(st){
  return String(st.note||"")
    .replace("{percent}",st.percent).replace("{value}",Math.abs(st.value))
    .replace("{mult}",st.mult).replace("{ratio}",st.ratio);
}

