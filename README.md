# UNO Online

scuffeduno.online の調査結果(research/)をもとに構築したオンライン対戦UNO。
Cloudflare Workers + Durable Objects によるサーバ権威のリアルタイム対戦。

## スタック

| 層 | 技術 |
|---|---|
| フロント | Vite + React 19 + Tailwind v4 + shadcn/ui (base/nova) + diceui(segmented-input, status) |
| 配信・API | Cloudflare Workers(Static Assets = Pages+Functions の現行形態。DO は Pages Functions では使えないため Workers 構成) |
| リアルタイム | Durable Objects `GameRoom`(WebSocket Hibernation + DO alarm ターンタイマー) |
| KV | 公開部屋リスト(`room:<code>`, TTL 1h) |
| D1 | 対戦記録 `matches` テーブル → リーダーボード |
| R2 | UI テーマJSON(`theme.json`)。無ければデフォルトを使用 |

## 遊び方 / 実装済みルール

- 108枚デッキ・7枚配布・数字札フリップ開始
- 色/数字マッチ、Skip/Reverse(2人ではスキップ)/+2/Wild/Wild+4
- UNO宣言(残り2枚で宣言、忘れると2枚引きペナルティ)
- ハウスルール(ホストがロビーでトグル):スタッキング(+2は+2に/+4は+4にのみ)、フォースプレイ、ドロー・トゥ・プレイ、ジャンプイン(色&数字完全一致)、7-0
- ターンタイマー(DO alarm):タイムアウトで自動プレイ/自動ドロー/離脱者スキップ
- 再接続(playerId を localStorage に保持)、チャット、公開部屋一覧、勝利記録とランキング

未実装(意図的に省略): Bot、チーム戦(SOLO/DUO/TRIO)、ポイント複数ラウンド制、アカウント認証。

## ローカル開発

```bash
npm install
npm run cf:setup        # 初回のみ: D1/KV/R2 作成(要 wrangler login)

# 表示された ID を wrangler.jsonc の REPLACE_WITH_* へ転記
npx wrangler d1 migrations apply uno-db --local

# ターミナル2つ
npm run dev             # vite :5173 (/api, /ws を 8787 へプロキシ)
npm run dev:worker      # wrangler dev :8787
```

## デプロイ

```bash
# 1. リソース作成と ID 転記(ローカル開発と同じ)
wrangler d1 create uno-db
wrangler kv namespace create ROOMS
wrangler r2 bucket create uno-themes
# → wrangler.jsonc の REPLACE_WITH_KV_ID / REPLACE_WITH_D1_ID を更新

# 2. マイグレーション(リモート)
npx wrangler d1 migrations apply uno-db --remote

# 3. デプロイ(dist へビルドして Worker + Assets として公開)
npm run deploy
```

### テーマ変更(R2)

`GET /api/theme` は R2 の `theme.json` を優先して返す。UI の配色(`table`, `accent`)だけの
シンプルな JSON なので、再デプロイなしで差し替え可能:

```bash
echo '{"id":"dark","name":"Dark","table":"#111827","accent":"#f59e0b"}' \
  | npx wrangler r2 object put uno-themes/theme.json --content-type application/json - --remote
```

## 構成

```
worker/index.ts   REST(/api/*) + WSアップグレード中継 + 静的配信
worker/room.ts    GameRoom DO(状態保持/配信/alarm/D1記録/KV公開)
src/shared/       型とゲームエンジン純粋関数(クライアント/サーバ共有)
src/pages/        Home / Game / Rules / Leaderboard
migrations/       D1スキーマ
research/         元サイトの解析レポート(rules-detailed.md 等を参照)
```

## プロトコル(要約)

WS `GET /ws/:code`。C→S: `join/start/play/draw/keep/callUno/pickHand/chat/restart/settings`。
S→C: `init/state/toast/chat`。state は毎回全スナップショット(you は接続者ごとに個人視点)。詳細は research/system-spec.md。
