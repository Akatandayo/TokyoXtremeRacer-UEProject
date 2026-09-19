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
  /** HPが一切減らない(ダメージを0にする)。強力なので必ず duration で制限すること */
  'INVULNERABLE',
  /** バフ・デバフを一切受け付けない */
  'IMMUNE',
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
  /**
   * true なら、対象が弱点とする属性でダメージを与える(変幻自在の表現)。
   * element の指定より優先される。
   */
  adaptElement?: boolean;
  /**
   * INVULNERABLE / IMMUNE を「N回行動するまで」で切りたい場合の行動回数。
   * duration(ターン)ではなく自身の行動回数で数えたいスキル用。
   */
  actionDuration?: number;
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
  /**
   * true なら effects の中からランダムに1つだけを適用する。
   * 「4つの能力からランダムに使える」ような技のための仕組み。
   */
  randomEffect?: boolean;
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
  description?: string;
  /**
   * プレイヤーがキャラに設定できる戦術プリセットかどうか。
   * 敵・ボス専用AIは false。省略時は false 扱い(明示的に true を付けたものだけ選択肢に出す)。
   * ID接頭辞での判別はデータ側の命名規約に依存して壊れるため、フラグで持つ。
   */
  playerSelectable?: boolean;
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
  /**
   * true のキャラは「誰か1体」枠のランダム排出プールから除外される。
   * レイド限定・イベント限定など、入手経路を限定したいキャラに付ける。
   * ドロップテーブルやガチャで ID を明示指定した場合は、このフラグに関係なく排出される。
   */
  limited?: boolean;
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
  /**
   * 立ち絵のアセットキー。実ファイルは client/public/portraits/<key>.webp に置く。
   * 未指定のキャラは従来どおり primary/secondary/accent/sigil/pattern から
   * プロシージャルに描画する(画像アセットを持たないキャラも成立させるため)。
   * オフライン単体版では window.__AKATAN_PORTRAITS__[key] に data URL が注入される。
   */
  portrait?: string;
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
  /**
   * @deprecated 旧形式(ステータスへの素の加算)。系統ツリー方式へ移行したので
   * 新規には使わない。既存セーブを壊さないため読み込みだけ残している。
   */
  rebirthPoints?: Partial<Record<StatKey, number>>;
  /** 転生ノードの取得状況。ノードID -> 取得ランク */
  rebirthNodes?: Record<string, number>;
  /** 未使用の転生ポイント */
  rebirthPointsAvailable?: number;
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
  /**
   * 推奨レベル。パーティの平均レベルと比較して表示する。
   * (旧 recommendedPower は「戦力スコア」と誤解され、Lv1でも最終ボスが「十分」と
   *  表示される不具合を生んだため、単位を明示した名前に変更した)
   */
  recommendedLevel?: number;
  /**
   * このステージを開放するために必要なクリア済みステージID。
   * 未クリアの場合、サーバは STAGE_LOCKED を返して挑戦を拒否する。
   * 省略時は最初から開放。
   */
  unlockAfter?: string;
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
 * 転生 (設計書§17〜§20)
 * ------------------------------------------------------------
 * 転生は「長期的な育成」であり、戦闘中の特殊状態である覚醒とは役割を分ける(§20)。
 *
 * 設計上の肝は §19「同じキャラクターでも転生によって異なる方向へ育成できる」こと。
 * これを成立させるため、転生ポイントは以下の制約を持つ系統ツリーへ割り振る:
 *   - 総ポイントが限られているので全系統は取れない
 *   - 上位ノードは「同系統への累計投資」を要求するので、散らすと強い効果に届かない
 * 結果として、同じキャラでも攻撃型 / 速度型 / 耐久型 / 特殊型に分岐する。
 * ========================================================== */

export const REBIRTH_PATHS = ['ATTACK', 'SPEED', 'ENDURANCE', 'SPECIAL'] as const;
export type RebirthPath = (typeof REBIRTH_PATHS)[number];

export type RebirthEffectKind =
  /** 最終ステータスへの加算 */
  | 'STAT_FLAT'
  /** 最終ステータスへの割合加算(%) */
  | 'STAT_PERCENT'
  /** 成長率(1レベルあたりの上昇量)への割合加算(%) */
  | 'GROWTH_PERCENT'
  /** スキル威力への割合加算(%) */
  | 'SKILL_POWER'
  /** 戦闘開始時の行動ゲージ(%) */
  | 'GAUGE_START'
  /** 戦闘開始時の必殺ゲージ(%) */
  | 'ULT_GAUGE_START';

export interface RebirthEffect {
  kind: RebirthEffectKind;
  /** STAT_FLAT / STAT_PERCENT / GROWTH_PERCENT で対象にするステータス */
  stat?: StatKey;
  /** 1ランクあたりの効果量 */
  value: number;
}

export interface RebirthNodeDef {
  id: string;
  name: string;
  description: string;
  path: RebirthPath;
  /** 1ランク取得するのに必要な転生ポイント */
  cost: number;
  /** 取得できる最大ランク */
  maxRank: number;
  /** 1ランクあたりの効果 */
  effects: RebirthEffect[];
  /**
   * 解放条件: 同じ系統へ累計でこのポイント数を投資していること。
   * これが §19 のビルド分岐を成立させる仕組み(散らすと上位に届かない)。
   */
  requiresPathPoints?: number;
  /** 解放条件: 転生回数がこの値以上であること */
  requiresRebirth?: number;
}

export interface RebirthConfig {
  /** 転生可能になるレベル(通常は levelCap と同じ) */
  requiredLevel: number;
  /** 1回の転生で得られる転生ポイント */
  pointsPerRebirth: number;
  /** 転生1回ごとに基礎成長率が何%上がるか(設計書§18) */
  growthBonusPercent: number;
  /** 最大転生回数 */
  maxRebirth: number;
  /** 転生に必要な素材 */
  cost?: { materialId: string; count: number }[];
  /** 振り直しに必要な素材。省略時は振り直し不可 */
  resetCost?: { materialId: string; count: number }[];
}

/** 転生画面の表示用(サーバが算出して返す) */
export interface RebirthStatus {
  /** 現在の転生回数 */
  rebirth: number;
  /** 転生できるか */
  canRebirth: boolean;
  /** できない場合の理由(日本語) */
  reason?: string;
  /** 未使用の転生ポイント */
  pointsAvailable: number;
  /** ノードID -> 取得ランク */
  nodes: Record<string, number>;
  /** 系統ごとの累計投資ポイント */
  pathPoints: Record<RebirthPath, number>;
  /** 転生によって上がっている成長率(%) */
  growthBonusPercent: number;
}

/* ============================================================
 * 装備 / ハクスラ (設計書§21〜§23)
 * ------------------------------------------------------------
 * 装備は「ベース + Prefix + Suffix + ランダムオプション + 特殊効果」で生成する。
 * 同じ名前でも性能が違う、を成立させるため、生成結果は必ずサーバで確定し、
 * 生成に使ったシードを保存してリプレイ/検証できるようにする。
 * ========================================================== */

/** ベースアイテム定義 (data/items/bases/*.json) */
export interface ItemBaseDef {
  id: string;
  name: string;
  slot: EquipmentSlot;
  /** 出現しうる最低レアリティ */
  minRarity?: ItemRarity;
  /** このベースが伸ばす主ステータスと、Lv1相当の基準値 */
  mainStat: StatKey;
  mainValue: number;
  /** 敵レベル1あたりの主ステータス上昇量 */
  mainPerLevel?: number;
  /** 出現条件のタグ(ドロップテーブルから参照) */
  tags?: string[];
  description?: string;
}

/** Prefix / Suffix 定義 (data/items/affixes/*.json) */
export interface AffixDef {
  id: string;
  /** 「灼熱の」「〜の守り」など。名前生成に使う */
  name: string;
  kind: 'PREFIX' | 'SUFFIX';
  /** このアフィックスが付きうる最低レアリティ */
  minRarity?: ItemRarity;
  /** 付与するステータスの範囲。生成時にこの範囲から乱数で決まる */
  stats: AffixStatRange[];
  /** 特殊効果(攻撃時に状態異常を付与するなど) */
  special?: ItemSpecialEffect;
  /** 対象スロット。省略時は全スロット */
  slots?: EquipmentSlot[];
}

export interface AffixStatRange {
  stat: StatKey;
  min: number;
  max: number;
  /** true なら「%」として扱う(最終ステータスに対する割合加算) */
  percent?: boolean;
}

/** 装備の特殊効果。戦闘エンジンが解釈する */
export interface ItemSpecialEffect {
  id: string;
  name: string;
  description: string;
  /** 発動タイミング */
  trigger: 'ON_ATTACK' | 'ON_HIT_TAKEN' | 'ON_BATTLE_START' | 'ON_KILL';
  /** 発動確率(%) */
  chance?: number;
  /** 付与する状態異常 */
  status?: StatusType;
  duration?: number;
  potency?: number;
  /** 追加ダメージ倍率(ON_ATTACK 時) */
  bonusDamage?: number;
}

/** 生成された装備インスタンス(DB行に対応) */
export interface EquipmentInstance {
  /** 所持インスタンスID */
  uid: string;
  baseId: string;
  slot: EquipmentSlot;
  rarity: ItemRarity;
  /** 生成時に確定した表示名(例「灼熱の古びた剣・護り」) */
  name: string;
  /** アイテムレベル。ドロップ元ステージの敵レベルで決まる */
  itemLevel: number;
  prefixId?: string;
  suffixId?: string;
  /** 確定済みのステータス(フラット) */
  stats: Partial<Record<StatKey, number>>;
  /** 確定済みのステータス(%) */
  statsPercent?: Partial<Record<StatKey, number>>;
  special?: ItemSpecialEffect;
  /** 強化レベル */
  enhanceLevel?: number;
  /** 生成に使ったシード(再現・検証用) */
  seed?: number;
  /** 装備しているキャラのuid。未装備なら undefined */
  equippedBy?: string;
  /**
   * お気に入り。true の装備は一括売却の対象から必ず外れる。
   * 掘った当たり装備を誤って売らないための保険。
   */
  favorite?: boolean;
  obtainedAt?: string;
}

/* ============================================================
 * ドロップ / 素材 (設計書§24)
 * ========================================================== */

export type DropKind = 'GOLD' | 'EQUIPMENT' | 'MATERIAL' | 'CHARACTER' | 'SUMMON_TICKET';

export interface DropEntry {
  kind: DropKind;
  /**
   * true なら重み抽選の対象外で、そのテーブルが引かれたときに必ずドロップする。
   * 「レイドを倒したら限定キャラが確定で手に入る」のような、運に左右させたくない
   * 報酬に使う。weight は無視される。
   */
  guaranteed?: boolean;
  /** MATERIAL/CHARACTER/SUMMON_TICKET のID */
  id?: string;
  /** 抽選重み(同じテーブル内の相対値) */
  weight: number;
  /** 個数の範囲 */
  min?: number;
  max?: number;
  /** EQUIPMENT: 出現するスロットを限定する */
  slot?: EquipmentSlot;
  /** EQUIPMENT: レアリティの重み。省略時はテーブル既定 */
  rarityWeights?: Partial<Record<ItemRarity, number>>;
}

export interface DropTableDef {
  id: string;
  /** 1回の戦闘で行う抽選回数 */
  rolls: number;
  /** 何も出ない枠を作るための重み */
  nothingWeight?: number;
  entries: DropEntry[];
}

/** 素材定義 (data/items/materials.json) */
export interface MaterialDef {
  id: string;
  name: string;
  rarity: ItemRarity;
  description: string;
  /** 用途の表示用 */
  usage?: string;
  icon?: string;
}

/** プレイヤーの所持素材 */
export interface MaterialStack {
  id: string;
  count: number;
}

/** 1戦闘のドロップ結果(演出に使う) */
export interface DropResult {
  gold: number;
  equipment: EquipmentInstance[];
  materials: MaterialStack[];
  /** 入手したキャラ(重複は変換される) */
  characters: CharacterDropResult[];
  tickets: MaterialStack[];
}

export interface CharacterDropResult {
  defId: string;
  name: string;
  rarity: Rarity;
  /** 既に所持していて変換された場合 true */
  duplicate: boolean;
  /** 重複時に得た素材 */
  converted?: MaterialStack;
  /** 新規入手時の所持インスタンスID */
  uid?: string;
}

/* ============================================================
 * ガチャ / 召喚 (設計書§26〜§27)
 * ------------------------------------------------------------
 * 排出率は data/gacha/*.json で管理する。抽選は必ずサーバ側で行い、
 * クライアントは結果を受け取って演出するだけ(設計書§37)。
 * ========================================================== */

export interface GachaRates {
  /** レアリティ -> 排出率(%)。合計100になること */
  rarity: Partial<Record<Rarity, number>>;
}

export interface GachaPity {
  /** この回数ハズレ続けたら確定させる */
  count: number;
  /** 確定させるレアリティ */
  rarity: Rarity;
}

export interface GachaBannerDef {
  id: string;
  name: string;
  description: string;
  /** 召喚1回のコスト */
  cost: { currency: 'GOLD' | 'TICKET'; amount: number; ticketId?: string };
  /** 10連の割引コスト。省略時は単発x10 */
  cost10?: { currency: 'GOLD' | 'TICKET'; amount: number; ticketId?: string };
  rates: GachaRates;
  /** 排出対象のキャラID。省略時は全キャラから該当レアリティを抽選 */
  pool?: string[];
  /** ピックアップ(同レアリティ内での優遇率%) */
  pickup?: { defId: string; rate: number }[];
  /** 天井 */
  pity?: GachaPity;
  /** 10連時の最低保証 */
  guarantee10?: Rarity;
  /** 装備を排出するバナーの場合 */
  equipment?: { dropTable: string; itemLevel: number };
  art?: { primary: string; accent: string };
}

/**
 * ガチャチケットの交換レート(設計書§37: サーバ権威)。
 * ------------------------------------------------------------
 * 「常設ピックアップのチケットを、より貴重な限定ピックアップのチケットへ
 * 一定レートで交換する」ための定義。data/gacha-exchange/*.json で管理する。
 * `fromTicketId` 側が消費され、`toTicketId` 側が付与される片方向のみの交換
 * (逆方向 = 限定→通常 は意図的に作らない。バリデータが toTicketId のレアリティが
 * fromTicketId 以上であることを強制する)。
 */
export interface GachaTicketExchangeDef {
  id: string;
  /** 消費するチケットの素材ID(data/items/materials.json) */
  fromTicketId: string;
  /** 得られるチケットの素材ID */
  toTicketId: string;
  /** 交換1回あたりに必要な fromTicketId の枚数 */
  fromCount: number;
  /** 交換1回あたりに得られる toTicketId の枚数 */
  toCount: number;
  description?: string;
}

/** 召喚1回の結果 */
export interface GachaPullResult {
  /** キャラ召喚の結果 */
  character?: CharacterDropResult;
  /** 装備召喚の結果 */
  equipment?: EquipmentInstance;
  /** この排出が天井によるものか */
  byPity?: boolean;
  /** 演出用: レアリティ */
  rarity: Rarity | ItemRarity;
}

/* ============================================================
 * キャラクターコンボ (設計書§13〜§15)
 * ------------------------------------------------------------
 * 本作の看板システム。「誰と組ませるか」を性能に反映させるための仕組み。
 * data/combos/*.json で定義し、コードを書き換えずにコンボを追加できる。
 * ========================================================== */

export const COMBO_KINDS = ['PAIR', 'TRIO', 'PARTY', 'TAG'] as const;
export type ComboKind = (typeof COMBO_KINDS)[number];

export type ComboTriggerType =
  /** 指定キャラが指定スキル(またはタグを持つスキル)を使用した直後 */
  | 'ON_SKILL_USE'
  /** 戦闘開始時に1度だけ(常時パッシブ的な効果に使う) */
  | 'ON_BATTLE_START'
  /** 参加キャラのHPが閾値以下になった時 */
  | 'ON_HP_BELOW'
  /** 味方が撃破された時 */
  | 'ON_ALLY_DEFEATED';

export interface ComboTrigger {
  type: ComboTriggerType;
  /** ON_SKILL_USE: 発動の起点になるキャラのdefId。省略時は members のいずれか */
  actor?: string;
  /** ON_SKILL_USE: このスキルIDで発動 */
  skill?: string;
  /** ON_SKILL_USE: このタグを持つスキルで発動(skill と併用可、どちらか一致で成立) */
  skillTag?: string;
  /** ON_HP_BELOW: 閾値(%) */
  hpBelow?: number;
  /** 再発動までの待機(発動キャラの行動回数基準)。省略時0 */
  cooldown?: number;
  /** 1戦闘での最大発動回数。省略時は無制限 */
  maxPerBattle?: number;
}

export interface ComboEffect {
  /**
   * この効果を実行するキャラのdefId。省略時は「起点キャラ以外の参加キャラ」。
   * 例: 独がglitchを使ったら紅葉が追撃する場合、performer は momiji。
   */
  performer?: string;
  /** 追撃として発動するスキルID(performer のステータスで計算される) */
  skill?: string;
  /** スキルを介さない直接効果(バフ付与など) */
  effect?: SkillEffect;
}

export interface ComboDef {
  id: string;
  name: string;
  kind: ComboKind;
  description: string;
  /** PAIR=2体 / TRIO=3体 の参加キャラdefId。TAG/PARTY では省略可 */
  members?: string[];
  /** TAG: このタグを持つキャラが count 体以上編成されていれば成立 */
  requireTag?: { tag: string; count: number };
  /** PARTY: パーティ全員がこの属性なら成立 */
  requireAllElement?: Element;
  trigger: ComboTrigger;
  effects: ComboEffect[];
  /** 演出キー */
  fx?: string;
}

/**
 * まだ実装されていないが、コンボ定義から参照されるキャラ。
 * (data/system/planned-characters.json)
 *
 * 「相方が未実装のコンボ」を先に定義できるようにするための仕組み。
 * これが無いと、参照切れ扱いでバリデータが落ちるか、UIがIDを生で出してしまう。
 */
export interface PlannedCharacterDef {
  id: string;
  name: string;
  /** 実装予定であることの補足 */
  note?: string;
}

/** 編成画面で「今この編成で発動するコンボ」を返すための表示用型 */
export interface ActiveCombo {
  def: ComboDef;
  /** 成立に寄与しているキャラのdefId */
  memberDefIds: string[];
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
  /** COMBO イベント: 発動したコンボID */
  comboId?: string;
  /**
   * 複数対象へ同じスキルの同じ効果が連続適用される場合、
   * 2件目以降に true が入る。UIはこれを見てログ行を1行にまとめてよい
   * (「味方全体にシールドが張られた」等)。スナップショットは各件に付く。
   */
  grouped?: boolean;
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
 * レイドバトル (設計書§28〜§29)
 * ------------------------------------------------------------
 * 実装方針: レイドボスは「巨大な共有HPプール」を持ち、1回の挑戦(=通常の戦闘)で
 * 与えたダメージの合計がそのプールから減る。戦闘そのものは既存の runBattle を
 * そのまま使い、戦闘エンジンには一切手を入れない(最速で入れるための判断)。
 * 1回の挑戦では倒しきれない量のHPを持たせることで「何度も挑む」体験を作る。
 * ========================================================== */

/** HP割合をトリガーにしたボスギミック (設計書§29) */
export interface RaidGimmick {
  /** このHP割合(%)以下になったら発動 */
  hpBelow: number;
  name: string;
  description: string;
  /** ボス自身に付与する強化 */
  grant?: { status: StatusType; duration: number; potency?: number }[];
  /** ボスのステータス補正(%) */
  statBonus?: Partial<Record<StatKey, number>>;
  /** このギミック以降に解放されるスキルID */
  unlockSkills?: string[];
  fx?: string;
}

export interface RaidBossDef {
  id: string;
  name: string;
  title?: string;
  /** 戦闘で使う敵定義ID。ステータスはここから引く */
  enemyId: string;
  /** 戦闘時のレベル */
  level: number;
  /** レイド全体の共有HP。1回の挑戦では削りきれない量にする */
  totalHp: number;
  description: string;
  /** HP閾値ごとのギミック。hpBelow の降順で評価する */
  gimmicks?: RaidGimmick[];
  /** 弱点・無効 (設計書§29) */
  weakElements?: Element[];
  immuneStatuses?: StatusType[];
  /**
   * 撃破後にHPがリセットされ、何度でも再挑戦できるか。
   * false にすると一度倒したら二度と挑めなくなる(コンテンツが死ぬ)ので、
   * 省略時は true として扱う。
   */
  repeatable?: boolean;
  /** 撃破報酬のドロップテーブルID */
  dropTable?: string;
  /** 挑戦1回ごとの参加報酬テーブルID */
  attemptDropTable?: string;
  art?: CharacterArt;
}

/** プレイヤーごとのレイド進行状況 */
export interface RaidState {
  bossId: string;
  /** 残りHP */
  remainingHp: number;
  totalHp: number;
  /** 挑戦回数 */
  attempts: number;
  /** 累計与ダメージ */
  totalDamage: number;
  /**
   * 撃破済みか。repeatable なボスでは撃破のたびにHPがリセットされるため、
   * ここは常に false のままになる(「もう挑めない」状態を表すフラグ)。
   */
  defeated: boolean;
  /** 討伐回数 */
  clears: number;
  /** 発動済みギミック名 */
  triggeredGimmicks: string[];
  updatedAt?: string;
}

/** 1回の挑戦の結果 */
export interface RaidAttemptResult {
  /** この挑戦で与えたダメージ */
  damage: number;
  /** 削る前の残りHP */
  hpBefore: number;
  /** 削った後の残りHP */
  hpAfter: number;
  /** この挑戦で撃破したか */
  defeated: boolean;
  /** 撃破後の累計討伐回数 */
  clears?: number;
  /** 撃破してHPがリセットされたか(周回可能なボス) */
  reset?: boolean;
  /** この挑戦で新たに発動したギミック */
  newGimmicks: RaidGimmick[];
  /** MVP(最大ダメージを出した味方) */
  mvp?: { id: string; name: string; damage: number };
}

/* ============================================================
 * 音声 (BGM / 効果音)
 * ------------------------------------------------------------
 * どのシーンでどの音を鳴らすかを data/system/audio.json で管理する。
 * 音源ファイルを差し替えるときにコードを触らなくて済むようにするため。
 * ========================================================== */

export type AudioScene =
  | 'HOME' | 'CHARACTERS' | 'PARTY' | 'DUNGEON' | 'BATTLE' | 'RAID'
  | 'GACHA' | 'EQUIPMENT' | 'REBIRTH' | 'COLLECTION' | 'RESULT';

export type SfxKey =
  | 'HIT' | 'DAMAGE' | 'CRITICAL' | 'SKILL' | 'ULTIMATE' | 'AWAKEN' | 'COMBO'
  | 'DEFEAT' | 'HEAL' | 'VICTORY' | 'LOSE' | 'GACHA_PULL' | 'GACHA_RARE'
  | 'LEVEL_UP' | 'REBIRTH' | 'CLICK' | 'DROP';

export interface AudioTrack {
  /** client/public/audio/<file> */
  file: string;
  /** 音量 0.0〜1.0 */
  volume?: number;
  loop?: boolean;
}

export interface AudioConfig {
  /** シーン -> BGM。未定義のシーンは直前のBGMを鳴らし続ける */
  bgm: Partial<Record<AudioScene, AudioTrack>>;
  /** 効果音 */
  sfx: Partial<Record<SfxKey, AudioTrack>>;
  /**
   * スキルID -> 専用の効果音。ここに定義があるスキルは、汎用の SKILL / ULTIMATE
   * より優先してこの音が鳴る。特定の技に固有のボイスや効果音を当てるための仕組み。
   */
  skillSfx?: Record<string, AudioTrack>;
  /** 既定音量 */
  defaults?: { bgm: number; sfx: number };
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
