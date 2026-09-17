/* =========================================================================
   01. BALANCE — 数値バランスはここに集約する（コード中に直接書かない）
   数字を触ったら必ず `node tools/sim.mjs` で前後を比べること。
   ========================================================================= */
const BALANCE = {
  defendMultiplier: 0.5,   // 防御時のダメージ倍率
  critMultiplier: 1.5,     // クリティカル倍率
  baseCritRate: 0.05,      // 技側で上書き可能
  accuracyMin: 25,         // 命中率の下限（運ゲー化を防ぐ）
  accuracyMax: 100,        // 命中率の上限
  damageVariance: 0.06,    // 全ダメージの ±6%。事故は起きるが読みは効く幅
  minDamage: 1,
  sp: { max: 8, start: 2, regenPerTurn: 2, defendBonus: 1 }, // 技コスト用のリソース
  build: {                 // キャラクター作成時のポイント配分
    budget:480,            // 通常形態に使える合計ポイント
    hpPerPoint:10,         // HP10ごとに1ポイント
    minHp:400, minStat:30,
    awakenBonus:150        // 覚醒形態はATK+DEF+SPDの合計にこれだけ上乗せできる
  },
  maxPriority: 3,          // 先制の上限。これ以上を許すと「優先度ゲー」になる
  ruleset: "competitive",  // 将来 "casual" を追加できるよう保持
  permanentDuration: 99,   // これ以上の持続ターンは「永続」として扱う

  /* --- 決着の保証：防御し合って終わらない、を起こさせない --- */
  turnLimit: 30,           // このターンを終えても決着しなければ残りHP割合で判定
  turnLimitWarn: 5,        // 判定の何ターン前から警告を出すか

  /* --- 連戦モード「試練」 --- */
  trial: {
    hpCarryPercent: 100,   // 次の戦闘に持ち越すHPの割合（100=そのまま持ち越し）
    healBetween: 18,       // 1戦ごとに自動で回復する最大HPの割合
    boonChoices: 3,        // 提示される恩恵の数
    growth: {              // 相手は段階ごとにこれだけ強くなる（1段目は等倍）
      hp:0.07, atk:0.05, def:0.05, spd:0.03, max:1.9
    },
    levelSteps: ["easy","easy","normal","normal","hard","hard","ruthless"], // 段階ごとのAI
    maxStage: 99
  }
};
