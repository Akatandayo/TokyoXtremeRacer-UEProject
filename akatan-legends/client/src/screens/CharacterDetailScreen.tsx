/** CHARACTER DETAIL: 設計書 §39 のキャラ詳細 */
import React, { useMemo, useState } from 'react';
import type { Skill, StatKey } from '@akatan/shared';
import { useStore } from '../state/store';
import { CharacterArtView } from '../components/CharacterArt';
import { ElementChip, RoleChips, StatRow, Panel } from '../components/common';
import {
  SKILL_KIND_LABEL, targetText, awakenConditionText, statPower, formatNumber,
  STAT_LABEL, ELEMENT_LABEL, ROLE_FULL,
} from '../utils/labels';

const SHOWN_STATS: StatKey[] = ['hp', 'attack', 'defense', 'speed', 'critical', 'criticalDamage', 'resistance', 'healing'];

function SkillCard({ skill, label }: { skill: Skill; label?: string }): JSX.Element {
  return (
    <div className="skill-card">
      <div className="head">
        <span className={`kind kind-${skill.kind}`}>{label ?? SKILL_KIND_LABEL[skill.kind]}</span>
        <span className="name">{skill.name}</span>
      </div>
      <div className="desc">{skill.description}</div>
      <div className="foot">
        <span>対象: {targetText(skill.target.side, skill.target.pattern, skill.target.count)}</span>
        {skill.cooldown > 0 && <span>CT: {skill.cooldown}ターン</span>}
        {skill.ultCost !== undefined && <span>必殺ゲージ: {skill.ultCost}</span>}
        {skill.fx && <span className="muted">fx: {skill.fx}</span>}
      </div>
    </div>
  );
}

export function CharacterDetailScreen(): JSX.Element {
  const store = useStore();
  const uid = store.route.charUid;
  const view = useMemo(
    () => store.characters.find((c) => c.owned.uid === uid),
    [store.characters, uid],
  );
  const [saving, setSaving] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  if (!view) {
    return (
      <div className="state-box">
        <div className="muted">キャラクターが見つかりませんでした。</div>
        <button className="btn" onClick={() => store.navigate('CHARACTERS')}>一覧へ戻る</button>
      </div>
    );
  }

  const { def, owned, stats, skills, normalAttack, ultimate, expToNext } = view;
  const allProfiles = store.master?.aiProfiles ?? [];
  // 敵/ボス専用AIはプレイヤーが選べないように除外する
  const profiles = allProfiles.filter((p) => !/^ai_(en|boss)_/i.test(p.id));
  const ownProfiles = profiles.filter((p) => p.id.includes(def.id));
  const otherProfiles = profiles.filter((p) => !p.id.includes(def.id));
  const currentAi = owned.aiProfile ?? def.defaultAi;
  const aiDesc = allProfiles.find((p) => p.id === currentAi)?.description;
  const known = profiles.some((p) => p.id === currentAi);

  const onChangeAi = async (id: string) => {
    setSaving(true);
    setAiError(null);
    try {
      await store.setAi(owned.uid, id);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-sm btn-ghost" onClick={() => store.navigate('CHARACTERS')}>← 一覧へ</button>
        <span className="muted" style={{ fontSize: 11 }}>{def.title}</span>
      </div>

      <div className="detail-grid">
        <div className="stack">
          <div className={`panel rar-${def.rarity}`} style={{ padding: 10 }}>
            <CharacterArtView
              art={def.art}
              name={def.name}
              element={def.element}
              rarity={def.rarity}
              ratio="portrait"
              sigilScale={1.8}
            />
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 19, fontWeight: 800 }}>{def.name}</div>
              <div className="row" style={{ gap: 6, marginTop: 6 }}>
                <span className={`rar-badge rar-${def.rarity}`}>{def.rarity}</span>
                <ElementChip element={def.element} />
                <RoleChips roles={def.roles} />
              </div>
              <div className="row" style={{ gap: 14, marginTop: 10, fontSize: 12 }}>
                <span>Lv <b style={{ fontSize: 17 }}>{owned.level}</b></span>
                <span>転生 <b style={{ fontSize: 17, color: 'var(--gold)' }}>{owned.rebirth}</b>回</span>
                <span className="muted">次のLvまで {formatNumber(expToNext)} EXP</span>
              </div>
              <div style={{ marginTop: 8, color: 'var(--gold)', fontWeight: 800 }}>
                戦力 {formatNumber(statPower(stats))}
              </div>
            </div>
          </div>

          <Panel title="TACTICS" jp="AI戦術">
            <select
              value={currentAi}
              disabled={saving || profiles.length === 0}
              onChange={(e) => void onChangeAi(e.target.value)}
              style={{ width: '100%' }}
              aria-label="AI戦術の選択"
            >
              {(profiles.length === 0 || !known) && <option value={currentAi}>{currentAi}</option>}
              {ownProfiles.length > 0 && (
                <optgroup label="このキャラの戦術">
                  {ownProfiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}{p.id === def.defaultAi ? '(既定)' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {otherProfiles.length > 0 && (
                <optgroup label="ほかの戦術">
                  {otherProfiles.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
            {aiDesc && <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>{aiDesc}</div>}
            {saving && <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>保存中…</div>}
            {aiError && <div style={{ color: 'var(--danger)', fontSize: 11, marginTop: 6 }}>保存に失敗: {aiError}</div>}
            <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>
              戦闘は完全オート。選んだ戦術に沿ってAIが行動します。
            </div>
          </Panel>
        </div>

        <div className="stack">
          <Panel title="STATUS" jp="ステータス">
            <div className="stack" style={{ gap: 7 }}>
              {SHOWN_STATS.map((k) => (
                <StatRow key={k} k={k} value={stats[k]} />
              ))}
            </div>
          </Panel>

          <Panel title="SKILLS" jp="通常攻撃 / スキル / 必殺技">
            <div className="stack" style={{ gap: 9 }}>
              <SkillCard skill={normalAttack} label="通常攻撃" />
              {skills.map((s) => <SkillCard key={s.id} skill={s} />)}
              <SkillCard skill={ultimate} label="必殺技" />
            </div>
          </Panel>

          {def.awakening && (
            <Panel title="AWAKENING" jp="覚醒">
              <div className="awaken-box">
                <div style={{ fontWeight: 800, color: 'var(--gold)', fontSize: 15 }}>
                  {def.awakening.name}
                </div>
                <div style={{ fontSize: 12.5, marginTop: 4 }}>{def.awakening.description}</div>
                <div style={{ marginTop: 8 }}>
                  <div className="muted" style={{ fontSize: 11, letterSpacing: '0.16em' }}>覚醒条件</div>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 12 }}>
                    {awakenConditionText(def.awakening.condition).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
                {def.awakening.statBonus && (
                  <div className="row" style={{ gap: 8, marginTop: 8, fontSize: 11.5 }}>
                    {Object.entries(def.awakening.statBonus).map(([k, v]) => (
                      <span key={k} style={{ color: 'var(--ok)' }}>
                        {STAT_LABEL[k as StatKey] ?? k} +{v}%
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
          )}

          <Panel title="COMBO" jp="コンボ">
            {def.combos && def.combos.length > 0 ? (
              <div className="stack" style={{ gap: 6 }}>
                {def.combos.map((c) => (
                  <div key={c} className="skill-card">
                    <div className="head">
                      <span className="kind kind-ULTIMATE">COMBO</span>
                      <span className="name">{c}</span>
                    </div>
                    <div className="desc muted">
                      コンボの詳細は Phase 4 で実装予定。戦闘中に COMBO イベントが届けば演出が再生されます。
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted" style={{ fontSize: 12 }}>設定されたコンボはありません。</div>
            )}
          </Panel>

          <Panel title="TRPG PROFILE" jp="探索者設定">
            <div className="trpg-box">
              <div style={{ marginBottom: 8, fontSize: 12.5 }}>{def.description}</div>
              <dl>
                {def.trpg?.source && (<><dt>卓 / 出典</dt><dd>{def.trpg.source}</dd></>)}
                {def.trpg?.player && (<><dt>PL</dt><dd>{def.trpg.player}</dd></>)}
                {def.trpg?.investigator && (<><dt>探索者名</dt><dd>{def.trpg.investigator}</dd></>)}
                {def.trpg?.affiliation && (<><dt>所属</dt><dd>{def.trpg.affiliation}</dd></>)}
                {def.trpg?.visibility && (<><dt>公開範囲</dt><dd>{def.trpg.visibility}</dd></>)}
                <dt>属性 / ロール</dt>
                <dd>{ELEMENT_LABEL[def.element]} / {def.roles.map((r) => ROLE_FULL[r]).join('・')}</dd>
              </dl>
              {def.trpg?.note && (
                <div style={{ marginTop: 8, fontSize: 12, color: 'var(--sakura)' }}>
                  「{def.trpg.note}」
                </div>
              )}
              {def.tags && def.tags.length > 0 && (
                <div className="row" style={{ gap: 5, marginTop: 8 }}>
                  {def.tags.map((t) => (
                    <span key={t} className="tag" style={{ color: 'var(--muted)' }}>#{t}</span>
                  ))}
                </div>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export default CharacterDetailScreen;
