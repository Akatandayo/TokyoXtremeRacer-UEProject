/** 汎用UIパーツ */
import React from 'react';
import type { CharacterView, Element, Role, Rarity, Stats } from '@akatan/shared';
import { describeError } from '../api/client';
import {
  ELEMENT_LABEL, ROLE_LABEL, ROLE_FULL, STAT_LABEL, statPower, formatNumber,
} from '../utils/labels';
import { CharacterArtView } from './CharacterArt';

export function Loading({ label = '読み込み中…' }: { label?: string }): JSX.Element {
  return (
    <div className="state-box" role="status" aria-live="polite">
      <div className="spinner" />
      <div className="muted" style={{ letterSpacing: '0.2em' }}>{label}</div>
    </div>
  );
}

export function ErrorView({
  error, onRetry, hint,
}: { error: unknown; onRetry?: () => void; hint?: string }): JSX.Element {
  const info = describeError(error);
  return (
    <div className="error-box" role="alert">
      <h3>{info.title}</h3>
      <div className="muted" style={{ maxWidth: 520 }}>{info.detail}</div>
      {hint && <div className="muted" style={{ fontSize: 11 }}>{hint}</div>}
      <div className="error-code">CODE: {info.code}</div>
      {onRetry && (
        <button className="btn btn-primary" onClick={onRetry}>再試行する</button>
      )}
    </div>
  );
}

export function ElementChip({ element }: { element: Element }): JSX.Element {
  return (
    <span
      className="el-chip"
      style={{ ['--el-color' as string]: `var(--el-${element})` }}
      title={`属性: ${ELEMENT_LABEL[element]}`}
    >
      {ELEMENT_LABEL[element]}
    </span>
  );
}

export function RoleChips({ roles }: { roles: Role[] }): JSX.Element {
  return (
    <>
      {roles.map((r) => (
        <span className="role-chip" key={r} title={ROLE_FULL[r]}>{ROLE_LABEL[r]}</span>
      ))}
    </>
  );
}

export function RarityBadge({ rarity }: { rarity: Rarity }): JSX.Element {
  return <span className={`rar-badge rar-${rarity}`}>{rarity}</span>;
}

export interface CharacterCardProps {
  view: CharacterView;
  onClick?: () => void;
  selected?: boolean;
  dimmed?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragEnd?: (e: React.DragEvent) => void;
  footer?: React.ReactNode;
}

export function CharacterCard({
  view, onClick, selected, dimmed, draggable, onDragStart, onDragEnd, footer,
}: CharacterCardProps): JSX.Element {
  const { def, owned, stats } = view;
  return (
    <button
      type="button"
      className={[
        'char-card',
        `rar-${def.rarity}`,
        selected ? 'is-selected' : '',
        dimmed ? 'is-in-party' : '',
      ].filter(Boolean).join(' ')}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      aria-label={`${def.name} Lv${owned.level} ${def.rarity}`}
    >
      <CharacterArtView
        art={def.art}
        name={def.name}
        element={def.element}
        rarity={def.rarity}
        ratio="portrait"
      />
      <div className="char-card-body">
        <div className="char-card-name">{def.name}</div>
        <div className="char-card-meta">
          <ElementChip element={def.element} />
          <RoleChips roles={def.roles} />
          <span style={{ marginLeft: 'auto' }}>Lv{owned.level}</span>
          {owned.rebirth > 0 && <span style={{ color: 'var(--gold)' }}>★{owned.rebirth}</span>}
        </div>
        <div className="char-card-power">戦力 {formatNumber(statPower(stats))}</div>
        {footer}
      </div>
    </button>
  );
}

const BAR_MAX: Partial<Record<keyof Stats, number>> = {
  hp: 4000, attack: 420, defense: 400, speed: 220, critical: 60,
  criticalDamage: 260, resistance: 80, healing: 200,
};

export function StatRow({ k, value }: { k: keyof Stats; value: number }): JSX.Element {
  const max = BAR_MAX[k] ?? 100;
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="stat-row">
      <span className="label">{STAT_LABEL[k]}</span>
      <span className="stat-bar"><span style={{ width: `${pct}%` }} /></span>
      <span className="value">{formatNumber(value)}{k === 'critical' || k === 'criticalDamage' || k === 'resistance' || k === 'healing' ? '%' : ''}</span>
    </div>
  );
}

export function Panel({
  title, jp, right, children, className = '',
}: {
  title: string; jp?: string; right?: React.ReactNode;
  children: React.ReactNode; className?: string;
}): JSX.Element {
  return (
    <section className={`panel ${className}`}>
      <h2 className="section-title">
        {title}
        {jp && <span className="jp">{jp}</span>}
        <span className="spacer" />
        {right}
      </h2>
      {children}
    </section>
  );
}
