/**
 * PVP: あいことば対戦
 * ------------------------------------------------------------
 * 2人が同じ「あいことば」を入れると対戦が成立する。片方が先に入ると「相手待ち」になり、
 * もう片方が入った瞬間にサーバが戦闘を1回だけ確定させ、両者が同じ戦闘ログを見る。
 *
 * 戦闘の再生は既存の BATTLE 画面(store.enterPvpBattle -> BattleScreen)をそのまま使う。
 * 編成はこの画面から送信する時点の「現在の保存済みパーティ」を使う(サーバは
 * defId/level/aiProfile/statsを検証してから使う。docs/API.md「PvP」節参照)。
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BattleStartResponse, CharacterView, Party, PvpMemberSnapshot, PvpPartySnapshot, StageDef,
} from '@akatan/shared';
import { PVP_PARTY_SIZE } from '@akatan/shared';
import { useStore, PVP_STAGE_ID_PREFIX } from '../state/store';
import { Panel, ErrorView, ElementChip } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { api, describeError } from '../api/client';

const POLL_INTERVAL_MS = 2500;

function buildSnapshot(characters: CharacterView[], party: Party | null): PvpPartySnapshot {
  const uids = (party?.members ?? []).filter((m): m is string => !!m);
  const members: PvpMemberSnapshot[] = uids
    .map((uid) => characters.find((c) => c.owned.uid === uid))
    .filter((c): c is CharacterView => !!c)
    .slice(0, PVP_PARTY_SIZE)
    .map((c) => ({
      defId: c.def.id,
      level: c.owned.level,
      aiProfile: c.owned.aiProfile ?? c.def.defaultAi,
      stats: c.stats,
    }));
  return { members };
}

/** 現在のパーティ編成のミニプレビュー(あいことば入力の下に出す) */
function PartyPreview({ characters, party }: { characters: CharacterView[]; party: Party | null }): JSX.Element {
  const uids = (party?.members ?? []).filter((m): m is string => !!m);
  const views = uids
    .map((uid) => characters.find((c) => c.owned.uid === uid))
    .filter((v): v is CharacterView => !!v);

  if (views.length === 0) return <div className="muted" style={{ fontSize: 12 }}>編成が空です。</div>;

  return (
    <div className="pvp-party-preview">
      {views.map((v) => (
        <div className="pvp-party-chip" key={v.owned.uid} title={`${v.def.name} Lv${v.owned.level}`}>
          <div className="pvp-party-chip-art">
            <CharacterArtView art={v.def.art} name={v.def.name} element={v.def.element} rarity={v.def.rarity} ratio="square" hideBadges />
          </div>
          <div className="pvp-party-chip-name">{v.def.name}</div>
          <div className="pvp-party-chip-lv">Lv{v.owned.level}</div>
          <ElementChip element={v.def.element} />
        </div>
      ))}
    </div>
  );
}

type Phase = 'idle' | 'joining' | 'waiting' | 'error';

export function PvpScreen(): JSX.Element {
  const store = useStore();
  const [passphrase, setPassphrase] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<unknown>(null);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const pollTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  const activePassphrase = useRef('');

  useEffect(() => () => {
    mounted.current = false;
    if (pollTimer.current !== null) window.clearInterval(pollTimer.current);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  /** READY になった結果を BATTLE 画面へ渡して再生する(既存の BattleScreen をそのまま再利用) */
  const enterBattle = useCallback((rid: string, side: 'ALLY' | 'ENEMY', log: NonNullable<BattleStartResponse['log']>) => {
    const stage: StageDef = {
      id: `${PVP_STAGE_ID_PREFIX}${rid}`,
      name: `PvP対戦「${activePassphrase.current}」`,
      description: '2人のプレイヤーがあいことばで対戦した記録です。',
      enemies: [],
      rewards: { exp: 0, gold: 0 },
    };
    const data: BattleStartResponse = {
      log,
      rewards: null,
      player: store.player ?? { id: 'local', name: '-', gold: 0, createdAt: '', clearedStages: [] },
      characters: store.characters,
      stage,
      drops: null,
      inventory: store.inventory ?? undefined,
    };
    store.enterPvpBattle(data, side);
  }, [store]);

  const poll = useCallback((rid: string) => {
    stopPolling();
    pollTimer.current = window.setInterval(() => {
      void (async () => {
        try {
          const res = await api().pvpStatus(rid);
          if (!mounted.current) return;
          if (res.status === 'READY' && res.log && res.side) {
            stopPolling();
            enterBattle(rid, res.side, res.log);
          }
        } catch (e) {
          if (!mounted.current) return;
          stopPolling();
          setPhase('error');
          setError(e);
        }
      })();
    }, POLL_INTERVAL_MS);
  }, [enterBattle, stopPolling]);

  const join = useCallback(async () => {
    const trimmed = passphrase.trim();
    if (trimmed.length === 0) {
      setPhase('error');
      setError(new Error('あいことばを入力してください。'));
      return;
    }
    const snapshot = buildSnapshot(store.characters, store.party);
    if (snapshot.members.length === 0) {
      setPhase('error');
      setError(new Error('パーティが空です。編成画面でキャラクターをセットしてください。'));
      return;
    }

    activePassphrase.current = trimmed;
    setPhase('joining');
    setError(null);
    try {
      const res = await api().pvpJoin(trimmed, snapshot);
      if (!mounted.current) return;
      if (res.status === 'READY' && res.log && res.side) {
        enterBattle(res.roomId, res.side, res.log);
        return;
      }
      setRoomId(res.roomId);
      setWaitStartedAt(Date.now());
      setPhase('waiting');
      poll(res.roomId);
    } catch (e) {
      if (!mounted.current) return;
      setPhase('error');
      setError(e);
    }
  }, [passphrase, store.characters, store.party, enterBattle, poll]);

  const cancelWaiting = useCallback(() => {
    stopPolling();
    setRoomId(null);
    setWaitStartedAt(null);
    setPhase('idle');
  }, [stopPolling]);

  const partyCount = (store.party?.members ?? []).filter(Boolean).length;

  return (
    <div className="stack">
      <Panel title="PVP" jp="あいことばオンライン対戦">
        <div className="pvp-intro muted" style={{ fontSize: 12 }}>
          2人が同じ「あいことば」を入力すると対戦が成立します。先に入った方が ALLY(下側)、
          後から入った方が ENEMY(上側)として同じ戦闘ログを見ます。編成は現在の保存済み
          パーティ(編成画面で設定したもの)を使います。
        </div>

        {partyCount === 0 && (
          <div className="error-box" style={{ marginTop: 12 }}>
            <h3>パーティが空です</h3>
            <div className="muted">編成画面でキャラクターをセットしてください。</div>
            <button className="btn" onClick={() => store.navigate('PARTY')}>編成へ</button>
          </div>
        )}

        <div className="stack" style={{ gap: 8, marginTop: 12 }}>
          <div className="pvp-label">現在の編成</div>
          <PartyPreview characters={store.characters} party={store.party} />
        </div>

        {phase !== 'waiting' && (
          <div className="pvp-join-row">
            <input
              className="pvp-input"
              type="text"
              inputMode="text"
              placeholder="あいことばを入力…"
              value={passphrase}
              maxLength={40}
              disabled={phase === 'joining'}
              onChange={(e) => setPassphrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing) void join();
              }}
            />
            <button
              className="btn btn-primary"
              disabled={phase === 'joining' || partyCount === 0}
              onClick={() => void join()}
            >
              {phase === 'joining' ? '接続中…' : '対戦を待つ/参加する'}
            </button>
          </div>
        )}

        {phase === 'waiting' && roomId && (
          <div className="pvp-waiting-box">
            <div className="spinner" />
            <div className="pvp-waiting-text">
              あいことば「<b>{activePassphrase.current}</b>」で相手を待っています…
            </div>
            <div className="muted" style={{ fontSize: 12 }}>
              相手がこのあいことばを入力すると自動で戦闘結果へ移動します
              {waitStartedAt && (
                <> (経過 {Math.max(0, Math.round((Date.now() - waitStartedAt) / 1000))}秒)</>
              )}
            </div>
            <button className="btn btn-sm btn-ghost" onClick={cancelWaiting}>待機をやめる</button>
          </div>
        )}

        {phase === 'error' && error !== null && (
          <div style={{ marginTop: 12 }}>
            <ErrorView
              error={error}
              onRetry={() => { setPhase('idle'); setError(null); }}
              hint={describeError(error).code === 'NOT_FOUND'
                ? 'あいことばの部屋が失効した可能性があります。もう一度あいことばを入力してください。'
                : undefined}
            />
          </div>
        )}
      </Panel>
    </div>
  );
}

export default PvpScreen;
