/** AudioManager への React バインディング。 */
import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type { AudioConfig, AudioScene, SfxKey } from '@akatan/shared';
import { audioManager, type AudioSettingsInput } from './AudioManager';

interface AudioApi {
  playSfx: (key: SfxKey) => void;
  /** スキル専用効果音があればそれを、無ければ fallback を鳴らす */
  playSkillSfx: (skillId: string | undefined, fallback: SfxKey) => void;
  setScene: (scene: AudioScene) => void;
}

const Ctx = createContext<AudioApi | null>(null);

export function AudioProvider({
  config, settings, children,
}: {
  config: AudioConfig | null | undefined;
  settings: AudioSettingsInput;
  children: React.ReactNode;
}): JSX.Element {
  useEffect(() => {
    audioManager.init();
  }, []);

  useEffect(() => {
    audioManager.setConfig(config);
  }, [config]);

  useEffect(() => {
    audioManager.setSettings(settings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.bgmVolume, settings.sfxVolume, settings.muted]);

  const api = useMemo<AudioApi>(() => ({
    playSfx: (key: SfxKey) => audioManager.playSfx(key),
    playSkillSfx: (skillId: string | undefined, fallback: SfxKey) => audioManager.playSkillSfx(skillId, fallback),
    setScene: (scene: AudioScene) => audioManager.setScene(scene),
  }), []);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAudio(): AudioApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('AudioProvider の外で useAudio が呼ばれました');
  return v;
}
