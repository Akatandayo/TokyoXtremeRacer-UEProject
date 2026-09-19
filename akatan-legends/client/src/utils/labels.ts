/** 日本語ラベル / 表示用ヘルパー */
import type {
  Element, Role, Rarity, StatusType, StatKey, AwakeningCondition,
  SkillKind, TargetPattern, TargetSide, Stats, ComboKind, ItemRarity, EquipmentSlot,
} from '@akatan/shared';

export const ELEMENT_LABEL: Record<Element, string> = {
  FIRE: '炎', WATER: '水', EARTH: '地', WIND: '風',
  LIGHT: '光', DARK: '闇', VOID: '虚',
};

export const ELEMENT_ICON: Record<Element, string> = {
  FIRE: '火', WATER: '水', EARTH: '地', WIND: '風',
  LIGHT: '光', DARK: '闇', VOID: '虚',
};

export const ROLE_LABEL: Record<Role, string> = {
  TANK: '盾', ATTACKER: '攻', SUPPORT: '補', HEALER: '癒', CONTROL: '妨', SPECIALIST: '特',
};

export const ROLE_FULL: Record<Role, string> = {
  TANK: 'タンク', ATTACKER: 'アタッカー', SUPPORT: 'サポート',
  HEALER: 'ヒーラー', CONTROL: 'コントロール', SPECIALIST: 'スペシャリスト',
};

export const RARITY_ORDER: Record<Rarity, number> = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 };

/* ---------- 装備レアリティ (ItemRarity) ---------- */

export const ITEM_RARITY_ORDER: Record<ItemRarity, number> = {
  COMMON: 0, UNCOMMON: 1, RARE: 2, EPIC: 3, LEGENDARY: 4, MYTHIC: 5,
};

export const ITEM_RARITY_LABEL: Record<ItemRarity, string> = {
  COMMON: 'コモン', UNCOMMON: 'アンコモン', RARE: 'レア',
  EPIC: 'エピック', LEGENDARY: 'レジェンダリー', MYTHIC: 'ミシック',
};

export const EQUIPMENT_SLOT_LABEL: Record<EquipmentSlot, string> = {
  WEAPON: '武器', ARMOR: '防具', ACCESSORY: '装飾品',
};

export const EQUIPMENT_SLOT_ICON: Record<EquipmentSlot, string> = {
  WEAPON: '剣', ARMOR: '鎧', ACCESSORY: '珠',
};

/**
 * ガチャ演出は `GachaPullResult.rarity: Rarity | ItemRarity` の両方を扱う。
 * どちらの型の値が来てもラベル/色/演出の「格」を安全に引けるようにする。
 */
export function anyRarityLabel(r: Rarity | ItemRarity | string): string {
  if (r in RARITY_ORDER) return r;
  if (r in ITEM_RARITY_LABEL) return ITEM_RARITY_LABEL[r as ItemRarity];
  return String(r);
}

export function anyRarityColorVar(r: Rarity | ItemRarity | string): string {
  if (r in RARITY_ORDER) return `var(--rar-${r})`;
  if (r in ITEM_RARITY_LABEL) return `var(--irar-${r})`;
  return 'var(--muted)';
}

/** 演出の「格」を 0(地味)〜4(最大級)の5段階に正規化する */
export function anyRarityTier(r: Rarity | ItemRarity | string): 0 | 1 | 2 | 3 | 4 {
  if (r in RARITY_ORDER) return RARITY_ORDER[r as Rarity] as 0 | 1 | 2 | 3 | 4;
  if (r in ITEM_RARITY_ORDER) {
    // ItemRarity は6段階なので 0-5 を 0-4 へ圧縮 (EPIC以上をSSR格、MYTHICをUR格に寄せる)
    const t = ITEM_RARITY_ORDER[r as ItemRarity];
    return (t <= 1 ? 0 : t === 2 ? 1 : t === 3 ? 2 : t === 4 ? 3 : 4) as 0 | 1 | 2 | 3 | 4;
  }
  return 0;
}

export const STATUS_LABEL: Record<StatusType, string> = {
  POISON: '毒', BURN: '火傷', FREEZE: '氷結', STUN: '気絶', SILENCE: '沈黙',
  BLEED: '出血', SLOW: '鈍足', DEF_DOWN: '防down', ATK_DOWN: '攻down',
  ATK_UP: '攻UP', DEF_UP: '防UP', SPD_UP: '速UP', SHIELD: '障壁',
  REGEN: '再生', TAUNT: '挑発', INVULNERABLE: '無敵', IMMUNE: '状態異常無効',
};

export const STATUS_ICON: Record<StatusType, string> = {
  POISON: '毒', BURN: '炎', FREEZE: '氷', STUN: '★', SILENCE: '黙',
  BLEED: '血', SLOW: '鈍', DEF_DOWN: '防', ATK_DOWN: '攻',
  ATK_UP: '攻', DEF_UP: '防', SPD_UP: '速', SHIELD: '盾',
  REGEN: '癒', TAUNT: '挑', INVULNERABLE: '無', IMMUNE: '護',
};

export const BUFF_STATUSES: StatusType[] = ['ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT'];

export function isBuff(s: StatusType): boolean {
  return BUFF_STATUSES.includes(s);
}

export const STAT_LABEL: Record<StatKey, string> = {
  hp: 'HP', attack: 'ATK', defense: 'DEF', speed: 'SPD',
  critical: 'CRIT', criticalDamage: 'CRIT倍率', resistance: '耐性', healing: '回復力',
};

export const SKILL_KIND_LABEL: Record<SkillKind, string> = {
  NORMAL: '通常攻撃', ACTIVE: 'スキル', ULTIMATE: '必殺技', PASSIVE: 'パッシブ',
};

export const TARGET_SIDE_LABEL: Record<TargetSide, string> = {
  ENEMY: '敵', ALLY: '味方', SELF: '自分',
};

export const TARGET_PATTERN_LABEL: Record<TargetPattern, string> = {
  SINGLE: '単体', ALL: '全体', RANDOM: 'ランダム', LOWEST_HP: 'HP最少',
  HIGHEST_ATK: '攻撃最高', FRONT: '前衛', SELF: '自身',
};

export function targetText(side: TargetSide, pattern: TargetPattern, count?: number): string {
  const base = `${TARGET_SIDE_LABEL[side]}${TARGET_PATTERN_LABEL[pattern]}`;
  return count && count > 1 ? `${base}×${count}` : base;
}

/** 覚醒条件を日本語文に */
export function awakenConditionText(c: AwakeningCondition): string[] {
  const out: string[] = [];
  if (c.hpBelow !== undefined) out.push(`自身のHPが ${c.hpBelow}% 以下`);
  if (c.skillUsed) out.push(`スキル「${c.skillUsed.skill}」を ${c.skillUsed.count} 回使用`);
  if (c.allyDefeated !== undefined) out.push(`味方が ${c.allyDefeated} 体撃破される`);
  if (c.enemyDefeated !== undefined) out.push(`敵を ${c.enemyDefeated} 体撃破`);
  if (c.turnAtLeast !== undefined) out.push(`${c.turnAtLeast} ターン経過`);
  if (c.withAlly) out.push(`「${c.withAlly}」が編成にいる`);
  if (out.length === 0) out.push('条件未設定');
  return out;
}

/** 戦力値: 編成/推奨戦力の比較に使う簡易指標 */
export function statPower(s: Stats): number {
  return Math.round(
    s.hp * 0.16 +
    s.attack * 2.1 +
    s.defense * 1.5 +
    s.speed * 1.4 +
    s.critical * 3 +
    (s.criticalDamage - 100) * 0.6 +
    s.resistance * 1.2 +
    (s.healing - 100) * 0.5,
  );
}

export function formatNumber(n: number): string {
  return Math.round(n).toLocaleString('ja-JP');
}

export function affinityLabel(affinity?: number): 'weak' | 'resist' | 'normal' {
  if (affinity === undefined) return 'normal';
  if (affinity > 1.01) return 'weak';
  if (affinity < 0.99) return 'resist';
  return 'normal';
}

export function elementVar(e?: Element): string {
  return e ? `var(--el-${e})` : 'var(--cyan)';
}

export const COMBO_KIND_LABEL: Record<ComboKind, string> = {
  PAIR: 'ペアコンボ', TRIO: 'トリオコンボ', PARTY: 'パーティコンボ', TAG: 'タイプコンボ',
};

/** 所持キャラ一覧の平均Lv(空編成は0) */
export function averageLevel(list: { owned: { level: number } }[]): number {
  if (list.length === 0) return 0;
  return list.reduce((n, c) => n + c.owned.level, 0) / list.length;
}

export interface Readiness {
  cls: 'power-ok' | 'power-warn' | 'power-bad' | '';
  label: string;
  ratio: number;
}

/**
 * 推奨Lvとパーティ平均Lvを比較する。
 *
 * 「平均Lv」を採用した理由(docs/UI.md にも記載):
 * ステージ推奨は「このくらいのLv帯を想定して調整した」という難易度の目安であり、
 * 5人のうち1人だけ育成が遅れていても(例: サポート/サブ枠)残り4人が十分な
 * 戦力を持っていれば押し切れる場面が多い。**最低Lv**を基準にすると、
 * 育成が均一でない編成(意図的な起用も含む)を過剰に「戦力不足」と表示してしまい、
 * 編成の自由度を狙う設計(§44 レアリティ≠強さ)と食い合わせが悪い。
 * そのため平均Lvを基準に「十分/やや不足/戦力不足」を判定する。
 */
export function levelReadiness(avgLevel: number, recommendedLevel?: number): Readiness {
  if (!recommendedLevel || recommendedLevel <= 0) {
    return { cls: '', label: '', ratio: 1 };
  }
  const ratio = avgLevel / recommendedLevel;
  if (ratio >= 1) return { cls: 'power-ok', label: '十分', ratio };
  if (ratio >= 0.8) return { cls: 'power-warn', label: 'やや不足', ratio };
  return { cls: 'power-bad', label: '戦力不足', ratio };
}
