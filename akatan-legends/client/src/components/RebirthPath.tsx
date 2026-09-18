/**
 * 転生の「系統」を示す小さなバッジ。CHARACTERS 一覧のカード(§19: ビルド分岐を
 * 一覧で見分けられるように)と CHARACTER DETAIL のどちらからも使う共通パーツ。
 */
import React from 'react';
import type { RebirthPath } from '@akatan/shared';
import { REBIRTH_PATH_LABEL, REBIRTH_PATH_ICON, pathColorVar } from '../utils/rebirth';

export function RebirthPathBadge({
  path, size = 'sm',
}: { path: RebirthPath; size?: 'sm' | 'md' }): JSX.Element {
  return (
    <span
      className={`path-badge path-badge-${size}`}
      style={{ ['--path-color' as string]: pathColorVar(path) }}
      title={`主系統: ${REBIRTH_PATH_LABEL[path]}`}
    >
      <span className="path-badge-ic" aria-hidden>{REBIRTH_PATH_ICON[path]}</span>
      {REBIRTH_PATH_LABEL[path]}
    </span>
  );
}

export default RebirthPathBadge;
