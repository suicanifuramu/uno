// 共有型: クライアントと Room DO の両方で使う

export type Color = "red" | "green" | "yellow" | "blue";
/** ワイルド札は未確定色として "wild" を持つ。プレイ時に activeColor が確定する */
export type CardColor = Color | "wild";
export type Kind = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface Card {
  id: string;
  kind: Kind;
  color: CardColor;
  num?: number; // kind === "number" のとき 0-9
}

export interface Rules {
  stacking: boolean;
  forcePlay: boolean;
  drawToPlay: boolean;
  jumpIn: boolean;
  sevenZero: boolean;
}

export interface Settings extends Rules {
  maxPlayers: number;
  turnSeconds: number;
}

export const DEFAULT_RULES: Rules = {
  stacking: true,
  forcePlay: false,
  drawToPlay: false,
  jumpIn: false,
  sevenZero: false,
};

export const DEFAULT_SETTINGS: Settings = {
  ...DEFAULT_RULES,
  maxPlayers: 8,
  turnSeconds: 15,
};

/** 全プレイヤーに見える状態 */
export interface PubPlayer {
  id: string;
  name: string;
  count: number;
  connected: boolean;
  host: boolean;
  calledUno: boolean;
  ready: boolean;
  /** 終了した順位。null = 対戦中 */
  rank: number | null;
}

/** 接続者自身にのみ見える状態 */
export interface YouView {
  id: string;
  name: string;
  cards: Card[];
  /** cards と平行。出せるかどうか(サーバ計算) */
  playable: boolean[];
  /** ドロー後の Keep/Play 判定中。null=判定外 */
  drawnIds: string[] | null;
  /** forcePlay/drawToPlay 強制時は keep 不可 */
  mustPlay: boolean;
  calledUno: boolean;
  canCallUno: boolean;
  /** seven0 の7で交換相手選択中 */
  picking: boolean;
}

export interface GameState {
  phase: "lobby" | "playing" | "ended";
  players: PubPlayer[];
  top: Card | null;
  activeColor: CardColor;
  direction: 1 | -1;
  /** 手番の players インデックス */
  turn: number;
  /** epoch ms。タイマー表示用 */
  turnEndsAt: number;
  /** スタッキング中の罰札枚数 */
  stack: number;
  /** 順位一覧(rank 昇順)。空ならまだ順位未確定 */
  rankings: { id: string; name: string; rank: number }[];
  settings: Settings;
}

/** サーバ→クライアントの state メッセージ本体 */
export interface StateSnapshot extends GameState {
  you: YouView;
  /** 観戦者かどうか */
  spectator: boolean;
}

// ---- WebSocket メッセージ ----

export type ClientMsg =
  | { t: "join"; name: string; playerId?: string }
  | { t: "start" }
  | { t: "ready"; v: boolean }
  | { t: "play"; cardId: string; color?: Color }
  | { t: "draw" }
  | { t: "keep" }
  | { t: "callUno" }
  | { t: "pickHand"; targetId: string }
  | { t: "chat"; text: string }
  | { t: "restart" }
  | { t: "settings"; patch: Partial<Settings> };

export type ServerMsg =
  | { t: "init"; playerId: string; code: string; spectator?: boolean }
  | { t: "state"; s: StateSnapshot }
  | { t: "toast"; text: string }
  | { t: "chat"; name: string; text: string };
