/**
 * 戦術AI: スキル選択とターゲット選択
 * ------------------------------------------------------------
 * プレイヤーは戦闘中に操作しない。だから「AIが納得のいく判断をする」ことがゲーム性そのもの。
 *
 * 選択アルゴリズム:
 *   1. AiProfile.rules を priority の **昇順** に評価する (小さいほど優先)。
 *      同 priority はデータ上の記述順を保つ (安定ソート)。
 *   2. 条件を満たす & そのスキルが今使える (CD/必殺ゲージ/沈黙/対象存在) 最初のルールを採用。
 *   3. どのルールも通らなければ通常攻撃にフォールバック。
 *      -> 「何もしない」は絶対に返さない。空振りターンが続くと戦闘が終わらなくなるため。
 */
import type { AiProfile, AiRule, BattleUnit, Skill, SkillTarget } from '@akatan/shared';
import type { Rng } from './rng.js';
import { effectiveStat, hasStatus, isSilenced, tauntingUnits } from './status.js';

/** AI が判断に使う、BattleUnit + 実行時情報 */
export interface AiUnit extends BattleUnit {
  /** 通常攻撃スキルID (覚醒で差し替わることがある) */
  normalAttackId: string;
  /** アクティブスキルID一覧 (覚醒で差し替わることがある) */
  skillIds: string[];
  /** 必殺技スキルID */
  ultimateId?: string;
  aiProfileId: string;
  /** スキルID -> 残りクールダウン (自分の行動回数基準) */
  cooldowns: Map<string, number>;
}

export interface AiDecision<T extends AiUnit> {
  skill: Skill;
  /** スキル本体の既定ターゲット。効果ごとの target 上書きはエンジン側で解決する */
  targets: T[];
  /** 採用されたルール (フォールバック時は undefined) */
  rule?: AiRule;
  /** 通常攻撃フォールバックだったか */
  fallback: boolean;
}

export interface AiDecideInput<T extends AiUnit> {
  actor: T;
  /** actor と同じ側の **生存** ユニット (actor 自身を含む) */
  allies: T[];
  /** 敵側の **生存** ユニット */
  foes: T[];
  skills: Map<string, Skill>;
  profile?: AiProfile;
  /** 現在のターン (ラウンド) 数 */
  turn: number;
  /** 必殺ゲージの最大値 */
  ultMax: number;
  rng: Rng;
}

/** HP割合 (0..100)。maxHp が 0 の異常データでも NaN を返さない */
export function hpRatio(u: BattleUnit): number {
  return u.maxHp > 0 ? (u.hp / u.maxHp) * 100 : 0;
}

/**
 * このユニットが今このスキルを使えるか。
 *  - PASSIVE は能動選択できない
 *  - クールダウン中は不可
 *  - ULTIMATE は必殺ゲージが ultCost (既定 ultMax) 以上必要
 *  - SILENCE 中は NORMAL 以外すべて不可
 */
export function isSkillUsable(actor: AiUnit, skill: Skill, ultMax: number): boolean {
  if (skill.kind === 'PASSIVE') return false;
  if ((actor.cooldowns.get(skill.id) ?? 0) > 0) return false;
  if (isSilenced(actor) && skill.kind !== 'NORMAL') return false;
  if (skill.kind === 'ULTIMATE') {
    const cost = skill.ultCost ?? ultMax;
    if (actor.ultGauge < cost) return false;
  }
  return true;
}

/** そのユニットが所持しているスキルIDか (データ不整合で他人のスキルを撃たせない) */
function ownsSkill(actor: AiUnit, skillId: string): boolean {
  return skillId === actor.normalAttackId
    || skillId === actor.ultimateId
    || actor.skillIds.includes(skillId);
}

/**
 * AI の「狙い方」の傾向。
 * プロファイルが ENEMY_HP_BELOW を条件に持つ = 「削れた敵を仕留めに行く」設計思想なので、
 * 単体攻撃のターゲットも HP割合最低を狙う。そうでなければランダムに散らす。
 * (全AIがトドメ狙いだと集中砲火ゲーになり、全AIがランダムだと詰めが甘くなる)
 */
export function profileTendency(profile?: AiProfile): 'FOCUS_LOWEST' | 'RANDOM' {
  if (!profile) return 'RANDOM';
  return profile.rules.some((r) => r.condition.type === 'ENEMY_HP_BELOW') ? 'FOCUS_LOWEST' : 'RANDOM';
}

/** 条件判定 */
export function evaluateCondition<T extends AiUnit>(
  rule: AiRule,
  input: AiDecideInput<T>,
): boolean {
  const { actor, allies, foes, turn, ultMax } = input;
  const v = rule.condition.value ?? 0;
  switch (rule.condition.type) {
    case 'ALWAYS':
      return true;
    case 'SELF_HP_BELOW':
      return hpRatio(actor) <= v;
    case 'ALLY_HP_BELOW':
      // 自分も「味方」に含む。ヒーラーが自分を見捨てないようにするため。
      return allies.some((a) => hpRatio(a) <= v);
    case 'ENEMY_HP_BELOW':
      return foes.some((e) => hpRatio(e) <= v);
    case 'ENEMY_COUNT_ATLEAST':
      return foes.length >= v;
    case 'ENEMY_HAS_BUFF':
      return foes.some((e) => e.statuses.some((s) => s.duration > 0 && isBuffType(s.type)));
    case 'ALLY_HAS_DEBUFF':
      return allies.some((a) => a.statuses.some((s) => s.duration > 0 && !isBuffType(s.type)));
    case 'ULT_READY':
      return actor.ultGauge >= ultMax;
    case 'TURN_ATLEAST':
      return turn >= v;
    default:
      // 未知の条件タイプは「成立しない」扱い。データ側が先行して新条件を書いても落とさない。
      return false;
  }
}

const BUFF_SET = new Set(['ATK_UP', 'DEF_UP', 'SPD_UP', 'SHIELD', 'REGEN', 'TAUNT']);
function isBuffType(t: string): boolean {
  return BUFF_SET.has(t);
}

/**
 * ターゲット選択。死亡ユニットは常に除外する。
 * 並べ替えの比較は必ず slot -> id で決着させ、同値でも順序が揺れないようにする (決定論)。
 */
export function selectTargets<T extends AiUnit>(
  actor: T,
  target: SkillTarget,
  allies: T[],
  foes: T[],
  rng: Rng,
  tendency: 'FOCUS_LOWEST' | 'RANDOM' = 'RANDOM',
): T[] {
  if (target.side === 'SELF' || target.pattern === 'SELF') {
    return actor.alive ? [actor] : [];
  }
  const pool = (target.side === 'ENEMY' ? foes : allies).filter((u) => u.alive);
  if (pool.length === 0) return [];

  const count = Math.max(1, target.count ?? 1);

  switch (target.pattern) {
    case 'ALL':
      return [...pool].sort(bySlot);

    case 'SINGLE': {
      // 敵単体は TAUNT が最優先。挑発役が複数いれば傾向に従って1体に絞る。
      if (target.side === 'ENEMY') {
        const taunters = tauntingUnits(pool);
        if (taunters.length > 0) return [choose(taunters, rng, tendency)];
      }
      return [choose(pool, rng, target.side === 'ALLY' ? 'FOCUS_LOWEST' : tendency)];
    }

    case 'RANDOM': {
      // 重複しないように取り出す。要求数が母数を超えたら全員。
      const bag = [...pool].sort(bySlot);
      const picked: T[] = [];
      for (let i = 0; i < count && bag.length > 0; i++) {
        const idx = rng.int(0, bag.length - 1);
        picked.push(bag[idx] as T);
        bag.splice(idx, 1);
      }
      return picked;
    }

    case 'LOWEST_HP':
      return [...pool]
        .sort((a, b) => hpRatio(a) - hpRatio(b) || bySlot(a, b))
        .slice(0, count);

    case 'HIGHEST_ATK':
      return [...pool]
        .sort((a, b) => effectiveStat(b, 'attack') - effectiveStat(a, 'attack') || bySlot(a, b))
        .slice(0, count);

    case 'FRONT':
      // 隊列は slot の昇順を前衛とみなす (Phase4 で position が入るまでの暫定)
      return [...pool].sort(bySlot).slice(0, count);

    default:
      return [choose(pool, rng, tendency)];
  }
}

function bySlot(a: AiUnit, b: AiUnit): number {
  return a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** 傾向に応じて1体選ぶ。FOCUS_LOWEST は HP割合最低、RANDOM は一様 */
function choose<T extends AiUnit>(pool: T[], rng: Rng, tendency: 'FOCUS_LOWEST' | 'RANDOM'): T {
  if (tendency === 'FOCUS_LOWEST') {
    return [...pool].sort((a, b) => hpRatio(a) - hpRatio(b) || bySlot(a, b))[0] as T;
  }
  const sorted = [...pool].sort(bySlot);
  return rng.pick(sorted);
}

/**
 * 行動を決定する。必ず何らかの Skill を返す (nullを返さない)。
 */
export function decideAction<T extends AiUnit>(input: AiDecideInput<T>): AiDecision<T> {
  const { actor, allies, foes, skills, profile, ultMax, rng } = input;
  const tendency = profileTendency(profile);

  // priority 昇順。sort は安定なので同priorityは記述順のまま。
  const rules = profile ? [...profile.rules].sort((a, b) => a.priority - b.priority) : [];

  for (const rule of rules) {
    if (!evaluateCondition(rule, input)) continue;

    const skillId = rule.skill === 'NORMAL' ? actor.normalAttackId : rule.skill;
    if (!ownsSkill(actor, skillId)) continue;
    const skill = skills.get(skillId);
    if (!skill) continue;                                  // データ不整合 -> 次のルールへ
    if (!isSkillUsable(actor, skill, ultMax)) continue;    // CD中/ゲージ不足/沈黙 -> 次のルールへ

    const targets = selectTargets(actor, skill.target, allies, foes, rng, tendency);
    if (targets.length === 0) continue;                    // 撃つ相手がいない -> 次のルールへ

    return { skill, targets, rule, fallback: false };
  }

  // フォールバック: 通常攻撃。通常攻撃は CD0 / 沈黙でも撃てる前提。
  const normal = skills.get(actor.normalAttackId);
  if (normal) {
    const targets = selectTargets(actor, normal.target, allies, foes, rng, tendency);
    if (targets.length > 0) return { skill: normal, targets, fallback: true };
    return { skill: normal, targets: [], fallback: true };
  }

  // 通常攻撃すら引けない場合の最終防衛線: 無害な素振りスキルを合成して返す。
  // (ここで例外を投げるとステージ1つのデータ不備で戦闘APIが落ちるため、ログに残して続行する)
  const dummy: Skill = {
    id: '__struggle__',
    name: 'もがく',
    kind: 'NORMAL',
    description: '通常攻撃データが見つからないときの緊急行動',
    cooldown: 0,
    target: { side: 'ENEMY', pattern: 'SINGLE' },
    effects: [{ type: 'DAMAGE', power: 0.5 }],
  };
  const targets = selectTargets(actor, dummy.target, allies, foes, rng, tendency);
  return { skill: dummy, targets, fallback: true };
}

/** テスト/デバッグ用: hasStatus の再エクスポート */
export { hasStatus };
