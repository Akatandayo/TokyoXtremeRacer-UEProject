/** DUNGEON: チャプター / ステージ選択と戦闘開始 */
import React, { useMemo, useState } from 'react';
import type { StageDef, EnemyDef } from '@akatan/shared';
import { useStore } from '../state/store';
import { Panel } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { describeError, ApiClientError } from '../api/client';
import { statPower, formatNumber, averageLevel, levelReadiness } from '../utils/labels';

export function DungeonScreen(): JSX.Element {
  const store = useStore();
  const [selected, setSelected] = useState<StageDef | null>(null);
  const [starting, setStarting] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [chapterIdx, setChapterIdx] = useState(0);

  const enemyMap = useMemo(() => {
    const m = new Map<string, EnemyDef>();
    for (const e of store.master?.enemies ?? []) m.set(e.id, e);
    return m;
  }, [store.master]);

  // 全チャプターを通したステージID -> 表示名(unlockAfter の開放条件文言に使う)
  const stageNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of store.chapters) for (const s of c.stages) m.set(s.id, s.name);
    return m;
  }, [store.chapters]);

  const partyViews = useMemo(
    () =>
      (store.party?.members ?? [])
        .map((uid) => (uid ? store.characters.find((x) => x.owned.uid === uid) : undefined))
        .filter((c): c is NonNullable<typeof c> => !!c),
    [store.party, store.characters],
  );

  const partyPower = useMemo(
    () => partyViews.reduce((sum, c) => sum + statPower(c.stats), 0),
    [partyViews],
  );
  const partyAvgLevel = useMemo(() => averageLevel(partyViews), [partyViews]);

  const partyCount = store.party?.members.filter(Boolean).length ?? 0;

  const start = async (stage: StageDef) => {
    // ロック中はボタン自体を無効化しているが、すり抜け対策として二重にガードする
    if (stage.unlockAfter && !store.clearedStages.includes(stage.unlockAfter)) {
      const unlockName = stageNameMap.get(stage.unlockAfter) ?? stage.unlockAfter;
      setErr(new ApiClientError('STAGE_LOCKED', `「${unlockName}」をクリアすると開放されます。`));
      return;
    }
    setStarting(true);
    setErr(null);
    try {
      await store.startBattle(stage.id);
    } catch (e) {
      setErr(e);
    } finally {
      setStarting(false);
    }
  };

  const chapters = store.chapters;
  const chapter = chapters[Math.min(chapterIdx, Math.max(0, chapters.length - 1))];

  if (chapters.length === 0) {
    return (
      <Panel title="DUNGEON" jp="ダンジョン">
        <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
          ダンジョンデータがまだありません。
        </div>
      </Panel>
    );
  }

  return (
    <div className="stack">
      <Panel
        title="DUNGEON"
        jp={`編成 ${partyCount}人 / 平均Lv ${partyAvgLevel > 0 ? partyAvgLevel.toFixed(1) : '-'} / 戦力 ${formatNumber(partyPower)}`}
        right={
          <button className="btn btn-sm btn-ghost" onClick={() => store.navigate('PARTY')}>
            編成を変更
          </button>
        }
      >
        <div className="filter-bar">
          {chapters.map((c, i) => (
            <button
              key={c.id}
              className={`chip-toggle ${i === chapterIdx ? 'is-on' : ''}`}
              onClick={() => { setChapterIdx(i); setSelected(null); }}
            >
              {c.name}
            </button>
          ))}
        </div>

        {chapter?.description && (
          <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>{chapter.description}</div>
        )}

        {partyCount === 0 && (
          <div className="error-box" style={{ marginBottom: 12 }}>
            <h3>パーティが空です</h3>
            <div className="muted">編成画面でキャラクターをセットしてください。</div>
            <button className="btn" onClick={() => store.navigate('PARTY')}>編成へ</button>
          </div>
        )}

        {err !== null && (
          <div className="error-box" style={{ marginBottom: 12 }}>
            <h3>{describeError(err).title}</h3>
            <div className="muted">{describeError(err).detail}</div>
            <div className="error-code">CODE: {describeError(err).code}</div>
          </div>
        )}

        <div className="grid-auto" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(238px, 1fr))' }}>
          {(chapter?.stages ?? []).map((s) => {
            const cleared = store.clearedStages.includes(s.id);
            const locked = !!s.unlockAfter && !store.clearedStages.includes(s.unlockAfter);
            const unlockName = s.unlockAfter ? (stageNameMap.get(s.unlockAfter) ?? s.unlockAfter) : null;
            const rec = s.recommendedLevel ?? 0;
            const { cls, label } = levelReadiness(partyAvgLevel, rec);
            return (
              <div
                key={s.id}
                className={[
                  'stage-card',
                  s.boss ? 'is-boss' : '',
                  selected?.id === s.id ? 'is-selected' : '',
                  locked ? 'is-locked' : '',
                ].filter(Boolean).join(' ')}
                onClick={() => setSelected(s)}
              >
                <div className="stage-head">
                  {locked && <span className="lock-mark" title="未開放" aria-hidden>🔒</span>}
                  {!locked && cleared && <span className="cleared-mark" title="クリア済み">✓</span>}
                  <span className="nm">{s.name}</span>
                  {s.boss && <span className="tag" style={{ color: 'var(--shu)' }}>BOSS</span>}
                </div>
                {s.description && (
                  <div className="muted" style={{ fontSize: 11 }}>{s.description}</div>
                )}
                <div className="stage-enemies">
                  {s.enemies.map((p, i) => {
                    const e = enemyMap.get(p.enemyId);
                    return (
                      <div className="enemy-thumb" key={i} title={`${e?.name ?? p.enemyId} Lv${p.level}`}>
                        <CharacterArtView
                          art={e?.art}
                          name={e?.name ?? p.enemyId}
                          element={e?.element}
                          ratio="square"
                          sigilScale={0.55}
                        />
                      </div>
                    );
                  })}
                </div>
                {locked ? (
                  <div className="lock-note">
                    🔒 「{unlockName}」をクリアすると開放
                  </div>
                ) : (
                  rec > 0 && (
                    <div className="power-compare">
                      <span className="muted">推奨Lv {formatNumber(rec)}</span>
                      <span className={cls}>({label})</span>
                    </div>
                  )
                )}
                <div className="reward-line">
                  <span>EXP <b>{formatNumber(s.rewards.exp)}</b></span>
                  <span>GOLD <b>{formatNumber(s.rewards.gold)}</b></span>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  disabled={starting || partyCount === 0 || locked}
                  onClick={(e) => { e.stopPropagation(); void start(s); }}
                >
                  {locked ? '🔒 未開放' : starting && selected?.id === s.id ? '開始中…' : '⚔ 戦闘開始'}
                </button>
              </div>
            );
          })}
        </div>
      </Panel>
    </div>
  );
}

export default DungeonScreen;
