/** ユーザー設定 (localStorage 永続化) */

export type BattleSpeed = 1 | 2 | 4;

export interface Settings {
  /** 戦闘の既定倍速 */
  speed: BattleSpeed;
  /** 軽量モード: 派手なエフェクト/カットイン/画面揺れを抑える */
  lightMode: boolean;
  /** ダメージ数値ポップアップ */
  damageNumbers: boolean;
  /** スキルカットイン */
  cutIn: boolean;
  /** 画面揺れ */
  screenShake: boolean;
  /** バトルログの表示行数 */
  logLines: number;
  /** 戦闘終了後に自動でリザルトを開く */
  autoResult: boolean;
  /** BGM音量 (0.0〜1.0) */
  bgmVolume: number;
  /** 効果音音量 (0.0〜1.0) */
  sfxVolume: number;
  /** 音声を全てミュート */
  audioMuted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  speed: 1,
  lightMode: false,
  damageNumbers: true,
  cutIn: true,
  screenShake: true,
  logLines: 40,
  autoResult: true,
  bgmVolume: 0.7,
  sfxVolume: 0.8,
  audioMuted: false,
};

const KEY = 'akatan.settings';

export function loadSettings(): Settings {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 保存できない環境では既定値で動作する */
  }
}

/** OS の「視差効果を減らす」設定 */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** 実際に演出を出してよいか (軽量モード / reduced-motion を統合) */
export interface EffectPolicy {
  cutIn: boolean;
  shake: boolean;
  particles: boolean;
  damageNumbers: boolean;
}

export function effectPolicy(s: Settings): EffectPolicy {
  const reduced = prefersReducedMotion();
  const light = s.lightMode || reduced;
  return {
    cutIn: s.cutIn && !light,
    shake: s.screenShake && !light,
    particles: !light,
    damageNumbers: s.damageNumbers,
  };
}
