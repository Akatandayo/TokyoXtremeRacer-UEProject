/**
 * アプリ全体の状態。React の Context + useState のみで構成する(外部ライブラリ禁止)。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  PlayerProfile, CharacterView, Party, MasterDataResponse, ChapterDef,
  BattleStartResponse,
} from '@akatan/shared';
import { api, describeError } from '../api/client';
import { isMockMode } from '../api/mode';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

export type Screen =
  | 'HOME' | 'CHARACTERS' | 'CHARACTER_DETAIL' | 'PARTY'
  | 'DUNGEON' | 'BATTLE' | 'COLLECTION' | 'SETTINGS';

export interface Route {
  screen: Screen;
  charUid?: string;
}

export interface RecentBattle {
  id: string;
  stageId: string;
  stageName: string;
  victory: boolean;
  exp: number;
  gold: number;
  mvpName: string;
  mvpDamage: number;
  turns: number;
  at: string;
}

export interface AppState {
  loading: boolean;
  error: unknown;
  player: PlayerProfile | null;
  characters: CharacterView[];
  party: Party | null;
  master: MasterDataResponse | null;
  chapters: ChapterDef[];
  clearedStages: string[];
}

interface Store extends AppState {
  route: Route;
  settings: Settings;
  battle: BattleStartResponse | null;
  recent: RecentBattle[];
  mock: boolean;
  navigate: (screen: Screen, charUid?: string) => void;
  reload: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  saveParty: (members: (string | null)[]) => Promise<void>;
  setAi: (uid: string, aiProfile: string) => Promise<void>;
  startBattle: (stageId: string, members?: (string | null)[]) => Promise<void>;
  finishBattle: (rec: RecentBattle | null) => void;
  clearBattle: () => void;
}

const Ctx = createContext<Store | null>(null);

const RECENT_KEY = 'akatan.recent';

function loadRecent(): RecentBattle[] {
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    return raw ? (JSON.parse(raw) as RecentBattle[]) : [];
  } catch {
    return [];
  }
}

export function StoreProvider({ children }: { children: React.ReactNode }): JSX.Element {
  const [state, setState] = useState<AppState>({
    loading: true,
    error: null,
    player: null,
    characters: [],
    party: null,
    master: null,
    chapters: [],
    clearedStages: [],
  });
  const [route, setRoute] = useState<Route>({ screen: 'HOME' });
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [battle, setBattle] = useState<BattleStartResponse | null>(null);
  const battleRef = useRef<BattleStartResponse | null>(null);
  battleRef.current = battle;
  const [recent, setRecent] = useState<RecentBattle[]>([]);
  const mounted = useRef(true);

  useEffect(() => {
    setSettings(loadSettings());
    setRecent(loadRecent());
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const client = api();
      const [player, master, dungeons] = await Promise.all([
        client.getPlayer(),
        client.getMaster(),
        client.getDungeons(),
      ]);
      if (!mounted.current) return;
      setState({
        loading: false,
        error: null,
        player: player.player,
        characters: player.characters,
        party: player.party,
        master,
        chapters: dungeons.chapters,
        clearedStages: dungeons.clearedStages,
      });
    } catch (e) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, loading: false, error: e }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const navigate = useCallback((screen: Screen, charUid?: string) => {
    setRoute({ screen, charUid });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, []);

  const updateSettings = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);

  const saveParty = useCallback(async (members: (string | null)[]) => {
    const res = await api().updateParty(members);
    setState((s) => ({ ...s, party: res.party }));
  }, []);

  const setAi = useCallback(async (uid: string, aiProfile: string) => {
    await api().updateAi(uid, aiProfile);
    setState((s) => ({
      ...s,
      characters: s.characters.map((c) =>
        c.owned.uid === uid ? { ...c, owned: { ...c.owned, aiProfile } } : c,
      ),
    }));
  }, []);

  const startBattle = useCallback(async (stageId: string, members?: (string | null)[]) => {
    const res = await api().startBattle(stageId, members);
    setBattle(res);
    setRoute({ screen: 'BATTLE' });
  }, []);

  const finishBattle = useCallback((rec: RecentBattle | null) => {
    const b = battleRef.current;
    if (b) {
      setState((s) => ({
        ...s,
        player: b.player,
        characters: b.characters.length > 0 ? b.characters : s.characters,
        clearedStages:
          b.log.result.victory && b.stage && !s.clearedStages.includes(b.stage.id)
            ? [...s.clearedStages, b.stage.id]
            : s.clearedStages,
      }));
    }
    if (rec) {
      setRecent((prev) => {
        const next = [rec, ...prev].slice(0, 6);
        try {
          window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
  }, []);

  const clearBattle = useCallback(() => setBattle(null), []);

  const value = useMemo<Store>(
    () => ({
      ...state,
      route,
      settings,
      battle,
      recent,
      mock: isMockMode(),
      navigate,
      reload,
      updateSettings,
      saveParty,
      setAi,
      startBattle,
      finishBattle,
      clearBattle,
    }),
    [state, route, settings, battle, recent, navigate, reload, updateSettings, saveParty, setAi, startBattle, finishBattle, clearBattle],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider の外で useStore が呼ばれました');
  return v;
}

export { describeError };
