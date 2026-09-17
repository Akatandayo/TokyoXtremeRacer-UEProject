/**
 * 仮キャラクター画像のプロシージャル描画。
 *
 * 画像アセットが存在しないため、`CharacterArt`(primary/secondary/accent/sigil/pattern)
 * から CSS グラデーション + SVG パターン + 紋章文字 でビジュアルを合成する。
 * pattern の 6種は別々の SVG として描き分ける。
 */
import React, { useId, useMemo } from 'react';
import type { CharacterArt as Art, Element, Rarity } from '@akatan/shared';
import { ELEMENT_LABEL } from '../utils/labels';

export type ArtRatio = 'square' | 'portrait' | 'wide' | 'fill';

export interface CharacterArtProps {
  art?: Art;
  name: string;
  element?: Element;
  rarity?: Rarity;
  /** 図鑑の未入手表示 */
  silhouette?: boolean;
  /** 覚醒オーラ */
  awakened?: boolean;
  ratio?: ArtRatio;
  className?: string;
  /** 紋章の大きさ倍率 */
  sigilScale?: number;
  /**
   * true: 属性/レアリティの角バッジ(cart-element / cart-rarity)を描画しない。
   * 呼び出し側が別のUI(編成枠のヘッダ行など)で同じ情報を出す場合に使う。
   * (角バッジと他要素の絶対配置が重なる問題への対処。PARTY 画面で使用)
   */
  hideBadges?: boolean;
}

const FALLBACK: Art = {
  primary: '#3b4a78',
  secondary: '#0c1020',
  accent: '#7fa8ff',
  sigil: '?',
  pattern: 'grid',
};

/** 文字列から決定論的な擬似乱数 */
function hashSeed(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

interface PatternProps {
  uid: string;
  art: Art;
  seedKey: string;
}

function GridPattern({ uid, art }: PatternProps): JSX.Element {
  return (
    <svg className="cart-svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id={`${uid}-g`} width="15" height="15" patternUnits="userSpaceOnUse">
          <path d="M15 0 H0 V15" fill="none" stroke={art.accent} strokeWidth="0.6" opacity="0.45" />
          <circle cx="0" cy="0" r="1.1" fill={art.accent} opacity="0.7" />
        </pattern>
        <linearGradient id={`${uid}-gf`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.15" />
        </linearGradient>
        <mask id={`${uid}-gm`}>
          <rect width="120" height="160" fill={`url(#${uid}-gf)`} />
        </mask>
      </defs>
      <rect width="120" height="160" fill={`url(#${uid}-g)`} mask={`url(#${uid}-gm)`} />
      <rect x="18" y="28" width="84" height="104" fill="none" stroke={art.accent} strokeWidth="1.2" opacity="0.5" />
      <rect x="24" y="34" width="72" height="92" fill="none" stroke={art.accent} strokeWidth="0.5" opacity="0.32" />
    </svg>
  );
}

function WavePattern({ uid, art }: PatternProps): JSX.Element {
  // 青海波 (和のアクセント)
  return (
    <svg className="cart-svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id={`${uid}-w`} width="24" height="12" patternUnits="userSpaceOnUse">
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M-12 12 a ${12 - i * 2.6} ${12 - i * 2.6} 0 0 1 ${(12 - i * 2.6) * 2} 0`}
              transform={`translate(12 ${i * 0}) translate(0 0)`}
              fill="none"
              stroke={art.accent}
              strokeWidth="0.8"
              opacity={0.5 - i * 0.08}
            />
          ))}
          {[0, 1, 2, 3].map((i) => (
            <path
              key={`b${i}`}
              d={`M12 12 a ${12 - i * 2.6} ${12 - i * 2.6} 0 0 1 ${(12 - i * 2.6) * 2} 0`}
              fill="none"
              stroke={art.accent}
              strokeWidth="0.8"
              opacity={0.5 - i * 0.08}
            />
          ))}
        </pattern>
      </defs>
      <rect width="120" height="160" fill={`url(#${uid}-w)`} />
      <path d="M0 116 Q30 100 60 116 T120 116 V160 H0 Z" fill={art.accent} opacity="0.12" />
      <path d="M0 128 Q30 112 60 128 T120 128 V160 H0 Z" fill={art.accent} opacity="0.1" />
    </svg>
  );
}

function BurstPattern({ uid, art, seedKey }: PatternProps): JSX.Element {
  const rays = useMemo(() => {
    const rnd = hashSeed(seedKey);
    return Array.from({ length: 26 }, (_, i) => ({
      a: (i / 26) * 360 + rnd() * 4,
      w: 1 + rnd() * 3.4,
      len: 70 + rnd() * 60,
      o: 0.1 + rnd() * 0.35,
    }));
  }, [seedKey]);
  return (
    <svg className="cart-svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id={`${uid}-b`}>
          <stop offset="0%" stopColor={art.accent} stopOpacity="0.85" />
          <stop offset="55%" stopColor={art.accent} stopOpacity="0.12" />
          <stop offset="100%" stopColor={art.accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(60 72)">
        {rays.map((r, i) => (
          <rect
            key={i}
            x="0"
            y={-r.w / 2}
            width={r.len}
            height={r.w}
            fill={art.accent}
            opacity={r.o}
            transform={`rotate(${r.a})`}
          />
        ))}
        <circle r="40" fill={`url(#${uid}-b)`} />
        <circle r="30" fill="none" stroke={art.accent} strokeWidth="0.9" opacity="0.6" />
        <circle r="44" fill="none" stroke={art.accent} strokeWidth="0.4" opacity="0.35" strokeDasharray="4 6" />
      </g>
    </svg>
  );
}

function CircuitPattern({ uid, art, seedKey }: PatternProps): JSX.Element {
  const traces = useMemo(() => {
    const rnd = hashSeed(seedKey);
    return Array.from({ length: 14 }, () => {
      const x = Math.round(rnd() * 110) + 5;
      const y = Math.round(rnd() * 150) + 5;
      const dx = rnd() > 0.5 ? 1 : -1;
      const l1 = 10 + Math.round(rnd() * 26);
      const l2 = 8 + Math.round(rnd() * 30);
      return { d: `M${x} ${y} h${l1 * dx} v${l2} h${Math.round(l1 * 0.6) * dx}`, x, y };
    });
  }, [seedKey]);
  return (
    <svg className="cart-svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id={`${uid}-c`} width="10" height="10" patternUnits="userSpaceOnUse">
          <circle cx="5" cy="5" r="0.6" fill={art.accent} opacity="0.3" />
        </pattern>
      </defs>
      <rect width="120" height="160" fill={`url(#${uid}-c)`} />
      {traces.map((t, i) => (
        <g key={i}>
          <path d={t.d} fill="none" stroke={art.accent} strokeWidth="0.9" opacity="0.55" />
          <circle cx={t.x} cy={t.y} r="1.8" fill={art.accent} opacity="0.8" />
        </g>
      ))}
      <rect x="10" y="10" width="100" height="140" fill="none" stroke={art.accent} strokeWidth="0.5" opacity="0.4" strokeDasharray="12 5 3 5" />
    </svg>
  );
}

function PetalPattern({ uid, art, seedKey }: PatternProps): JSX.Element {
  const petals = useMemo(() => {
    const rnd = hashSeed(seedKey);
    return Array.from({ length: 16 }, () => ({
      x: rnd() * 120,
      y: rnd() * 160,
      s: 0.5 + rnd() * 1.1,
      r: rnd() * 360,
      o: 0.18 + rnd() * 0.45,
    }));
  }, [seedKey]);
  const petalPath = 'M0 0 C 4 -5 10 -5 12 0 C 10 5 4 5 0 0 Z';
  return (
    <svg className="cart-svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id={`${uid}-p`}>
          <stop offset="0%" stopColor={art.accent} stopOpacity="0.45" />
          <stop offset="100%" stopColor={art.accent} stopOpacity="0" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="70" r="48" fill={`url(#${uid}-p)`} />
      <g transform="translate(60 70)">
        {[0, 1, 2, 3, 4].map((i) => (
          <path
            key={i}
            d={petalPath}
            fill={art.accent}
            opacity="0.3"
            transform={`rotate(${i * 72}) translate(6 0) scale(2.6)`}
          />
        ))}
        <circle r="4" fill={art.accent} opacity="0.7" />
      </g>
      {petals.map((p, i) => (
        <path
          key={i}
          d={petalPath}
          fill={art.accent}
          opacity={p.o}
          transform={`translate(${p.x} ${p.y}) rotate(${p.r}) scale(${p.s})`}
        />
      ))}
    </svg>
  );
}

function VoidPattern({ uid, art, seedKey }: PatternProps): JSX.Element {
  const dots = useMemo(() => {
    const rnd = hashSeed(seedKey);
    return Array.from({ length: 40 }, () => ({
      x: rnd() * 120,
      y: rnd() * 160,
      r: 0.3 + rnd() * 1.3,
      o: 0.15 + rnd() * 0.6,
    }));
  }, [seedKey]);
  return (
    <svg className="cart-svg" viewBox="0 0 120 160" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <radialGradient id={`${uid}-v`}>
          <stop offset="0%" stopColor="#000" stopOpacity="0.95" />
          <stop offset="62%" stopColor="#000" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#000" stopOpacity="0" />
        </radialGradient>
      </defs>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={art.accent} opacity={d.o} />
      ))}
      <g transform="translate(60 72)">
        {[26, 34, 43, 53].map((r, i) => (
          <circle
            key={r}
            r={r}
            fill="none"
            stroke={art.accent}
            strokeWidth={0.8 - i * 0.12}
            opacity={0.5 - i * 0.09}
            strokeDasharray={i % 2 === 0 ? '3 7' : undefined}
          />
        ))}
        <circle r="24" fill={`url(#${uid}-v)`} />
        <circle r="24" fill="none" stroke={art.accent} strokeWidth="1.4" opacity="0.85" />
      </g>
    </svg>
  );
}

const PATTERNS: Record<NonNullable<Art['pattern']>, (p: PatternProps) => JSX.Element> = {
  grid: GridPattern,
  wave: WavePattern,
  burst: BurstPattern,
  circuit: CircuitPattern,
  petal: PetalPattern,
  void: VoidPattern,
};

export function CharacterArtView({
  art, name, element, rarity, silhouette, awakened,
  ratio = 'portrait', className = '', sigilScale = 1, hideBadges = false,
}: CharacterArtProps): JSX.Element {
  const uid = useId().replace(/[:]/g, '');
  const a = art ?? FALLBACK;
  const kind = a.pattern ?? 'grid';
  const Pattern = PATTERNS[kind] ?? GridPattern;

  return (
    <div
      className={[
        'cart',
        `cart-ratio-${ratio}`,
        `cart-pat-${kind}`,
        rarity ? `rar-${rarity}` : '',
        silhouette ? 'is-silhouette' : '',
        awakened ? 'is-awakened' : '',
        className,
      ].filter(Boolean).join(' ')}
      style={{
        // @ts-expect-error CSS カスタムプロパティ
        '--p': a.primary,
        '--s': a.secondary,
        '--a': a.accent,
      }}
      role="img"
      aria-label={silhouette ? '未入手キャラクター' : `${name} のキャラクター画像`}
    >
      <div className="cart-base" />
      <Pattern uid={uid} art={a} seedKey={`${name}|${a.sigil}|${kind}`} />
      <div className="cart-vignette" />
      <div className="cart-sigil" style={{ fontSize: `calc(var(--sigil-size) * ${sigilScale})` }}>
        {silhouette ? '?' : a.sigil}
      </div>
      {!hideBadges && !silhouette && element && <span className="cart-element">{ELEMENT_LABEL[element]}</span>}
      {!hideBadges && rarity && <span className="cart-rarity">{rarity}</span>}
      {(rarity === 'SSR' || rarity === 'UR') && !silhouette && (
        <div className="cart-sparkles" aria-hidden>
          {Array.from({ length: rarity === 'UR' ? 10 : 6 }, (_, i) => (
            <i key={i} style={{ '--i': i } as React.CSSProperties} />
          ))}
        </div>
      )}
      {rarity === 'UR' && !silhouette && <div className="cart-prism" aria-hidden />}
      <div className="cart-scan" aria-hidden />
    </div>
  );
}

export default CharacterArtView;
