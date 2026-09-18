/** HOME: プレイヤー情報・導線・最近の戦闘結果 */
import React, { useMemo } from 'react';
import type { CharacterDef } from '@akatan/shared';
import { useStore, type Screen } from '../state/store';
import { Panel } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { formatNumber, statPower, averageLevel, levelReadiness } from '../utils/labels';
import { combosOf, evaluateCombos, buildPlannedMap } from '../utils/combo';

const NAV_CARDS: { screen: Screen; icon: string; title: string; desc: string }[] = [
  { screen: 'CHARACTERS', icon: '⛩', title: 'キャラクター', desc: '所持探索者の確認と育成' },
  { screen: 'PARTY', icon: '⚔', title: '編成', desc: '5人パーティを組む' },
  { screen: 'EQUIPMENT', icon: '🛡', title: '装備', desc: '所持装備の管理と装着' },
  { screen: 'GACHA', icon: '✨', title: 'SUMMON', desc: '召喚で探索者/装備を入手' },
  { screen: 'DUNGEON', icon: '🗺', title: 'ダンジョン', desc: 'ステージに挑戦する' },
  { screen: 'COLLECTION', icon: '📖', title: '図鑑', desc: 'キャラと敵の一覧' },
  { screen: 'SETTINGS', icon: '⚙', title: '設定', desc: '戦闘速度・演出設定' },
];

export function HomeScreen(): JSX.Element {
  const store = useStore();
  const { player, characters, party, chapters, clearedStages, recent } = store;

  const partySlots = useMemo(
    () => (party?.members ?? []).map((uid) => (uid ? characters.find((x) => x.owned.uid === uid) : undefined)),
    [party, characters],
  );
  const partyViews = useMemo(
    () => partySlots.filter((c): c is NonNullable<typeof c> => !!c),
    [partySlots],
  );

  const partyPower = useMemo(
    () => partyViews.reduce((sum, c) => sum + statPower(c.stats), 0),
    [partyViews],
  );
  const partyAvgLevel = useMemo(() => averageLevel(partyViews), [partyViews]);

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

  const nextStageReadiness = nextStage
    ? levelReadiness(partyAvgLevel, nextStage.stage.recommendedLevel)
    : null;

  // P0-4: 現在の編成で成立している/惜しいコンボ(HOMEでも研究状況が一目で分かるように)
  const charDefById = useMemo(() => {
    const m = new Map<string, CharacterDef>();
    for (const d of store.master?.characters ?? []) m.set(d.id, d);
    return m;
  }, [store.master]);
  const comboDefs = combosOf(store.master);
  const plannedById = useMemo(() => buildPlannedMap(store.master), [store.master]);
  const comboMatches = useMemo(
    () => evaluateCombos(comboDefs, partyViews.map((c) => c.def.id), charDefById, plannedById),
    [comboDefs, partyViews, charDefById, plannedById],
  );
  const activeCombos = comboMatches.filter((m) => m.state === 'active');
  const almostCombos = comboMatches.filter((m) => m.state === 'almost');

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
          <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
            <span className="muted">次の目標:</span>
            <b>{nextStage.chapter.name} — {nextStage.stage.name}</b>
            {nextStageReadiness && nextStageReadiness.label && (
              <span className={nextStageReadiness.cls} style={{ fontSize: 12 }}>
                (推奨Lv {nextStage.stage.recommendedLevel} ・ {nextStageReadiness.label})
              </span>
            )}
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

      <div className="home-grid">
        <Panel
          title="PARTY"
          jp={`現在の編成 ー 平均Lv ${partyAvgLevel > 0 ? partyAvgLevel.toFixed(1) : '-'} / 戦力 ${formatNumber(partyPower)}`}
          right={<button className="btn btn-sm btn-ghost" onClick={() => store.navigate('PARTY')}>編成を変更</button>}
        >
          <div className="home-party-preview">
            {partySlots.map((c, i) => (
              <div key={i} className="home-party-slot" title={c ? `${c.def.name} Lv${c.owned.level}` : '空き枠'}>
                {c ? (
                  <CharacterArtView
                    art={c.def.art}
                    name={c.def.name}
                    element={c.def.element}
                    rarity={c.def.rarity}
                    ratio="square"
                    sigilScale={0.6}
                    hideBadges
                  />
                ) : (
                  <span className="muted" style={{ fontSize: 10 }}>空き</span>
                )}
              </div>
            ))}
          </div>
        </Panel>

        <Panel
          title="COMBO"
          jp="発動コンボの研究状況"
          right={<button className="btn btn-sm btn-ghost" onClick={() => store.navigate('PARTY')}>編成へ</button>}
        >
          {comboDefs.length === 0 ? (
            <div className="muted" style={{ fontSize: 12 }}>コンボデータを準備中です。</div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="muted" style={{ fontSize: 11 }}>発動中のコンボ</span>
                <b style={{ color: activeCombos.length > 0 ? 'var(--magenta)' : 'var(--text-mid)' }}>
                  {activeCombos.length}
                </b>
              </div>
              {activeCombos.length > 0 ? (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {activeCombos.map((m) => (
                    <span key={m.def.id} className="combo-member">{m.def.name}</span>
                  ))}
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 11.5 }}>
                  今の編成では発動していません。編成画面でキャラの組み合わせを見直しましょう。
                </div>
              )}
              {almostCombos.length > 0 && (
                <div className="muted" style={{ fontSize: 11 }}>
                  もう少し: {almostCombos[0]!.def.name} — {almostCombos[0]!.missingNote}
                </div>
              )}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

export default HomeScreen;
