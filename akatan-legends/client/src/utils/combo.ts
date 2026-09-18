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
import type { CharacterDef, ComboDef, MasterDataResponse, PlannedCharacterDef } from '@akatan/shared';

/**
 * `/api/master` の `combos` を取り出す。データ担当の投入がまだ0件でも
 * (`data/combos/` が空、またはサーバ未起動でモック実行中でも) 空配列で安全に動く。
 */
export function combosOf(master: MasterDataResponse | null): ComboDef[] {
  return master?.combos ?? [];
}

/** `/api/master` の `plannedCharacters` を取り出す(未実装でも空配列で安全に動く)。 */
export function plannedCharactersOf(master: MasterDataResponse | null): PlannedCharacterDef[] {
  return master?.plannedCharacters ?? [];
}

/**
 * 未実装キャラを含むコンボ表示のための名前解決。
 * 実装済みキャラは `CharacterDef.name` をそのまま、未実装キャラ(コンボの `members` に
 * IDだけが登場する)は `PlannedCharacterDef.name` に「(実装予定)」を付けて返す。
 * どちらにも無いIDはID文字列をそのまま返す(データ不整合時のフェイルセーフ)。
 */
export function comboMemberName(
  defId: string,
  charById: Map<string, CharacterDef>,
  plannedById?: Map<string, PlannedCharacterDef>,
): string {
  const impl = charById.get(defId);
  if (impl) return impl.name;
  const planned = plannedById?.get(defId);
  if (planned) return `${planned.name}(実装予定)`;
  return defId;
}

export function buildPlannedMap(master: MasterDataResponse | null): Map<string, PlannedCharacterDef> {
  const m = new Map<string, PlannedCharacterDef>();
  for (const p of plannedCharactersOf(master)) m.set(p.id, p);
  return m;
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
  plannedById?: Map<string, import('@akatan/shared').PlannedCharacterDef>,
): ComboMatch | null {
  const filled = partyDefIds.filter((d): d is string => !!d);

  if (def.kind === 'PAIR' || def.kind === 'TRIO') {
    const members = def.members ?? [];
    if (members.length === 0) return null;
    // 未実装キャラ(members にいるが charById に無いID)は絶対に編成へ加えられないため、
    // 成立可能かどうかの判定自体は「実装済みキャラだけで足りているか」で行う。
    // ただし「あと1人」の表示は未実装キャラでも名前(実装予定)付きで見せてよい
    // (§13: 今後実装されるコンボであることが伝わる見せ方にする、という要件)。
    const have = members.filter((m) => filled.includes(m));
    const missing = members.filter((m) => !filled.includes(m));
    if (missing.length === 0) {
      return { def, state: 'active', memberDefIds: have };
    }
    if (missing.length === 1) {
      const missingId = missing[0]!;
      const name = comboMemberName(missingId, charById, plannedById);
      const isPlanned = !charById.has(missingId);
      return {
        def,
        state: 'almost',
        memberDefIds: have,
        missingNote: isPlanned
          ? `「${name}」が実装されると成立(あと1人・現在は編成に加えられません)`
          : `「${name}」を編成に加えると成立(あと1人)`,
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
  plannedById?: Map<string, import('@akatan/shared').PlannedCharacterDef>,
): ComboMatch[] {
  const out: ComboMatch[] = [];
  for (const def of combos) {
    const m = evaluateCombo(def, partyDefIds, charById, plannedById);
    if (m) out.push(m);
  }
  out.sort((a, b) => (a.state === b.state ? 0 : a.state === 'active' ? -1 : 1));
  return out;
}

/** 指定キャラ(defId)が参加者として関わるコンボ定義だけを絞り込む */
export function combosInvolving(combos: ComboDef[], defId: string): ComboDef[] {
  return combos.filter((c) => (c.members ?? []).includes(defId));
}
