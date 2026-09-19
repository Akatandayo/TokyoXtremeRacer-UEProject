/**
 * 音源(BGM/効果音)の解決。
 *
 * `CharacterArt.tsx` の `resolvePortraitSrc` と全く同じ作りにしている(統一のため)。
 * オフライン単体版は `window.__AKATAN_AUDIO__[file]` に音源の data URL を注入する
 * (統括のビルドスクリプトが担当)。通常のWeb版ではこのオブジェクトは存在しないので、
 * public/audio/<file> を直接参照する。
 *
 * 解決順(唯一の箇所): ① window.__AKATAN_AUDIO__[file] (単体版に埋め込まれた data URL)
 * → ② public/audio/<file> (通常のWeb版)。
 */
declare global {
  interface Window {
    __AKATAN_AUDIO__?: Record<string, string>;
  }
}

export function resolveAudioSrc(file: string): string {
  try {
    const injected = typeof window !== 'undefined' ? window.__AKATAN_AUDIO__ : undefined;
    const hit = injected?.[file];
    if (typeof hit === 'string' && hit.length > 0) return hit;
  } catch {
    /* window 未定義環境 (SSR等) は無視して②へ */
  }
  const base = typeof import.meta !== 'undefined' ? (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/' : '/';
  return `${base}audio/${file}`;
}
