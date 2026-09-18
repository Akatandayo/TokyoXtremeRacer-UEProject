/**
 * 装備の特殊効果 (ItemSpecialEffect) — 判定
 * ------------------------------------------------------------
 * combo.ts と同じ設計思想で「判定」と「発動」を分ける:
 *   - 判定 (このファイル): 副作用なしの純粋関数のみ。BattleUnit を書き換えない・イベントを
 *     出さない。「このトリガーで、この特殊効果は発動を試みてよいか」だけを答える。
 *   - 発動 (engine.ts): 判定を通ったものについて、実際に rng を引いて確率判定し、
 *     ダメージ計算・状態付与・イベント発行を行う。乱数(Rng)はエンジンが単一ストリームで
 *     一元管理しているため、乱数を消費する処理自体は engine.ts 側の責務にする
 *     (rng を跨いで複数モジュールが消費順を持つと決定論の保証が読みにくくなるため)。
 *
 * 決定論について:
 *   specialsOf() は「配列をフィルタするだけ」で乱数を一切使わない。
 *   CombatantInput.specials が未指定(=空配列扱い)の戦闘では、このファイルの関数は
 *   常に空配列を返し、engine.ts 側のループが1回も回らない = 乱数消費が増えない。
 *   これによって「specials 未指定なら従来と完全に同じログ」が構造的に保証される。
 */
import type { ItemSpecialEffect } from '@akatan/shared';
import type { Rng } from './rng.js';

/**
 * 装備の特殊効果一覧から、指定トリガーに合致するものだけを元の順序のまま取り出す。
 * 順序を保つのは、同じユニットが複数の特殊効果を持つ場合に発動順が装備配列の順で
 * 一意に決まるようにするため(ここでソートし直すと呼び出し側の並びに依存して
 * 環境ごとにログがズレる恐れがある)。
 */
export function specialsOf(
  specials: ItemSpecialEffect[] | undefined,
  trigger: ItemSpecialEffect['trigger'],
): ItemSpecialEffect[] {
  if (!specials || specials.length === 0) return [];
  return specials.filter((s) => s.trigger === trigger);
}

/**
 * 発動確率判定。status.ts の applyStatus / SkillEffect.chance と同じ規約に揃える:
 *   - chance 未指定 または 100 以上 -> 乱数を消費せず常に true
 *     (通常攻撃だらけの戦闘で乱数列を汚さないため。specials 未指定なら specialsOf が
 *      空配列を返すのでこの関数自体が呼ばれず、いずれにせよ乱数消費は増えない)
 *   - 100 未満(0 を含む) -> 必ず rng.chance() を1回消費する(rng.chance 自身の規約に従う)
 */
export function rollSpecialChance(special: ItemSpecialEffect, rng: Rng): boolean {
  const pct = special.chance ?? 100;
  if (pct >= 100) return true;
  return rng.chance(pct);
}

/**
 * 装備由来の演出であることをクライアントに伝えるための fx キー。
 * 新しい BattleEventType は追加せず、既存の BattleEvent.fx (自由形式の演出キー文字列) に
 * "equip:<特殊効果ID>" という命名規約で載せる。スキルの fx (例: "slash") と衝突しないよう
 * 接頭辞で名前空間を分けておく。BattleEvent.skillName にも special.name を入れるので、
 * fx を解釈しないクライアントでもログテキスト/skillName だけで装備由来と判別できる。
 */
export function specialFx(special: ItemSpecialEffect): string {
  return `equip:${special.id}`;
}
