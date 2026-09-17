/**
 * キャラクターコンボ (設計書§13〜§15, §40) の判定ロジック。
 *
 * サーバの戦闘エンジンはコンボの発動自体を判定するが、「今の編成でどのコンボが
 * 成立するか」を見せる編成画面用の判定はクライアント側の責務(表示専用・戦闘結果には
 * 影響しない)。ここで一箇所にまとめ、PARTY / CHARACTER_DETAIL / HOME で共有する。
 *
 * 判定は shared/src/types.ts の ComboDef を厳密に読んで実装する:
 *  - PAIR / TRIO: members の全 defId が編成に含まれるか
 *  - TAG        : requireTag.tag を持つキャラが requireTag.count 体以上
 *  - PARTY      : 編成5人全員が requireAllElement を満たすか
 *
 * キャラの照合は所持キャラの uid ではなく CharacterDef.id (defId) で行う
 * (同じキャラを複数所持していても定義としては同一のため)。
 */
import type { CharacterDef, ComboDef, MasterDataResponse } from '@akatan/shared';

/**
 * `/api/master` の `combos` を取り出す。データ担当の投入がまだ0件でも
 * (`data/combos/` が空、またはサーバ未起動でモック実行中でも) 空配列で安全に動く。
 */
export function combosOf(master: MasterDataResponse | null): ComboDef[] {
  return master?.combos ?? [];
}

export const PARTY_FULL_SIZE = 5;

export type ComboState = 'active' | 'almost';

export interface ComboMatch {
  def: ComboDef;
  state: ComboState;
  /** 成立(または成立に必要な)キャラのdefIdのうち、現在編成に既にいるもの */
  memberDefIds: string[];
  /** state === 'almost' の場合、「あと何が必要か」の日本語説明 */
  missingNote?: string;
}

/**
 * 1件のコンボ定義を、現在の編成(defIdの配列。空き枠は除く)に対して判定する。
 * 成立していない上に「惜しい」とも言えない場合は null を返す。
 */
export function evaluateCombo(
  def: ComboDef,
  partyDefIds: string[],
  charById: Map<string, CharacterDef>,
): ComboMatch | null {
  const filled = partyDefIds.filter((d): d is string => !!d);

  if (def.kind === 'PAIR' || def.kind === 'TRIO') {
    const members = def.members ?? [];
    if (members.length === 0) return null;
    const have = members.filter((m) => filled.includes(m));
    const missing = members.filter((m) => !filled.includes(m));
    if (missing.length === 0) {
      return { def, state: 'active', memberDefIds: have };
    }
    if (missing.length === 1) {
      const name = charById.get(missing[0]!)?.name ?? missing[0]!;
      return {
        def,
        state: 'almost',
        memberDefIds: have,
        missingNote: `「${name}」を編成に加えると成立(あと1人)`,
      };
    }
    return null;
  }

  if (def.kind === 'TAG' && def.requireTag) {
    const { tag, count } = def.requireTag;
    const owners = filled.filter((d) => charById.get(d)?.tags?.includes(tag));
    if (owners.length >= count) {
      return { def, state: 'active', memberDefIds: owners };
    }
    if (owners.length === count - 1) {
      return {
        def,
        state: 'almost',
        memberDefIds: owners,
        missingNote: `「${tag}」タグを持つキャラをあと1体編成すると成立`,
      };
    }
    return null;
  }

  if (def.kind === 'PARTY' && def.requireAllElement) {
    const el = def.requireAllElement;
    const matched = filled.filter((d) => charById.get(d)?.element === el);
    const mismatched = filled.length - matched.length;
    if (filled.length === PARTY_FULL_SIZE && mismatched === 0) {
      return { def, state: 'active', memberDefIds: matched };
    }
    if (mismatched === 0 && filled.length === PARTY_FULL_SIZE - 1) {
      return {
        def,
        state: 'almost',
        memberDefIds: matched,
        missingNote: '残り1枠を同属性で埋めると成立(あと1人)',
      };
    }
    if (mismatched === 1 && filled.length === PARTY_FULL_SIZE) {
      return {
        def,
        state: 'almost',
        memberDefIds: matched,
        missingNote: '属性が異なる1人を入れ替えると成立',
      };
    }
    return null;
  }

  return null;
}

/** 成立中を先頭に、成立/惜しいの両方を返す(該当しないコンボは含めない) */
export function evaluateCombos(
  combos: ComboDef[],
  partyDefIds: string[],
  charById: Map<string, CharacterDef>,
): ComboMatch[] {
  const out: ComboMatch[] = [];
  for (const def of combos) {
    const m = evaluateCombo(def, partyDefIds, charById);
    if (m) out.push(m);
  }
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === 'active' ? -1 : 1));
  return out;
}

/** 指定キャラ(defId)が参加者として関わるコンボ定義だけを絞り込む */
export function combosInvolving(combos: ComboDef[], defId: string): ComboDef[] {
  return combos.filter((c) => (c.members ?? []).includes(defId));
}
