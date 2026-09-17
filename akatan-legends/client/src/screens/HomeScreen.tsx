/** HOME: プレイヤー情報・導線・最近の戦闘結果 */
import React, { useMemo } from 'react';
import { useStore, type Screen } from '../state/store';
import { Panel } from '../components/common';
import { formatNumber, statPower } from '../utils/labels';

const NAV_CARDS: { screen: Screen; icon: string; title: string; desc: string }[] = [
  { screen: 'CHARACTERS', icon: '⛩', title: 'キャラクター', desc: '所持探索者の確認と育成' },
  { screen: 'PARTY', icon: '⚔', title: '編成', desc: '5人パーティを組む' },
  { screen: 'DUNGEON', icon: '🗺', title: 'ダンジョン', desc: 'ステージに挑戦する' },
  { screen: 'COLLECTION', icon: '📖', title: '図鑑', desc: 'キャラと敵の一覧' },
  { screen: 'SETTINGS', icon: '⚙', title: '設定', desc: '戦闘速度・演出設定' },
];

export function HomeScreen(): JSX.Element {
  const store = useStore();
  const { player, characters, party, chapters, clearedStages, recent } = store;

  const partyPower = useMemo(() => {
    if (!party) return 0;
    return party.members.reduce((sum, uid) => {
      const c = characters.find((x) => x.owned.uid === uid);
      return sum + (c ? statPower(c.stats) : 0);
    }, 0);
  }, [party, characters]);

  const totalStages = useMemo(
    () => chapters.reduce((n, c) => n + c.stages.length, 0),
    [chapters],
  );

  const nextStage = useMemo(() => {
    for (const c of chapters) {
      for (const s of c.stages) {
        if (!clearedStages.includes(s.id)) return { chapter: c, stage: s };
      }
    }
    return null;
  }, [chapters, clearedStages]);

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="hero-panel">
        <h1 className="hero-title">
          {player?.name ?? '探索者'}
          <small>AKATAN LEGENDS / 身内TRPG探索者カードバトル</small>
        </h1>
        <div className="kpi-row">
          <div className="kpi">
            <div className="k">GOLD</div>
            <div className="v" style={{ color: 'var(--gold)' }}>{formatNumber(player?.gold ?? 0)}</div>
          </div>
          <div className="kpi">
            <div className="k">CHARACTERS</div>
            <div className="v">{characters.length}</div>
          </div>
          <div className="kpi">
            <div className="k">PARTY POWER</div>
            <div className="v" style={{ color: 'var(--cyan)' }}>{formatNumber(partyPower)}</div>
          </div>
          <div className="kpi">
            <div className="k">PROGRESS</div>
            <div className="v">
              {clearedStages.length}<span className="muted" style={{ fontSize: 14 }}> / {totalStages}</span>
            </div>
          </div>
        </div>
        {nextStage && (
          <div className="row" style={{ marginTop: 14 }}>
            <span className="muted">次の目標:</span>
            <b>{nextStage.chapter.name} — {nextStage.stage.name}</b>
            <button className="btn btn-primary btn-sm" onClick={() => store.navigate('DUNGEON')}>
              挑戦する
            </button>
          </div>
        )}
      </div>

      <div className="home-grid">
        <Panel title="MENU" jp="各画面へ">
          <div className="nav-cards">
            {NAV_CARDS.map((c) => (
              <button key={c.screen} className="nav-card" onClick={() => store.navigate(c.screen)}>
                <div className="icon">{c.icon}</div>
                <div className="t">{c.title}</div>
                <div className="d">{c.desc}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="RECENT BATTLES" jp="最近の戦闘結果">
          {recent.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>
              まだ戦闘記録がありません。ダンジョンに挑戦してみましょう。
            </div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {recent.map((r) => (
                <div key={r.id + r.at} className={`recent-item ${r.victory ? 'win' : 'lose'}`}>
                  <span className="res">{r.victory ? 'WIN' : 'LOSE'}</span>
                  <span>
                    <b>{r.stageName || r.stageId}</b>
                    <span className="muted" style={{ marginLeft: 8, fontSize: 11 }}>
                      {r.turns}ターン / MVP {r.mvpName}
                    </span>
                  </span>
                  <span className="muted tabular" style={{ fontSize: 11 }}>
                    +{formatNumber(r.exp)}EXP / +{formatNumber(r.gold)}G
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default HomeScreen;
