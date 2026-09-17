/**
 * モックモード(デモモード)の判定。
 * - URLクエリ `?mock=1` が最優先
 * - それ以外は localStorage の設定値
 * サーバが無くても戦闘演出をレビューできるようにするための仕組み。
 */

const STORAGE_KEY = 'akatan.mockMode';

function readQuery(): boolean | null {
  if (typeof window === 'undefined') return null;
  const q = new URLSearchParams(window.location.search).get('mock');
  if (q === null) return null;
  return q !== '0' && q !== 'false';
}

function readStorage(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

let cached: boolean | null = null;

export function isMockMode(): boolean {
  if (cached === null) {
    const q = readQuery();
    cached = q !== null ? q : readStorage();
  }
  return cached;
}

/** 設定画面から切り替える。反映にはリロードが必要。 */
export function setMockMode(on: boolean): void {
  cached = on;
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    /* localStorage が使えない環境は無視 */
  }
}

/** クエリを付け替えてリロードする */
export function reloadWithMock(on: boolean): void {
  setMockMode(on);
  const url = new URL(window.location.href);
  if (on) url.searchParams.set('mock', '1');
  else url.searchParams.delete('mock');
  window.location.href = url.toString();
}
