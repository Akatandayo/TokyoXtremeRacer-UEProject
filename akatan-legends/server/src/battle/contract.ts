/**
 * 戦闘エンジンの公開契約 (FROZEN)
 * ------------------------------------------------------------
 * この署名はバトルエンジン担当 / API担当の双方が依存する境界。
 * 変更する場合は両担当の同意が必要。勝手に変えないこと。
 */
import type {
  AffinityTable, AiProfile, Awakening, BattleLog, CharacterArt, ComboDef, Element,
  ProgressionConfig, Rarity, Role, Side, Skill, Stats,
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
