/** CHARACTER DETAIL: 設計書 §39 のキャラ詳細 */
import React, { useEffect, useMemo, useState } from 'react';
import type { CharacterDef, Skill, StatKey, EquipmentSlot } from '@akatan/shared';
import { useStore } from '../state/store';
import { describeError } from '../api/client';
import { CharacterArtView } from '../components/CharacterArt';
import { ElementChip, RoleChips, StatRow, Panel } from '../components/common';
import {
  SKILL_KIND_LABEL, targetText, awakenConditionText, statPower, formatNumber,
  STAT_LABEL, ELEMENT_LABEL, ROLE_FULL, COMBO_KIND_LABEL,
  EQUIPMENT_SLOT_LABEL, EQUIPMENT_SLOT_ICON, ITEM_RARITY_LABEL,
} from '../utils/labels';
import { combosOf, evaluateCombo, buildPlannedMap, comboMemberName } from '../utils/combo';
import { equipmentOf } from '../utils/equipment';
import {
  REBIRTH_PATH_ORDER, REBIRTH_PATH_LABEL, computePathPoints, pathColorVar,
} from '../utils/rebirth';

const SHOWN_STATS: StatKey[] = ['hp', 'attack', 'defense', 'speed', 'critical', 'criticalDamage', 'resistance', 'healing'];
const EQUIP_SLOTS: EquipmentSlot[] = ['WEAPON', 'ARMOR', 'ACCESSORY'];

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
  // P1-5: playerSelectable フラグを優先。データ移行中で誰も付いていない場合のみ、
  // 旧来のID接頭辞判定(敵/ボス専用AIの除外)にフォールバックする。
  const anyFlagged = allProfiles.some((p) => typeof p.playerSelectable === 'boolean');
  const profiles = anyFlagged
    ? allProfiles.filter((p) => p.playerSelectable === true)
    : allProfiles.filter((p) => !/^ai_(en|boss)_/i.test(p.id));
  const ownProfiles = profiles.filter((p) => p.id.includes(def.id));
  const otherProfiles = profiles.filter((p) => !p.id.includes(def.id));
  const currentAi = owned.aiProfile ?? def.defaultAi;
  const aiDesc = allProfiles.find((p) => p.id === currentAi)?.description;
  const known = profiles.some((p) => p.id === currentAi);

  // P0-4(a): コンボ一覧を ID 文字列表示から実際の定義(名前/説明/参加キャラ)へ差し替える
  const comboDefs = combosOf(store.master);
  const charDefById = useMemo(() => {
    const m = new Map<string, CharacterDef>();
    for (const d of store.master?.characters ?? []) m.set(d.id, d);
    return m;
  }, [store.master]);
  const plannedById = useMemo(() => buildPlannedMap(store.master), [store.master]);
  const currentPartyDefIds = useMemo(
    () =>
      (store.party?.members ?? [])
        .map((uid) => (uid ? store.characters.find((c) => c.owned.uid === uid)?.def.id : undefined))
        .filter((id): id is string => !!id),
    [store.party, store.characters],
  );

  // P4-1(§17〜§20): 転生の系統別投資量。rebirthNodes(ノードID→ランク)から逆算する。
  // フルの RebirthStatus(canRebirth 等)は転生画面でのみ取得し、ここでは既に
  // 持っている情報(owned.rebirthNodes / rebirthPointsAvailable / master.rebirthNodes)だけで
  // 表示できるようにして、キャラ一覧・詳細では余計なAPI呼び出しを増やさない。
  const rebirthPathPoints = useMemo(
    () => computePathPoints(owned.rebirthNodes, store.master?.rebirthNodes),
    [owned.rebirthNodes, store.master],
  );
  const rebirthPointsAvailable = owned.rebirthPointsAvailable ?? 0;
  const rebirthConfig = store.master?.rebirthConfig;
  const growthBonusPercent = rebirthConfig ? owned.rebirth * rebirthConfig.growthBonusPercent : undefined;
  const maxPathPoint = Math.max(1, ...REBIRTH_PATH_ORDER.map((p) => rebirthPathPoints[p]));
  const hasAnyRebirthInvestment = REBIRTH_PATH_ORDER.some((p) => rebirthPathPoints[p] > 0);

  // 装備スロット表示用: 所持品(inventory)が未取得なら取りに行く
  useEffect(() => {
    if (store.inventory) return;
    void store.refreshInventory().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChangeAi = async (id: string) => {
    setSaving(true);
    setAiError(null);
    try {
      await store.setAi(owned.uid, id);
    } catch (e) {
      // サーバは playerSelectable !== true のAIプロファイル(敵/ボス専用)を
      // BAD_REQUEST で拒否する。クライアント側の絞り込みをすり抜けた場合の保険。
      setAiError(describeError(e).detail);
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

          <Panel
            title="EQUIPMENT"
            jp="装備"
            right={<button className="btn btn-sm btn-primary" onClick={() => store.navigate('EQUIPMENT', undefined, owned.uid)}>装備を変更 →</button>}
          >
            <div className="stack" style={{ gap: 7 }}>
              {EQUIP_SLOTS.map((slot) => {
                const uid = owned.equipment?.[slot];
                const item = uid ? equipmentOf(store.inventory, uid) : undefined;
                return (
                  <div key={slot} className={`detail-equip-slot ${item ? `irar-${item.rarity}` : 'is-empty'}`}>
                    <span className="slot-ic">{EQUIPMENT_SLOT_ICON[slot]}</span>
                    <div className="detail-equip-body">
                      <div className="k">{EQUIPMENT_SLOT_LABEL[slot]}</div>
                      {item ? (
                        <>
                          <div className="nm">{item.name}</div>
                          <div className="muted" style={{ fontSize: 10.5 }}>
                            {ITEM_RARITY_LABEL[item.rarity]} / Lv{item.itemLevel}
                          </div>
                        </>
                      ) : (
                        <div className="muted">未装着</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel
            title="REBIRTH"
            jp="転生 — 長期育成でビルドを分ける(§17〜§20)"
            right={
              <button className="btn btn-sm btn-primary" onClick={() => store.navigate('REBIRTH', owned.uid)}>
                転生ツリーを開く →
              </button>
            }
          >
            <div className="row" style={{ gap: 14, fontSize: 12 }}>
              <span>転生 <b style={{ fontSize: 16, color: 'var(--gold)' }}>★{owned.rebirth}</b></span>
              {growthBonusPercent !== undefined && (
                <span>成長率 <b style={{ color: 'var(--ok)' }}>+{growthBonusPercent}%</b></span>
              )}
              {rebirthPointsAvailable > 0 && (
                <span className="rebirth-unused-pip">未使用ポイント {rebirthPointsAvailable}</span>
              )}
            </div>
            <div className="stack" style={{ gap: 6, marginTop: 10 }}>
              {REBIRTH_PATH_ORDER.map((p) => (
                <div key={p} className="path-row">
                  <span className="path-row-label" style={{ color: pathColorVar(p) }}>{REBIRTH_PATH_LABEL[p]}</span>
                  <span className="path-row-bar">
                    <span style={{ width: `${Math.min(100, (rebirthPathPoints[p] / maxPathPoint) * 100)}%`, background: pathColorVar(p) }} />
                  </span>
                  <span className="path-row-value">{rebirthPathPoints[p]}</span>
                </div>
              ))}
            </div>
            {!hasAnyRebirthInvestment && (
              <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>
                まだ転生ポイントを振っていません。同じキャラでも系統を選べば違う育ち方になります。
              </div>
            )}
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
            <Panel title="AWAKENING" jp="覚醒 — 戦闘中だけの特殊状態(§20。転生とは役割が別)">
              <div className="awaken-box">
                <div style={{ fontWeight: 800, color: 'var(--gold)', fontSize: 15 }}>
                  {def.awakening.name}
                </div>
                <div className="muted" style={{ fontSize: 10.5, marginTop: 2 }}>
                  条件を満たした戦闘中のみ発動し、その戦闘が終われば元に戻る。
                  レベルや育成には影響しない一時的な強化(転生=恒久的な育成、とは別物)。
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
                {def.combos.map((cid) => {
                  const cd = comboDefs.find((c) => c.id === cid);
                  if (!cd) {
                    return (
                      <div key={cid} className="skill-card">
                        <div className="head">
                          <span className="kind kind-ULTIMATE">COMBO</span>
                          <span className="name">{cid}</span>
                        </div>
                        <div className="desc muted">
                          このコンボの定義はまだ読み込まれていません(データ側の対応待ち)。
                        </div>
                      </div>
                    );
                  }
                  const match = evaluateCombo(cd, currentPartyDefIds, charDefById, plannedById);
                  const memberNames = (cd.members ?? []).map((m) => comboMemberName(m, charDefById, plannedById));
                  return (
                    <div key={cid} className="skill-card">
                      <div className="head">
                        <span className="kind kind-ULTIMATE">{COMBO_KIND_LABEL[cd.kind]}</span>
                        <span className="name">{cd.name}</span>
                        {match?.state === 'active' && (
                          <span className="tag" style={{ color: 'var(--ok)' }}>現在の編成で発動中</span>
                        )}
                      </div>
                      <div className="desc">{cd.description}</div>
                      <div className="foot">
                        {memberNames.length > 0 && <span>参加: {memberNames.join(' / ')}</span>}
                        {cd.requireTag && <span>条件: 「{cd.requireTag.tag}」タグ×{cd.requireTag.count}</span>}
                        {cd.requireAllElement && <span>条件: 全員が{ELEMENT_LABEL[cd.requireAllElement]}属性</span>}
                      </div>
                    </div>
                  );
                })}
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
