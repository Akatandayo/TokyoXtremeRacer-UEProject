/**
 * RAID: 巨大な共有HPを持つボスへ何度も挑む画面(設計書§28〜§29)。
 * 戦闘そのものは既存の BATTLE 画面の再生をそのまま使う(ここでは一覧と挑戦操作のみ)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import type { RaidBossDef, RaidState } from '@akatan/shared';
import { useStore } from '../state/store';
import { Panel } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { api, describeError } from '../api/client';
import { ELEMENT_LABEL, STATUS_LABEL, formatNumber } from '../utils/labels';

function RaidHpBar({ remaining, total }: { remaining: number; total: number }): JSX.Element {
  const pct = total > 0 ? Math.max(0, Math.min(100, (remaining / total) * 100)) : 0;
  const cls = pct <= 15 ? 'low' : pct <= 40 ? 'mid' : '';
  return (
    <div className={`raid-hpbar ${cls}`}>
      <span className="raid-hpbar-fill" style={{ width: `${pct}%` }} />
      <span className="raid-hpbar-text">
        {formatNumber(remaining)} <span className="muted">/ {formatNumber(total)}</span>
        <span className="raid-hpbar-pct"> ({pct.toFixed(1)}%)</span>
      </span>
    </div>
  );
}

function GimmickList({ boss, state }: { boss: RaidBossDef; state: RaidState }): JSX.Element | null {
  const gimmicks = boss.gimmicks ?? [];
  if (gimmicks.length === 0) return null;
  // hpBelow の降順(HPが高いうちに起きるものが先)に並べる
  const sorted = [...gimmicks].sort((a, b) => b.hpBelow - a.hpBelow);
  return (
    <div className="raid-gimmick-list">
      {sorted.map((g) => {
        const on = state.triggeredGimmicks.includes(g.name);
        return (
          <div key={g.name} className={`raid-gimmick-row ${on ? 'is-on' : ''}`}>
            <span className="raid-gimmick-thresh">HP{g.hpBelow}%以下</span>
            <span className="nm">{g.name}</span>
            <span className="muted raid-gimmick-desc">{g.description}</span>
            <span className={`raid-gimmick-flag ${on ? 'is-on' : ''}`}>{on ? '発動済み' : '未発動'}</span>
          </div>
        );
      })}
    </div>
  );
}

function BossCard({
  boss, state, challenging, canChallenge, onChallenge, error,
}: {
  boss: RaidBossDef;
  state: RaidState;
  challenging: boolean;
  canChallenge: boolean;
  onChallenge: () => void;
  error: unknown;
}): JSX.Element {
  const defeated = state.defeated;
  return (
    <div className={`raid-boss-card ${defeated ? 'is-defeated' : ''}`}>
      <div className="raid-boss-head">
        <div className="raid-boss-art">
          <CharacterArtView art={boss.art} name={boss.name} ratio="square" hideBadges />
        </div>
        <div className="raid-boss-titles">
          <div className="raid-boss-name">{boss.name}</div>
          {boss.title && <div className="muted raid-boss-subtitle">{boss.title}</div>}
        </div>
        {defeated && <span className="raid-defeated-badge">撃破済み</span>}
      </div>

      {boss.description && <div className="muted raid-boss-desc">{boss.description}</div>}

      <RaidHpBar remaining={state.remainingHp} total={state.totalHp} />

      <div className="raid-stat-row">
        <span>挑戦回数 <b className="tabular">{state.attempts}</b></span>
        <span>累計与ダメージ <b className="tabular" style={{ color: 'var(--shu)' }}>{formatNumber(state.totalDamage)}</b></span>
      </div>

      <div className="raid-affinity-row">
        {(boss.weakElements ?? []).length > 0 && (
          <span className="raid-affinity-chip weak">
            弱点: {(boss.weakElements ?? []).map((e) => ELEMENT_LABEL[e]).join(' / ')}
          </span>
        )}
        {(boss.immuneStatuses ?? []).length > 0 && (
          <span className="raid-affinity-chip immune">
            無効: {(boss.immuneStatuses ?? []).map((s) => STATUS_LABEL[s]).join(' / ')}
          </span>
        )}
      </div>

      <GimmickList boss={boss} state={state} />

      {error !== null && error !== undefined && (
        <div className="error-box" style={{ marginTop: 4 }}>
          <h3>{describeError(error).title}</h3>
          <div className="muted" style={{ fontSize: 12 }}>{describeError(error).detail}</div>
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%', marginTop: 4 }}
        disabled={defeated || challenging || !canChallenge}
        onClick={onChallenge}
      >
        {defeated ? '撃破済み' : challenging ? '挑戦中…' : '⚔ 挑戦する'}
      </button>
    </div>
  );
}

export function RaidScreen(): JSX.Element {
  const store = useStore();
  const [bosses, setBosses] = useState<RaidBossDef[]>(store.master?.raidBosses ?? []);
  const [states, setStates] = useState<Record<string, RaidState>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [challengingId, setChallengingId] = useState<string | null>(null);
  const [challengeErrors, setChallengeErrors] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api().getRaid();
      setBosses(res.bosses);
      setStates(res.states);
    } catch (e) {
      // バックエンドの /api/raid がまだ未実装の環境でも画面が壊れないようにする(エラー表示のみ)
      setLoadError(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const partyCount = store.party?.members.filter(Boolean).length ?? 0;

  const challenge = async (boss: RaidBossDef) => {
    setChallengingId(boss.id);
    setChallengeErrors((prev) => ({ ...prev, [boss.id]: null }));
    try {
      await store.startRaidBattle(boss);
    } catch (e) {
      setChallengeErrors((prev) => ({ ...prev, [boss.id]: e }));
    } finally {
      setChallengingId(null);
    }
  };

  if (loading && bosses.length === 0) {
    return (
      <div className="state-box" role="status" aria-live="polite">
        <div className="spinner" />
        <div className="muted">レイド情報を取得しています…</div>
      </div>
    );
  }

  if (loadError && bosses.length === 0) {
    return (
      <Panel title="RAID" jp="巨大ボスへの挑戦">
        <div className="error-box">
          <h3>{describeError(loadError).title}</h3>
          <div className="muted">{describeError(loadError).detail}</div>
          <div className="muted" style={{ fontSize: 11 }}>
            サーバの /api/raid がまだ未実装の可能性があります。設定画面のモックモード(または URL に ?mock=1)でデモを確認できます。
          </div>
          <button className="btn btn-primary" onClick={() => void load()}>再試行する</button>
        </div>
      </Panel>
    );
  }

  return (
    <div className="stack">
      <Panel
        title="RAID"
        jp="巨大な共有HPを持つボス — 何度も挑んで少しずつ削っていく"
        right={<button className="btn btn-sm btn-ghost" onClick={() => void load()}>更新</button>}
      >
        {partyCount === 0 && (
          <div className="error-box" style={{ marginBottom: 12 }}>
            <h3>パーティが空です</h3>
            <div className="muted">編成画面でキャラクターをセットしてください。</div>
            <button className="btn" onClick={() => store.navigate('PARTY')}>編成へ</button>
          </div>
        )}

        {bosses.length === 0 ? (
          <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
            現在挑戦可能なレイドボスはいません。
          </div>
        ) : (
          <div className="stack" style={{ gap: 16 }}>
            {bosses.map((boss) => {
              const state = states[boss.id] ?? {
                bossId: boss.id, remainingHp: boss.totalHp, totalHp: boss.totalHp,
                attempts: 0, totalDamage: 0, defeated: false, triggeredGimmicks: [],
              };
              return (
                <BossCard
                  key={boss.id}
                  boss={boss}
                  state={state}
                  challenging={challengingId === boss.id}
                  canChallenge={partyCount > 0}
                  error={challengeErrors[boss.id]}
                  onChallenge={() => void challenge(boss)}
                />
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

export default RaidScreen;
