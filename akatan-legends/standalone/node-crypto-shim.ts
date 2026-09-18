/**
 * オフライン単体版用の `node:crypto` 差し替え。
 * server/src/services/item-generator.ts が randomUUID を import しているが、
 * 単体版はブラウザで動くため Node のモジュールは解決できない。
 * 単体版で必要なのは「衝突しないID」だけなので、最小限の実装を提供する。
 */
export function randomUUID(): string {
  const c = globalThis.crypto as Crypto | undefined;
  // file:// も secure context として扱われるため大抵はこちらが使える
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  // 使えない環境向けのフォールバック(単体版のセーブはローカル限定なので十分)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export default { randomUUID };
