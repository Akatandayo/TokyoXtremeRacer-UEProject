/** SETTINGS: 戦闘速度・演出・ログ量・デモモード */
import React from 'react';
import { useStore } from '../state/store';
import { Panel } from '../components/common';
import { prefersReducedMotion, type BattleSpeed } from '../state/settings';
import { isMockMode, reloadWithMock } from '../api/mode';

function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: string }): JSX.Element {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="switch-track" />
      <span className="muted" style={{ fontSize: 11 }}>{label}</span>
    </label>
  );
}

export function SettingsScreen(): JSX.Element {
  const store = useStore();
  const s = store.settings;
  const reduced = prefersReducedMotion();

  return (
    <div className="stack">
      <Panel title="BATTLE" jp="戦闘の既定設定">
        <div className="settings-row">
          <div>
            <div className="label">戦闘速度の既定値</div>
            <div className="hint">戦闘画面でも 1x / 2x / 4x に切り替えられます。</div>
          </div>
          <div className="seg">
            {([1, 2, 4] as BattleSpeed[]).map((v) => (
              <button
                key={v}
                className={s.speed === v ? 'is-on' : ''}
                onClick={() => store.updateSettings({ speed: v })}
              >
                {v}x
              </button>
            ))}
          </div>
        </div>

        <div className="settings-row">
          <div>
            <div className="label">軽量モード</div>
            <div className="hint">
              カットイン・画面揺れ・パーティクルを抑えます。動作が重い環境向け。
              {reduced && ' (OSの「視差効果を減らす」が有効なため、自動的に軽量化されています)'}
            </div>
          </div>
          <Switch checked={s.lightMode} onChange={(v) => store.updateSettings({ lightMode: v })} label={s.lightMode ? 'ON' : 'OFF'} />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">ダメージ数値の表示</div>
            <div className="hint">ダメージ / 回復 / 状態異常のポップアップ。</div>
          </div>
          <Switch checked={s.damageNumbers} onChange={(v) => store.updateSettings({ damageNumbers: v })} label={s.damageNumbers ? 'ON' : 'OFF'} />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">スキルカットイン</div>
            <div className="hint">必殺技 / 覚醒 / コンボの全画面演出。</div>
          </div>
          <Switch checked={s.cutIn} onChange={(v) => store.updateSettings({ cutIn: v })} label={s.cutIn ? 'ON' : 'OFF'} />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">画面揺れ</div>
            <div className="hint">会心・必殺・撃破時の画面シェイク。</div>
          </div>
          <Switch checked={s.screenShake} onChange={(v) => store.updateSettings({ screenShake: v })} label={s.screenShake ? 'ON' : 'OFF'} />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">バトルログの表示行数</div>
            <div className="hint">古い行から順に破棄されます ({s.logLines} 行)。</div>
          </div>
          <input
            type="range"
            min={10}
            max={200}
            step={10}
            value={s.logLines}
            onChange={(e) => store.updateSettings({ logLines: Number(e.target.value) })}
            aria-label="バトルログの表示行数"
          />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">戦闘終了後に自動でリザルトを開く</div>
            <div className="hint">OFF にすると「結果を見る」ボタンで開きます。</div>
          </div>
          <Switch checked={s.autoResult} onChange={(v) => store.updateSettings({ autoResult: v })} label={s.autoResult ? 'ON' : 'OFF'} />
        </div>
      </Panel>

      <Panel title="AUDIO" jp="BGM・効果音">
        <div className="settings-row">
          <div>
            <div className="label">ミュート</div>
            <div className="hint">BGM・効果音をすべて消音します。</div>
          </div>
          <Switch checked={s.audioMuted} onChange={(v) => store.updateSettings({ audioMuted: v })} label={s.audioMuted ? 'ON' : 'OFF'} />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">BGM音量</div>
            <div className="hint">現在 {Math.round(s.bgmVolume * 100)}%</div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.bgmVolume * 100)}
            onChange={(e) => store.updateSettings({ bgmVolume: Number(e.target.value) / 100 })}
            aria-label="BGM音量"
          />
        </div>

        <div className="settings-row">
          <div>
            <div className="label">効果音音量</div>
            <div className="hint">現在 {Math.round(s.sfxVolume * 100)}%</div>
          </div>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={Math.round(s.sfxVolume * 100)}
            onChange={(e) => store.updateSettings({ sfxVolume: Number(e.target.value) / 100 })}
            aria-label="効果音音量"
          />
        </div>

        <div className="muted" style={{ fontSize: 11 }}>
          ブラウザの自動再生制限により、画面のどこかを一度クリック/タップするまで音は鳴りません。
        </div>
      </Panel>

      <Panel title="DEMO" jp="モックモード (サーバ不要のデモ)">
        <div className="settings-row">
          <div>
            <div className="label">モックモード</div>
            <div className="hint">
              バックエンドを使わず、クライアント内蔵のダミーデータで全画面と戦闘演出を再生します。
              URLに <code>?mock=1</code> を付けても有効になります。切り替えにはリロードが必要です。
            </div>
          </div>
          <button
            className={`btn ${isMockMode() ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => reloadWithMock(!isMockMode())}
          >
            {isMockMode() ? 'モックモードを終了' : 'モックモードで再読み込み'}
          </button>
        </div>
        <div className="settings-row">
          <div>
            <div className="label">現在の接続先</div>
            <div className="hint">{isMockMode() ? 'クライアント内蔵モック (サーバ未使用)' : '/api → http://localhost:8787'}</div>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => void store.reload()}>データを再取得</button>
        </div>
      </Panel>
    </div>
  );
}

export default SettingsScreen;
