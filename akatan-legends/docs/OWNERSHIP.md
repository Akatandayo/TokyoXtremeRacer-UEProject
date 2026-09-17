# 開発分担 (Phase 1 / MVP)

| 担当 | 所有ディレクトリ | 責務 |
|---|---|---|
| データ/キャラ設計 | `data/**`, `scripts/**` | キャラ・敵・スキル・AI・ダンジョン・バランス定数 |
| 戦闘エンジン | `server/src/battle/**` | 行動ゲージ・ダメージ計算・AI実行・状態異常・戦闘ログ |
| バックエンド | `server/src/{index.ts,db,routes,services,data}/**` | Express API・SQLite・育成計算・サーバ権威処理 |
| フロントエンド | `client/**` | 全画面UI・戦闘再生演出 |
| 評論家 | (レビューのみ) | 演出・ゲーム性・バランスの評価 |

## 共有境界 (勝手に変更しない)
- `shared/src/types.ts` — ドメイン型
- `shared/src/api.ts` — API契約
- `server/src/battle/contract.ts` — 戦闘エンジン入出力契約

変更が必要な場合は統括(オーケストレータ)に申告すること。
