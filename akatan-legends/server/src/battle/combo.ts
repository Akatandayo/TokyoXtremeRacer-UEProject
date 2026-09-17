/**
 * キャラクターコンボ (設計書§13〜§15) — 成立判定 + 実行時状態
 * ------------------------------------------------------------
 * 「判定」と「発動」を分けている:
 *   - 判定 (qualifyCombos): 戦闘開始時に1回だけ、味方陣営の編成 (CombatantInput.defId) から
 *     成立するコンボを確定する。以後この結果は変わらない (誰かが戦闘不能になっても
 *     「編成に組んでいた」事実は消えないため、成立/不成立は編成のみで決まる)。
 *   - 発動 (engine.ts 側): 成立済みコンボについて、トリガー条件が来るたびに
 *     cooldown / maxPerBattle を見て実際に効果を出すかどうかを engine.ts が判断する。
 *     ここで持つ ComboRuntime はその「発動可否の状態」だけを保持する。
 *
 * CombatantInput.id はプレイヤーの所持キャラuidなので照合に使えない。
 * 必ず defId (キャラクター定義ID) で照合すること。
 */
import type { ComboDef } from '@akatan/shared';
import type { CombatantInput } from './contract.js';

/** 1戦闘中のコンボの実行時状態 */
export interface ComboRuntime {
  def: ComboDef;
  /** 成立に寄与した defId 一覧 (起点/相方選定の母集団になる) */
  participantDefIds: string[];
  /**
   * cooldown 減算の基準にするユニットの defId 集合。
   * trigger.actor 指定時はそれ1人だけ、省略時は participantDefIds 全員
   * (誰が発動させても「そのコンボ」のクールダウンとして扱う)。
   */
  eligibleActorDefIds: Set<string>;
  /** 残クールダウン (0 = 発動可能)。eligibleActorDefIds に含まれるユニットが行動するたび1減る */
  cooldownRemaining: number;
  /** これまでの発動回数 (maxPerBattle 判定用) */
  timesTriggered: number;
  /**
   * ON_HP_BELOW: 現在「閾値以下」と判定済み(発動済み)のユニットid。
   * 閾値を上回ったら外す = 再度下回ったときにもう一度発動できる (エッジトリガー化)。
   */
  hpBelowArmed: Set<string>;
}

/**
 * 味方陣営の編成 (CombatantInput.defId) からコンボの成立を判定する。
 * 不成立のコンボは結果に含めない (以後の evaluate/trigger 判定コストがゼロになる)。
 */
export function qualifyCombos(
  allies: CombatantInput[],
  combos: Map<string, ComboDef>,
): ComboRuntime[] {
  const allyDefIdSet = new Set(allies.map((c) => c.defId));
  const out: ComboRuntime[] = [];

  for (const def of combos.values()) {
    const participantDefIds = resolveParticipants(def, allies, allyDefIdSet);
    if (!participantDefIds) continue;

    const eligibleActorDefIds = def.trigger.actor
      ? new Set([def.trigger.actor])
      : new Set(participantDefIds);

    out.push({
      def,
      participantDefIds,
      eligibleActorDefIds,
      cooldownRemaining: 0,
      timesTriggered: 0,
      hpBelowArmed: new Set(),
    });
  }
  return out;
}

/**
 * 成立判定本体。
 *   PAIR/TRIO : members 全員が編成にいる (defId 照合)
 *   TAG       : requireTag.tag を持つキャラが requireTag.count 体以上編成にいる
 *   PARTY     : 編成の全員が requireAllElement と同じ属性
 * 成立しなければ undefined、成立すれば「参加キャラの defId 一覧」(重複なし) を返す。
 */
function resolveParticipants(
  def: ComboDef,
  allies: CombatantInput[],
  allyDefIdSet: Set<string>,
): string[] | undefined {
  switch (def.kind) {
    case 'PAIR':
    case 'TRIO': {
      const members = def.members ?? [];
      if (members.length === 0) return undefined;
      if (!members.every((id) => allyDefIdSet.has(id))) return undefined;
      return [...new Set(members)];
    }
    case 'TAG': {
      const req = def.requireTag;
      if (!req) return undefined;
      const matched = allies.filter((c) => (c.tags ?? []).includes(req.tag));
      if (matched.length < req.count) return undefined;
      return [...new Set(matched.map((c) => c.defId))];
    }
    case 'PARTY': {
      const element = def.requireAllElement;
      if (!element || allies.length === 0) return undefined;
      if (!allies.every((c) => c.element === element)) return undefined;
      return [...new Set(allies.map((c) => c.defId))];
    }
    default:
      return undefined;
  }
}
