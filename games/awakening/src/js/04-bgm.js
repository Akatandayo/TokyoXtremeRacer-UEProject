/* =========================================================================
   02c. BGM — キャラクターごとの対戦曲。音声ファイルを持たずその場で鳴らす。
   ========================================================================= */
const BGM = {
  none:   {name:"なし"},
  tension:{name:"静かな緊張", bpm:84,  root:45, scale:[0,2,3,5,7,8,10], prog:[0,5,3,4], wave:"triangle", hat:false, padGain:.05},
  rush:   {name:"疾走",       bpm:152, root:50, scale:[0,2,3,5,7,8,10], prog:[0,3,5,4], wave:"sawtooth", hat:true,  padGain:.035},
  grand:  {name:"荘厳",       bpm:72,  root:43, scale:[0,2,4,5,7,9,11], prog:[0,4,5,3], wave:"triangle", hat:false, padGain:.07},
  chaos:  {name:"狂騒",       bpm:138, root:46, scale:[0,1,3,6,7,8,11], prog:[0,6,1,5], wave:"square",   hat:true,  padGain:.03},
  sorrow: {name:"哀愁",       bpm:64,  root:48, scale:[0,2,3,5,7,8,10], prog:[0,5,6,4], wave:"sine",     hat:false, padGain:.06},
  resolve:{name:"決意",       bpm:104, root:47, scale:[0,2,3,5,7,9,10], prog:[0,4,2,5], wave:"triangle", hat:true,  padGain:.05}
};

