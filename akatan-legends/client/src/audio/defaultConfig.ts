/**
 * `data/system/audio.json` のフォールバック複製。
 *
 * 本来は `/api/master` の `MasterDataResponse.audio` から配信される想定だが、
 * バックエンド側の対応が未完でも音声機能が確実に動くように、同じ内容を
 * クライアント側にも埋め込んでおく(サーバが配信し始めたらそちらが優先される)。
 * 音源を差し替える場合は data/system/audio.json と両方を更新すること。
 */
import type { AudioConfig } from '@akatan/shared';

export const DEFAULT_AUDIO_CONFIG: AudioConfig = {
  defaults: { bgm: 0.35, sfx: 0.5 },
  bgm: {
    HOME: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    CHARACTERS: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    PARTY: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    DUNGEON: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    EQUIPMENT: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    GACHA: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    REBIRTH: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    COLLECTION: { file: 'bgm_menu.mp3', volume: 0.35, loop: true },
    BATTLE: { file: 'bgm_battle.mp3', volume: 0.4, loop: true },
    RAID: { file: 'bgm_battle.mp3', volume: 0.4, loop: true },
  },
  sfx: {
    HIT: { file: 'sfx_hit.mp3', volume: 0.4 },
    DAMAGE: { file: 'sfx_damage.mp3', volume: 0.45 },
    CRITICAL: { file: 'sfx_damage.mp3', volume: 0.6 },
    SKILL: { file: 'sfx_skill.wav', volume: 0.5 },
    ULTIMATE: { file: 'sfx_ultimate.wav', volume: 0.6 },
    AWAKEN: { file: 'sfx_ultimate.wav', volume: 0.55 },
    COMBO: { file: 'sfx_skill.wav', volume: 0.55 },
    DEFEAT: { file: 'sfx_damage.mp3', volume: 0.5 },
    CLICK: { file: 'sfx_hit.mp3', volume: 0.25 },
  },
};
