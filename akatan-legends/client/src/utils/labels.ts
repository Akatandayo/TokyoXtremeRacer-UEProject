/** 日本語ラベル / 表示用ヘルパー */
import type {
  Element, Role, Rarity, StatusType, StatKey, AwakeningCondition,
  SkillKind, TargetPattern, TargetSide, Stats,
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

export const STATUS_LABEL: Record<StatusType, string> = {
  POISON: '毒', BURN: '火傷', FREEZE: '氷結', STUN: '気絶', SILENCE: '沈黙',
  BLEED: '出血', SLOW: '鈍足', DEF_DOWN: '防down', ATK_DOWN: '攻down',
  ATK_UP: '攻UP', DEF_UP: '防UP', SPD_UP: '速UP', SHIELD: '障壁',
  REGEN: '再生', TAUNT: '挑発',
};

export const STATUS_ICON: Record<StatusType, string> = {
  POISON: '毒', BURN: '炎', FREEZE: '氷', STUN: '★', SILENCE: '黙',
  BLEED: '血', SLOW: '鈍', DEF_DOWN: '防', ATK_DOWN: '攻',
  ATK_UP: '攻', DEF_UP: '防', SPD_UP: '速', SHIELD: '盾',
  REGEN: '癒', TAUNT: '挑',
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
