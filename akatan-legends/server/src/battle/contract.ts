/**
 * 戦闘エンジンの公開契約 (FROZEN)
 * ------------------------------------------------------------
 * この署名はバトルエンジン担当 / API担当の双方が依存する境界。
 * 変更する場合は両担当の同意が必要。勝手に変えないこと。
 */
import type {
  AffinityTable, AiProfile, Awakening, BattleLog, CharacterArt, ComboDef, Element,
  ItemSpecialEffect, ProgressionConfig, Rarity, Role, Side, Skill, Stats,
} from '@akatan/shared';

/** エンジンに渡す戦闘参加者。所持キャラ/敵の差をここで吸収する。 */
export interface CombatantInput {
  id: string;
  /**
   * 参考値。**陣営は runBattle(allies, enemies, ...) の配列位置が常に優先**される。
   * (同じ CombatantInput を敵味方入れ替えて使う模擬戦/PvP のため)
   */
  side: Side;
  slot: number;
  name: string;
  defId: string;
  element: Element;
  roles: Role[];
  level: number;
  /** 装備・転生込みで算出済みの最終ステータス */
  stats: Stats;
  normalAttack: string;
  skills: string[];
  ultimate?: string;
  passives?: string[];
  aiProfile: string;
  awakening?: Awakening;
  art?: CharacterArt;
  rarity?: Rarity;
  /**
   * キャラクター定義側のタグ (CharacterDef.tags)。
   * ComboDef の TAG コンボ (requireTag) 判定に使う。
   * 省略時は空配列扱い (= TAG コンボは成立しない)。
   * API層は CharacterDef.tags をそのまま渡すこと。
   */
  tags?: string[];
  /**
   * 装備から解決済みの特殊効果。API層が EquipmentInstance.special を集めて渡す。
   * ステータス(攻撃力・HPなど)への寄与は既に stats に合算済みなので、
   * エンジンはここに渡された特殊効果の「発動」(戦闘中のトリガー処理)だけを担当する。
   * 省略時は特殊効果なしとして動作し、乱数消費も一切増えない(既存の呼び出しを壊さない)。
   */
  specials?: ItemSpecialEffect[];
  /**
   * 転生ノードから解決済みの戦闘補正(設計書§17〜§19)。
   * RebirthEffectKind のうち SKILL_POWER / GAUGE_START / ULT_GAUGE_START の3種に対応する。
   * ステータス(攻撃力・HPなど)への寄与は既に stats に合算済みなので、
   * ここに渡すのはステータスでは表現できない3種類だけ。API層が転生ノードの取得ランクから
   * 事前に集計した最終値を渡すこと(ランク計算はエンジンの責務ではない)。
   * 省略時は補正なしとして動作し、乱数消費も一切増えない(既存の呼び出しを壊さない)。
   */
  rebirthMods?: RebirthCombatMods;
}

/**
 * CombatantInput.rebirthMods の形。
 * 3フィールドとも省略可で、省略したフィールドは「補正なし」を意味する。
 */
export interface RebirthCombatMods {
  /**
   * スキル威力への割合加算(%)。例: 20 なら power が1.2倍になる。
   * 通常攻撃(NORMAL)・アクティブ(ACTIVE)・必殺技(ULTIMATE)の
   * すべてのスキル効果(DAMAGE/HEALの power)に等しく乗る(スキル種別による区別はしない)。
   * キャラクターコンボ(combo.ts)経由でこのユニットが実行する効果にも同様に乗る
   * (実行者=このユニット自身であるapplySkillEffectsの経路をそのまま通るため)。
   * 乗らないもの: 装備の特殊効果(ItemSpecialEffect.bonusDamage)。あれは「スキル威力」ではなく
   * 装備固有の追撃係数なので対象外(specials.ts/engine.tsのON_ATTACK処理を参照)。
   */
  skillPowerPercent?: number;
  /**
   * 戦闘開始時の行動ゲージ(%, 0が既定値=従来通り)。100を渡すと開幕から即座に行動できる。
   * [0, 100] にクランプする。戦闘開始時に1回だけ適用し、以後の行動では再適用しない。
   * 行動順の解決規則(ゲージ超過量 -> 実効speed -> slot -> 陣営 -> id)自体は変えない。
   */
  gaugeStart?: number;
  /**
   * 戦闘開始時の必殺ゲージ(%, 0が既定値=従来通り)。[0, 100] にクランプする
   * (100%を超えて持ち越すことはできない)。戦闘開始時に1回だけ適用する。
   */
  ultGaugeStart?: number;
}

export interface BattleContext {
  skills: Map<string, Skill>;
  aiProfiles: Map<string, AiProfile>;
  affinity: AffinityTable;
  config: ProgressionConfig['battle'];
  /** 再現可能な乱数シード。同じシード+同じ入力 => 同じログ */
  seed: number;
  stageId?: string;
  /**
   * コンボ定義。味方陣営の編成から成立するコンボを判定して発動させる。
   * 省略時はコンボ無しとして動作する(既存の呼び出しを壊さない)。
   */
  combos?: Map<string, ComboDef>;
  /**
   * BattleLog.createdAt に入れる値。
   * エンジン内で Date.now() を呼ぶとログ全体のハッシュ比較ができなくなるため、
   * 時刻の注入は呼び出し側(API層)の責務とする。省略時は空文字。
   */
  now?: string;
}

/**
 * 完全オート戦闘を最後まで実行し、再生可能な BattleLog を返す。
 * 副作用なし・決定論的であること(同じ入力なら必ず同じログ)。
 * rewards は含めない(API層が付与する)。
 */
export type RunBattle = (
  allies: CombatantInput[],
  enemies: CombatantInput[],
  ctx: BattleContext,
) => BattleLog;
