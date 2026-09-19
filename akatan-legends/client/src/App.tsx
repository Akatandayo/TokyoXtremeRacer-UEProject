/** アプリ本体: ヘッダ + 画面切り替え(自前ルーティング) */
import React, { useEffect } from 'react';
import type { AudioScene } from '@akatan/shared';
import { useStore, type Screen } from './state/store';
import { Loading, ErrorView } from './components/common';
import { formatNumber } from './utils/labels';
import { AudioProvider, useAudio } from './audio/AudioProvider';
import HomeScreen from './screens/HomeScreen';
import CharactersScreen from './screens/CharactersScreen';
import CharacterDetailScreen from './screens/CharacterDetailScreen';
import PartyScreen from './screens/PartyScreen';
import DungeonScreen from './screens/DungeonScreen';
import CollectionScreen from './screens/CollectionScreen';
import SettingsScreen from './screens/SettingsScreen';
import EquipmentScreen from './screens/EquipmentScreen';
import GachaScreen from './screens/GachaScreen';
import RebirthScreen from './screens/RebirthScreen';
import RaidScreen from './screens/RaidScreen';
import PvpScreen from './screens/PvpScreen';
import BattleScreen from './battle/BattleScreen';

const NAV: { screen: Screen; label: string }[] = [
  { screen: 'HOME', label: 'HOME' },
  { screen: 'CHARACTERS', label: 'キャラ' },
  { screen: 'PARTY', label: '編成' },
  { screen: 'EQUIPMENT', label: '装備' },
  { screen: 'GACHA', label: 'SUMMON' },
  { screen: 'DUNGEON', label: 'ダンジョン' },
  { screen: 'RAID', label: 'RAID' },
  { screen: 'PVP', label: 'PVP' },
  { screen: 'COLLECTION', label: '図鑑' },
  { screen: 'SETTINGS', label: '設定' },
];

/** Screen -> AudioScene の対応。無い場合はBGMを切り替えない(直前の曲を継続)。 */
const SCENE_MAP: Partial<Record<Screen, AudioScene>> = {
  HOME: 'HOME',
  CHARACTERS: 'CHARACTERS',
  CHARACTER_DETAIL: 'CHARACTERS',
  PARTY: 'PARTY',
  DUNGEON: 'DUNGEON',
  BATTLE: 'BATTLE',
  RAID: 'RAID',
  COLLECTION: 'COLLECTION',
  EQUIPMENT: 'EQUIPMENT',
  GACHA: 'GACHA',
  REBIRTH: 'REBIRTH',
};

/** 画面遷移のたびにBGMシーンを同期する(見た目を持たない補助コンポーネント)。 */
function SceneSync(): null {
  const store = useStore();
  const audio = useAudio();
  useEffect(() => {
    const scene = SCENE_MAP[store.route.screen];
    if (scene) audio.setScene(scene);
  }, [store.route.screen, audio]);
  return null;
}

function ScreenBody(): JSX.Element {
  const store = useStore();

  // 戦闘中はデータ取得状態に関わらず再生を優先する
  if (store.route.screen === 'BATTLE') return <BattleScreen />;

  if (store.loading) return <Loading label="データを取得しています…" />;
  if (store.error) {
    return (
      <ErrorView
        error={store.error}
        onRetry={() => void store.reload()}
        hint="サーバ未起動の場合は、設定画面のモックモード(または URL に ?mock=1)でデモを確認できます。"
      />
    );
  }

  switch (store.route.screen) {
    case 'CHARACTERS': return <CharactersScreen />;
    case 'CHARACTER_DETAIL': return <CharacterDetailScreen />;
    case 'REBIRTH': return <RebirthScreen />;
    case 'PARTY': return <PartyScreen />;
    case 'EQUIPMENT': return <EquipmentScreen />;
    case 'GACHA': return <GachaScreen />;
    case 'DUNGEON': return <DungeonScreen />;
    case 'RAID': return <RaidScreen />;
    case 'PVP': return <PvpScreen />;
    case 'COLLECTION': return <CollectionScreen />;
    case 'SETTINGS': return <SettingsScreen />;
    default: return <HomeScreen />;
  }
}

export function App(): JSX.Element {
  const store = useStore();
  const active = store.route.screen === 'CHARACTER_DETAIL' || store.route.screen === 'REBIRTH'
    ? 'CHARACTERS'
    : store.route.screen;

  return (
    <AudioProvider
      config={store.master?.audio}
      settings={{
        bgmVolume: store.settings.bgmVolume,
        sfxVolume: store.settings.sfxVolume,
        muted: store.settings.audioMuted,
      }}
    >
      <SceneSync />
      <div className="app-shell">
        {store.mock && (
          <div className="mock-banner">
            DEMO MODE — クライアント内蔵のモックデータで動作中(サーバ未使用)
          </div>
        )}
        <header className="app-header">
          <button className="brand" onClick={() => store.navigate('HOME')} aria-label="ホームへ">
            <span className="brand-mark">赤</span>
            <span className="brand-text">
              あかたんLegends
              <small>AKATAN LEGENDS</small>
            </span>
          </button>
          <nav className="nav">
            {NAV.map((n) => (
              <button
                key={n.screen}
                className={`nav-btn ${active === n.screen ? 'is-active' : ''}`}
                onClick={() => store.navigate(n.screen)}
              >
                {n.label}
              </button>
            ))}
            {store.battle && (
              <button
                className={`nav-btn ${store.route.screen === 'BATTLE' ? 'is-active' : ''}`}
                style={{ color: 'var(--magenta)' }}
                onClick={() => store.navigate('BATTLE')}
              >
                戦闘中
              </button>
            )}
          </nav>
          <div className="header-stats">
            <span className="header-chip">{store.player?.name ?? '—'}</span>
            <span className="header-chip">G <b>{formatNumber(store.player?.gold ?? 0)}</b></span>
            <span className="header-chip">
              進行 <b>{store.clearedStages.length}</b>
            </span>
          </div>
        </header>
        <main className="app-main">
          <ScreenBody />
        </main>
      </div>
    </AudioProvider>
  );
}

export default App;
