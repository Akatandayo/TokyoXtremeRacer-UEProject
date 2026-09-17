/**
 * あかたんLegends - 共通ドメイン型
 *
 * 設計方針:
 *  - Phase 1 (MVP) で実際に使う型を確定させつつ、Phase 2 以降(装備/転生/覚醒/コンボ)の
 *    フィールドは optional として先に定義しておき、後から既存コードを壊さず拡張できるようにする。
 *  - 数値バランスは data/*.json 側で管理し、コードにハードコードしない。
 */

/* ============================================================
 * 基本列挙
 * ========================================================== */

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR'] as const;
export type Rarity = (typeof RARITIES)[number];

export const ELEMENTS = ['FIRE', 'WATER', 'EARTH', 'WIND', 'LIGHT', 'DARK', 'VOID'] as const;
export type Element = (typeof ELEMENTS)[number];

export const ROLES = ['TANK', 'ATTACKER', 'SUPPORT', 'HEALER', 'CONTROL', 'SPECIALIST'] as const;
export type Role = (typeof ROLES)[number];

export const STATUS_TYPES = [
  'POISON', 'BURN', 'FREEZE', 'STUN', 'SILENCE', 'BLEED', 'SLOW', 'DEF_DOWN', 'ATK_DOWN',
  'ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT',
] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

/** 行動不能を起こす状態異常 */
export const INCAPACITATING_STATUS: readonly StatusType[] = ['FREEZE', 'STUN'];

export const EQUIPMENT_SLOTS = ['WEAPON', 'ARMOR', 'ACCESSORY'] as const;
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export const ITEM_RARITIES = ['COMMON', 'UNCOMMON', 'RARE', 'EPIC', 'LEGENDARY', 'MYTHIC'] as const;
export type ItemRarity = (typeof ITEM_RARITIES)[number];

/* ============================================================
 * ステータス
 * ========================================================== */

/** 戦闘に使う全ステータス。将来の拡張は optional で足す。 */
export interface Stats {
  hp: number;
  attack: number;
  defense: number;
  speed: number;
  /** クリティカル率(%) */
  critical: number;
  /** クリティカル倍率(%) 150 = 1.5倍 */
  criticalDamage: number;
  /** 状態異常耐性(%) */
  resistance: number;
  /** 回復力(%) 100 = 等倍 */
  healing: number;
}

export type StatKey = keyof Stats;

/** 1レベルごとの成長量 */
export type GrowthRates = Partial<Record<StatKey, number>>;

/* ============================================================
 * スキル
 * ========================================================== */

export type SkillKind = 'NORMAL' | 'ACTIVE' | 'ULTIMATE' | 'PASSIVE';

export type TargetSide = 'ENEMY' | 'ALLY' | 'SELF';
export type TargetPattern =
  | 'SINGLE'        // 単体
  | 'ALL'           // 全体
  | 'RANDOM'        // ランダム
  | 'LOWEST_HP'     // HP割合最低
  | 'HIGHEST_ATK'   // 攻撃力最高
  | 'FRONT'         // 前衛
  | 'SELF';         // 自分

export interface SkillTarget {
  side: TargetSide;
  pattern: TargetPattern;
  /** RANDOM / ALL 以外で複数取る場合の対象数 */
  count?: number;
}

export type SkillEffectType =
  | 'DAMAGE'
  | 'HEAL'
  | 'STATUS'      // 状態異常/バフ付与
  | 'CLEANSE'     // 状態異常解除
  | 'GAUGE'       // 行動ゲージ操作
  | 'ULT_GAUGE';  // 必殺ゲージ操作

export interface SkillEffect {
  type: SkillEffectType;
  /** DAMAGE/HEAL: 攻撃力(または対象最大HP)に対する倍率。1.0 = 等倍 */
  power?: number;
  /** ヒット数。省略時は1。CLEANSE では「解除する状態異常の数」を意味する */
  hits?: number;
  /** 参照ステータス。省略時は attack */
  scaling?: StatKey;
  /** STATUS 用 */
  status?: StatusType;
  duration?: number;
  /**
   * 状態異常の強度。**単位は status の種別ごとに異なる**ので注意:
   *  - POISON/BURN/BLEED/REGEN : 対象の「最大HPに対する%」(装備インフレで腐らないため)
   *  - SHIELD                  : 付与時点の「最大HPに対する%」(内部で残吸収量の絶対値へ変換される)
   *  - ATK_UP/ATK_DOWN/DEF_UP/DEF_DOWN/SPD_UP/SLOW : ステータス補正(%)
   *  - FREEZE/STUN/SILENCE/TAUNT : 未使用
   */
  potency?: number;
  /** 発動確率(%)。省略時は100 */
  chance?: number;
  /** GAUGE/ULT_GAUGE の増減量(%) */
  amount?: number;
  /** この効果だけ別対象を取る場合 */
  target?: SkillTarget;
  /** 属性上書き(省略時は使用者の属性) */
  element?: Element;
}

export interface Skill {
  id: string;
  name: string;
  kind: SkillKind;
  description: string;
  /** 再使用までの待機ターン(そのキャラの行動回数基準)。NORMAL は 0 */
  cooldown: number;
  /** 戦闘開始時の初期クールダウン */
  initialCooldown?: number;
  target: SkillTarget;
  effects: SkillEffect[];
  /** 必殺ゲージ消費(ULTIMATE は通常100) */
  ultCost?: number;
  /** 演出キー: クライアントのエフェクト選択に使う */
  fx?: string;
  /** タグ (コンボ条件などで参照) */
  tags?: string[];
}

/* ============================================================
 * AI
 * ========================================================== */

export type AiActionType = 'ATTACK' | 'DEFEND' | 'SUPPORT' | 'HEAL' | 'CONTROL' | 'ULTIMATE_PRIORITY';

export type AiConditionType =
  | 'ALWAYS'
  | 'ALLY_HP_BELOW'
  | 'SELF_HP_BELOW'
  | 'ENEMY_HP_BELOW'
  | 'ENEMY_COUNT_ATLEAST'
  | 'ENEMY_HAS_BUFF'
  | 'ALLY_HAS_DEBUFF'
  | 'ULT_READY'
  | 'TURN_ATLEAST';

export interface AiCondition {
  type: AiConditionType;
  /** 閾値 (%, 体数, ターン数) */
  value?: number;
}

/** 上から順に評価し、最初に条件を満たしたルールを実行する */
export interface AiRule {
  priority: number;
  condition: AiCondition;
  /** 使用するスキルID。'NORMAL' で通常攻撃 */
  skill: string;
  comment?: string;
}

export interface AiProfile {
  id: string;
  name: string;
  /** プレイヤーが選べる戦術プリセット名 */
  description?: string;
  rules: AiRule[];
}

/* ============================================================
 * キャラクター
 * ========================================================== */

/** 身内TRPG向けメタデータ */
export interface TrpgMeta {
  /** 元作品 / 卓名 */
  source?: string;
  /** PL名 */
  player?: string;
  /** 探索者名(ゲーム内名と異なる場合) */
  investigator?: string;
  affiliation?: string;
  /** 公開範囲 */
  visibility?: 'PUBLIC' | 'FRIENDS' | 'PRIVATE';
  note?: string;
}

export interface AwakeningCondition {
  /** 自身HPがこの割合(%)以下 */
  hpBelow?: number;
  /** 指定スキルを N 回使用 */
  skillUsed?: { skill: string; count: number };
  /** 味方が N 体撃破された */
  allyDefeated?: number;
  /** 敵を N 体撃破(自分のキル数ではなく、相手陣営の累計撃破数) */
  enemyDefeated?: number;
  /**
   * N ターン経過。
   * 1ターン(ラウンド) = 「ラウンド開始時の生存ユニット数ぶんの行動が消化された」時点。
   * 1行動=1ターンではない。AiCondition の TURN_ATLEAST も同じ定義。
   */
  turnAtLeast?: number;
  /** 特定の味方が編成にいる */
  withAlly?: string;
}

export interface Awakening {
  id: string;
  name: string;
  condition: AwakeningCondition;
  /** 覚醒時のステータス補正。**加算値ではなく%(倍率)**。20 = +20% */
  statBonus?: Partial<Record<StatKey, number>>;
  /** スキル置換 { 元ID: 新ID } */
  skillReplace?: Record<string, string>;
  /** 覚醒時に付与する状態 */
  grant?: { status: StatusType; duration: number; potency?: number }[];
  description: string;
  fx?: string;
}

/** マスターデータ(data/characters/*.json) */
export interface CharacterDef {
  id: string;
  name: string;
  /** カナ/英名などの別表記 */
  title?: string;
  rarity: Rarity;
  element: Element;
  roles: Role[];
  baseStats: Stats;
  growth: GrowthRates;
  /** 通常攻撃スキルID */
  normalAttack: string;
  /** アクティブスキルID */
  skills: string[];
  /** 必殺技スキルID */
  ultimate: string;
  /** パッシブスキルID */
  passives?: string[];
  awakening?: Awakening;
  combos?: string[];
  /** 既定AIプロファイルID */
  defaultAi: string;
  description: string;
  tags?: string[];
  trpg?: TrpgMeta;
  /** 見た目: 仮アセット用のカラーテーマと紋章 */
  art?: CharacterArt;
}

/** 仮キャラ用のプロシージャル見た目定義 */
export interface CharacterArt {
  /** 主色 (hex) */
  primary: string;
  /** 副色 (hex) */
  secondary: string;
  /** 発光色 (hex) */
  accent: string;
  /** 紋章シンボル (1文字 or 短い記号) */
  sigil: string;
  /** 背景パターン */
  pattern?: 'grid' | 'wave' | 'burst' | 'circuit' | 'petal' | 'void';
}

/** プレイヤー所持キャラ(DB行に対応) */
export interface OwnedCharacter {
  /** 所持インスタンスID */
  uid: string;
  defId: string;
  level: number;
  exp: number;
  /** 転生回数 */
  rebirth: number;
  /** 転生ポイント割り振り */
  rebirthPoints?: Partial<Record<StatKey, number>>;
  /** 限界突破 */
  limitBreak?: number;
  /** 装備 */
  equipment?: Partial<Record<EquipmentSlot, string>>;
  /** 選択中AIプロファイルID */
  aiProfile?: string;
  obtainedAt?: string;
}

/** キャラ定義 + 所持情報 + 計算済みステータス (APIレスポンス用) */
export interface CharacterView {
  owned: OwnedCharacter;
  def: CharacterDef;
  stats: Stats;
  /** 次のレベルまでに必要なEXP */
  expToNext: number;
  skills: Skill[];
  normalAttack: Skill;
  ultimate: Skill;
}

/* ============================================================
 * 敵
 * ========================================================== */

export interface EnemyDef {
  id: string;
  name: string;
  element: Element;
  roles: Role[];
  /** Lv1 相当のベースステータス */
  baseStats: Stats;
  growth: GrowthRates;
  normalAttack: string;
  skills: string[];
  ultimate?: string;
  defaultAi: string;
  /** ボスフラグ */
  boss?: boolean;
  description?: string;
  art?: CharacterArt;
  tags?: string[];
}

/* ============================================================
 * ダンジョン
 * ========================================================== */

export interface EnemyPlacement {
  enemyId: string;
  level: number;
  /** 隊列(Phase 4)。未指定は自動 */
  position?: number;
}

export interface StageDef {
  id: string;
  name: string;
  /** 推奨戦力 */
  recommendedPower?: number;
  enemies: EnemyPlacement[];
  rewards: StageRewards;
  boss?: boolean;
  description?: string;
}

export interface StageRewards {
  exp: number;
  gold: number;
  /** Phase 3 以降: ドロップテーブルID */
  dropTable?: string;
}

export interface ChapterDef {
  id: string;
  name: string;
  description?: string;
  stages: StageDef[];
}

/* ============================================================
 * 編成
 * ========================================================== */

export const PARTY_SIZE = 5;

export interface Party {
  id: string;
  name: string;
  /** 長さ PARTY_SIZE。空き枠は null */
  members: (string | null)[];
}

/* ============================================================
 * 戦闘
 * ========================================================== */

export type Side = 'ALLY' | 'ENEMY';

export interface ActiveStatus {
  type: StatusType;
  duration: number;
  /** SkillEffect.potency と同じ単位。SHIELD の場合のみ「残り吸収量(絶対値)」 */
  potency: number;
  /** 付与元のユニットID */
  sourceId?: string;
}

/** 戦闘中のユニット(スナップショット) */
export interface BattleUnit {
  id: string;
  side: Side;
  slot: number;
  name: string;
  defId: string;
  element: Element;
  roles: Role[];
  level: number;
  stats: Stats;
  hp: number;
  maxHp: number;
  /** 行動ゲージ 0-100 */
  gauge: number;
  /** 必殺ゲージ 0-100 */
  ultGauge: number;
  statuses: ActiveStatus[];
  alive: boolean;
  awakened: boolean;
  art?: CharacterArt;
  rarity?: Rarity;
}

export type BattleEventType =
  | 'BATTLE_START'
  | 'TURN_START'
  | 'ACTION_START'
  | 'SKILL_USE'
  | 'DAMAGE'
  | 'HEAL'
  | 'STATUS_APPLY'
  | 'STATUS_EXPIRE'
  | 'STATUS_TICK'
  | 'STATUS_RESIST'
  | 'GAUGE_CHANGE'
  | 'ULT_READY'
  | 'AWAKEN'
  | 'COMBO'
  | 'DEFEAT'
  | 'ACTION_END'
  | 'BATTLE_END';

export interface BattleEvent {
  /** イベント通し番号 */
  seq: number;
  /** 経過ティック */
  tick: number;
  type: BattleEventType;
  sourceId?: string;
  targetId?: string;
  skillId?: string;
  skillName?: string;
  value?: number;
  critical?: boolean;
  /** 属性相性 1.0 = 等倍 */
  affinity?: number;
  status?: StatusType;
  duration?: number;
  element?: Element;
  fx?: string;
  text?: string;
  /** イベント適用直後のユニット状態(再生用) */
  snapshot?: BattleUnitSnapshot[];
}

export interface BattleUnitSnapshot {
  id: string;
  hp: number;
  gauge: number;
  ultGauge: number;
  alive: boolean;
  awakened: boolean;
  statuses: ActiveStatus[];
}

export interface BattleResult {
  victory: boolean;
  /** 経過ティック数 */
  ticks: number;
  turns: number;
  /** ユニット別の戦績 */
  stats: BattleUnitStat[];
  rewards?: BattleRewards;
}

export interface BattleUnitStat {
  id: string;
  name: string;
  side: Side;
  damageDealt: number;
  damageTaken: number;
  healing: number;
  kills: number;
  survived: boolean;
}

export interface LevelUpInfo {
  uid: string;
  name: string;
  fromLevel: number;
  toLevel: number;
  expGained: number;
  statGain: Partial<Stats>;
}

export interface BattleRewards {
  exp: number;
  gold: number;
  levelUps: LevelUpInfo[];
}

/** 戦闘ログ(リプレイ用) */
export interface BattleLog {
  id: string;
  seed: number;
  stageId?: string;
  createdAt: string;
  /** 開始時のユニット一覧 */
  units: BattleUnit[];
  events: BattleEvent[];
  result: BattleResult;
}

/* ============================================================
 * プレイヤー
 * ========================================================== */

export interface PlayerProfile {
  id: string;
  name: string;
  gold: number;
  stamina?: number;
  createdAt: string;
  /** クリア済みステージID */
  clearedStages: string[];
}

/* ============================================================
 * システム設定 (data/system/*.json)
 * ========================================================== */

/** attacker element -> defender element -> 倍率 (1.0 = 等倍) */
export type AffinityTable = Partial<Record<Element, Partial<Record<Element, number>>>>;

export interface ProgressionConfig {
  levelCap: number;
  /** Lv n -> n+1 に必要なEXP = round(base * n^exponent) */
  expCurve: { base: number; exponent: number };
  /** 戦闘の基本パラメータ */
  battle: {
    /** 1ティックあたりのゲージ増加 = speed * gaugeRate */
    gaugeRate: number;
    /** 行動に必要なゲージ */
    gaugeMax: number;
    /** 必殺ゲージ: 行動時の増加量 */
    ultGainOnAction: number;
    /** 必殺ゲージ: 被弾時の増加量 */
    ultGainOnHit: number;
    ultMax: number;
    /** ダメージ式の防御係数 */
    defenseConstant: number;
    /** 最大ティック(引き分け判定) */
    maxTicks: number;
    /** ダメージ乱数幅 (0.05 = ±5%) */
    damageVariance: number;
  };
}
