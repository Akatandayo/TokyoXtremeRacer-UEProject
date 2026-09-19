/**
 * BGM / 効果音の再生エンジン(フレームワーク非依存のシングルトン)。
 *
 * 方針:
 *  - BGM: シーンが変わっても曲ファイルが同じなら再生を継続する(頭出ししない)。
 *    曲が変わるときだけ2つの <audio> 要素をクロスフェードする。
 *  - 効果音: 複数の <audio> 要素をプールして使い回し、同時発音できるようにする。
 *    倍速再生時に同じ音が詰まって鳴らないよう、種別ごとに最短間隔で間引く。
 *  - 自動再生制限: 最初のユーザー操作(クリック/キー/タッチ)まで再生を試みない。
 *    それまでの setScene/playSfx 呼び出しは「保留」するだけで、画面には一切影響しない。
 *  - 音源が読めない/再生に失敗しても例外を投げない(常に握りつぶして無音で続行)。
 */
import type { AudioConfig, AudioScene, SfxKey } from '@akatan/shared';
import { resolveAudioSrc } from './resolve';
import { DEFAULT_AUDIO_CONFIG } from './defaultConfig';

export interface AudioSettingsInput {
  /** 0.0〜1.0 */
  bgmVolume: number;
  /** 0.0〜1.0 */
  sfxVolume: number;
  muted: boolean;
}

const SFX_POOL_SIZE = 10;

/** 効果音ごとの最短発音間隔(ms)。倍速(2x/4x)再生時に音が渋滞するのを防ぐ間引き。 */
const SFX_MIN_GAP_MS: Partial<Record<SfxKey, number>> = {
  HIT: 90,
  DAMAGE: 90,
  CRITICAL: 140,
  SKILL: 160,
  ULTIMATE: 260,
  AWAKEN: 280,
  COMBO: 220,
  DEFEAT: 160,
  HEAL: 140,
  CLICK: 60,
  GACHA_PULL: 60,
  GACHA_RARE: 200,
  LEVEL_UP: 200,
  REBIRTH: 260,
  DROP: 140,
  VICTORY: 300,
  LOSE: 300,
};
const DEFAULT_MIN_GAP_MS = 100;

const FADE_MS = 550;

class AudioManager {
  private config: AudioConfig = DEFAULT_AUDIO_CONFIG;
  private settings: AudioSettingsInput = { bgmVolume: 0.7, sfxVolume: 0.8, muted: false };

  private readonly available = typeof window !== 'undefined' && typeof Audio !== 'undefined';

  private bgmA: HTMLAudioElement | null = null;
  private bgmB: HTMLAudioElement | null = null;
  private currentSlot: 'A' | 'B' = 'A';
  private currentBgmFile: string | null = null;
  private currentSceneVolume = 0.35;
  private fadeTimer: number | null = null;

  private sfxPool: HTMLAudioElement[] = [];
  private lastPlayedAt = new Map<string, number>();

  private unlocked = false;
  private pendingScene: AudioScene | null = null;
  private listenersAttached = false;

  /** 初回マウント時に1度呼ぶ。ジェスチャー待ちリスナーだけ仕込んでおく。 */
  init(): void {
    this.attachUnlockListeners();
  }

  setConfig(config: AudioConfig | null | undefined): void {
    const hasAny = !!config && ((config.bgm && Object.keys(config.bgm).length > 0) || (config.sfx && Object.keys(config.sfx).length > 0));
    this.config = hasAny ? (config as AudioConfig) : DEFAULT_AUDIO_CONFIG;
  }

  setSettings(patch: Partial<AudioSettingsInput>): void {
    this.settings = { ...this.settings, ...patch };
    this.applyBgmVolume();
  }

  /** シーンに対応するBGMへ。同じ曲なら何もしない(継続)。未定義シーンも何もしない(継続)。 */
  setScene(scene: AudioScene): void {
    if (!this.available) return;
    this.attachUnlockListeners();
    if (!this.unlocked) {
      this.pendingScene = scene;
      return;
    }
    const track = this.config.bgm?.[scene];
    if (!track || !track.file) return;
    if (track.file === this.currentBgmFile) return;
    this.crossfadeTo(track.file, track.volume ?? this.config.defaults?.bgm ?? 0.35, track.loop !== false);
  }

  /** 効果音を1つ再生する。倍速時の連打は種別ごとに間引く。 */
  playSfx(key: SfxKey): void {
    if (!this.available) return;
    this.attachUnlockListeners();
    if (!this.unlocked) return; // ジェスチャー前: キューはせず単に鳴らさない(頻発イベントのため)
    if (this.settings.muted) return;
    const track = this.config.sfx?.[key];
    if (!track || !track.file) return;

    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const gap = SFX_MIN_GAP_MS[key] ?? DEFAULT_MIN_GAP_MS;
    const last = this.lastPlayedAt.get(key) ?? 0;
    if (now - last < gap) return;

    const vol = Math.max(0, Math.min(1, (track.volume ?? this.config.defaults?.sfx ?? 0.5) * this.settings.sfxVolume));
    if (vol <= 0) return;

    this.lastPlayedAt.set(key, now);
    try {
      this.ensureSfxPool();
      const el = this.pickFreeSfxEl();
      el.src = resolveAudioSrc(track.file);
      el.volume = vol;
      el.currentTime = 0;
      const p = el.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 自動再生拒否等は無視 */ });
    } catch {
      /* 音源が読めない・再生できない環境でも画面は壊さない */
    }
  }

  /* ---------------- BGM 内部実装 ---------------- */

  private getBgmEl(slot: 'A' | 'B'): HTMLAudioElement {
    if (slot === 'A') {
      if (!this.bgmA) {
        this.bgmA = new Audio();
        this.bgmA.preload = 'auto';
      }
      return this.bgmA;
    }
    if (!this.bgmB) {
      this.bgmB = new Audio();
      this.bgmB.preload = 'auto';
    }
    return this.bgmB;
  }

  private crossfadeTo(file: string, sceneVolume: number, loop: boolean): void {
    try {
      const nextSlot: 'A' | 'B' = this.currentSlot === 'A' ? 'B' : 'A';
      const nextEl = this.getBgmEl(nextSlot);
      const prevEl = this.getBgmEl(this.currentSlot);

      nextEl.loop = loop;
      nextEl.volume = 0;
      nextEl.src = resolveAudioSrc(file);

      this.currentBgmFile = file;
      this.currentSceneVolume = sceneVolume;
      this.currentSlot = nextSlot;

      const p = nextEl.play();
      if (p && typeof p.catch === 'function') p.catch(() => { /* 自動再生拒否等は無視 */ });

      this.runFade(prevEl, nextEl);
    } catch {
      /* 音源が読めない等は無視して無音のまま続行 */
    }
  }

  private runFade(prevEl: HTMLAudioElement, nextEl: HTMLAudioElement): void {
    if (this.fadeTimer !== null) {
      window.clearInterval(this.fadeTimer);
      this.fadeTimer = null;
    }
    const target = this.effectiveBgmVolume();
    const prevStartVol = prevEl.volume;
    const start = Date.now();
    this.fadeTimer = window.setInterval(() => {
      const t = Math.min(1, (Date.now() - start) / FADE_MS);
      try {
        nextEl.volume = target * t;
        prevEl.volume = prevStartVol * (1 - t);
      } catch {
        /* noop */
      }
      if (t >= 1) {
        if (this.fadeTimer !== null) window.clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        try {
          if (prevEl !== nextEl) {
            prevEl.pause();
            prevEl.currentTime = 0;
          }
        } catch {
          /* noop */
        }
      }
    }, 40);
  }

  private effectiveBgmVolume(): number {
    if (this.settings.muted) return 0;
    return Math.max(0, Math.min(1, this.currentSceneVolume * this.settings.bgmVolume));
  }

  private applyBgmVolume(): void {
    if (!this.available) return;
    // クロスフェード中はそちらのループが音量を管理するので、進行中でなければ即時反映する。
    if (this.fadeTimer !== null) return;
    try {
      const el = this.getBgmEl(this.currentSlot);
      el.volume = this.effectiveBgmVolume();
    } catch {
      /* noop */
    }
  }

  /* ---------------- SFX 内部実装 ---------------- */

  private ensureSfxPool(): void {
    if (this.sfxPool.length > 0) return;
    for (let i = 0; i < SFX_POOL_SIZE; i++) {
      const a = new Audio();
      a.preload = 'auto';
      this.sfxPool.push(a);
    }
  }

  private pickFreeSfxEl(): HTMLAudioElement {
    const free = this.sfxPool.find((a) => a.paused || a.ended);
    if (free) return free;
    // 全て使用中なら最も古い(先頭の)ものを奪う。短い効果音なのでほぼ発生しない。
    return this.sfxPool[0]!;
  }

  /* ---------------- 自動再生制限への対応 ---------------- */

  private attachUnlockListeners(): void {
    if (this.listenersAttached || !this.available || this.unlocked) return;
    this.listenersAttached = true;
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('touchstart', unlock);
      if (this.pendingScene) {
        const scene = this.pendingScene;
        this.pendingScene = null;
        this.setScene(scene);
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }
}

export const audioManager = new AudioManager();
