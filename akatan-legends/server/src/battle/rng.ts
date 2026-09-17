/**
 * 決定論的乱数 (seeded RNG)
 * ------------------------------------------------------------
 * なぜ自前実装か:
 *   - Math.random() はシード指定ができず、リプレイ再生・PvP再現・不具合の再調査ができない。
 *   - 「同じシード + 同じ入力 => 完全に同じ BattleLog」はこのゲームの土台なので、
 *     乱数は必ずこのモジュール経由で消費する。エンジン内で Math.random() を使ってはいけない。
 *
 * アルゴリズム: mulberry32
 *   - 状態32bitのみ・乗算2回で済み、周期 2^32、分布も実用上十分。
 *   - Math.imul を使うので JS の double 演算誤差に依存せず、環境をまたいでもビット完全一致する。
 *     (xorshift+ のような 53bit 浮動小数に依存する実装だと将来の環境差でログがズレる恐れがある)
 */

export interface Rng {
  /** [0, 1) の一様乱数 */
  next(): number;
  /** min 以上 max 以下の整数 (両端含む) */
  int(min: number, max: number): number;
  /** percent% の確率で true。0以下なら必ず false、100以上なら必ず true (乱数は必ず1回消費する) */
  chance(percent: number): boolean;
  /** 配列から1要素を選ぶ。空配列は例外 */
  pick<T>(arr: readonly T[]): T;
  /** これまでに消費した乱数の回数 (デバッグ/決定論の検証用) */
  readonly calls: number;
  /** 現在の内部状態 (分岐したストリームを作りたい場合の種として使える) */
  readonly state: number;
}

/**
 * シードから決定論的な乱数列を生成する。
 * seed は 32bit 符号なし整数に丸める (NaN/小数/負数が来ても壊れないように)。
 */
export function createRng(seed: number): Rng {
  // Number.isFinite でない値が来たら 0 扱い。>>> 0 で 32bit 符号なしへ正規化する。
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  let calls = 0;

  const next = (): number => {
    calls++;
    // mulberry32 本体
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    // >>> 0 で符号なし化してから 2^32 で割り [0,1) に落とす
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const rng: Rng = {
    next,
    int(min: number, max: number): number {
      // min > max で呼ばれても壊さない (入れ替える)。乱数は必ず1回消費して列をずらさない。
      const lo = Math.ceil(Math.min(min, max));
      const hi = Math.floor(Math.max(min, max));
      const r = next();
      if (hi <= lo) return lo;
      return lo + Math.floor(r * (hi - lo + 1));
    },
    chance(percent: number): boolean {
      // 早期 return で乱数を消費しないと、確率100%の効果が混ざるだけで
      // 以降の乱数列が全部ズレてしまう。必ず1回消費してから比較する。
      const r = next();
      if (!Number.isFinite(percent)) return false;
      if (percent <= 0) return false;
      if (percent >= 100) return true;
      return r * 100 < percent;
    },
    pick<T>(arr: readonly T[]): T {
      if (arr.length === 0) throw new Error('rng.pick: 空配列からは選べない');
      const r = next();
      const idx = Math.min(arr.length - 1, Math.floor(r * arr.length));
      return arr[idx] as T;
    },
    get calls() {
      return calls;
    },
    get state() {
      return state;
    },
  };
  return rng;
}
