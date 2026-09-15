/* =========================================================================
   01. BALANCE — 数値バランスはここに集約する（コード中に直接書かない）
   ========================================================================= */
const BALANCE = {
  defendMultiplier: 0.5,   // 防御時のダメージ倍率
  critMultiplier: 1.5,     // クリティカル倍率
  baseCritRate: 0.05,      // 技側で上書き可能
  accuracyMin: 25,         // 命中率の下限（運ゲー化を防ぐ）
  accuracyMax: 100,        // 命中率の上限
  damageVariance: 0,       // 0 = 乱数なし。0.05 なら ±5%
  minDamage: 1,
  sp: { max: 8, start: 2, regenPerTurn: 2, defendBonus: 1 }, // 技コスト用のリソース
  build: {                 // キャラクター作成時のポイント配分
    budget:480,            // 通常形態に使える合計ポイント
    hpPerPoint:10,         // HP10ごとに1ポイント
    minHp:400, minStat:30,
    awakenBonus:150        // 覚醒形態はATK+DEF+SPDの合計にこれだけ上乗せできる
  },
  ruleset: "competitive",  // 将来 "casual" を追加できるよう保持
  permanentDuration: 99    // これ以上の持続ターンは「永続」として扱う
};

