/**
 * アプリ全体の状態。React の Context + useState のみで構成する(外部ライブラリ禁止)。
 */
import React, {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import type {
  PlayerProfile, CharacterView, Party, MasterDataResponse, ChapterDef,
  BattleStartResponse, InventoryResponse,
} from '@akatan/shared';
import { api, describeError } from '../api/client';
import { isMockMode } from '../api/mode';
import { DEFAULT_SETTINGS, loadSettings, saveSettings, type Settings } from './settings';

export type Screen =
  | 'HOME' | 'CHARACTERS' | 'CHARACTER_DETAIL' | 'PARTY'
  | 'DUNGEON' | 'BATTLE' | 'COLLECTION' | 'SETTINGS'
  | 'EQUIPMENT' | 'GACHA';

export interface Route {
  screen: Screen;
  charUid?: string;
  /** EQUIPMENT 画面へ「このキャラの装備を変更」で遷移した場合、先に選択しておくキャラ */
  equipCharUid?: string;
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
  /** 所持装備・素材・チケット。EQUIPMENT/GACHA 画面が使う(取得は各画面の責務)。 */
  inventory: InventoryResponse | null;
}

interface Store extends AppState {
  route: Route;
  settings: Settings;
  battle: BattleStartResponse | null;
  recent: RecentBattle[];
  mock: boolean;
  navigate: (screen: Screen, charUid?: string, equipCharUid?: string) => void;
  reload: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  saveParty: (members: (string | null)[]) => Promise<void>;
  setAi: (uid: string, aiProfile: string) => Promise<void>;
  startBattle: (stageId: string, members?: (string | null)[]) => Promise<void>;
  finishBattle: (rec: RecentBattle | null) => void;
  clearBattle: () => void;
  /** 装備/ガチャ画面用: 所持品を取得してストアへ反映する */
  refreshInventory: () => Promise<InventoryResponse>;
  applyInventory: (inv: InventoryResponse) => void;
  applyPlayer: (p: PlayerProfile) => void;
  /** 単一キャラの最新状態を反映(装備の着脱など) */
  applyCharacterView: (view: CharacterView) => void;
  /** 複数キャラの最新状態をuidでマージ(ガチャで新規入手した場合を含む) */
  mergeCharacters: (views: CharacterView[]) => void;
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
    inventory: null,
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
      setState((s) => ({
        loading: false,
        error: null,
        player: player.player,
        characters: player.characters,
        party: player.party,
        master,
        chapters: dungeons.chapters,
        clearedStages: dungeons.clearedStages,
        inventory: player.inventory ?? s.inventory,
      }));
    } catch (e) {
      if (!mounted.current) return;
      setState((s) => ({ ...s, loading: false, error: e }));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const navigate = useCallback((screen: Screen, charUid?: string, equipCharUid?: string) => {
    setRoute({ screen, charUid, equipCharUid });
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
        inventory: b.inventory ?? s.inventory,
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

  const refreshInventory = useCallback(async () => {
    const inv = await api().getInventory();
    if (mounted.current) setState((s) => ({ ...s, inventory: inv }));
    return inv;
  }, []);

  const applyInventory = useCallback((inv: InventoryResponse) => {
    setState((s) => ({ ...s, inventory: inv }));
  }, []);

  const applyPlayer = useCallback((p: PlayerProfile) => {
    setState((s) => ({ ...s, player: p }));
  }, []);

  const applyCharacterView = useCallback((view: CharacterView) => {
    setState((s) => ({
      ...s,
      characters: s.characters.some((c) => c.owned.uid === view.owned.uid)
        ? s.characters.map((c) => (c.owned.uid === view.owned.uid ? view : c))
        : [...s.characters, view],
    }));
  }, []);

  const mergeCharacters = useCallback((views: CharacterView[]) => {
    if (views.length === 0) return;
    setState((s) => {
      const map = new Map(s.characters.map((c) => [c.owned.uid, c] as const));
      for (const v of views) map.set(v.owned.uid, v);
      return { ...s, characters: [...map.values()] };
    });
  }, []);

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
      refreshInventory,
      applyInventory,
      applyPlayer,
      applyCharacterView,
      mergeCharacters,
    }),
    [
      state, route, settings, battle, recent, navigate, reload, updateSettings, saveParty, setAi,
      startBattle, finishBattle, clearBattle, refreshInventory, applyInventory, applyPlayer,
      applyCharacterView, mergeCharacters,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider の外で useStore が呼ばれました');
  return v;
}

export { describeError };
