import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './state/store';
import App from './App';
import './styles/base.css';
import './styles/ui.css';
import './styles/battle.css';
import './styles/gacha.css';
import './styles/rebirth.css';
import './styles/raid.css';
import './styles/pvp.css';

const el = document.getElementById('root');
if (!el) {
  throw new Error('#root が見つかりません');
}

/**
 * StrictMode は使わない: 開発時の二重実行で戦闘イベントが二度適用され、
 * ログ/演出が重複して見えるため(状態自体は snapshot で復元されるが紛らわしい)。
 */
createRoot(el).render(
  <StoreProvider>
    <App />
  </StoreProvider>,
);
