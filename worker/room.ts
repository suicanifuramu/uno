import { DurableObject } from "cloudflare:workers";
import {
  canStackOn,
  COLORS,
  isPlayable,
  jumpInEligible,
  makeDeck,
  shuffle,
} from "../src/shared/engine";
import type {
  Card,
  CardColor,
  Color,
  GameState,
  Kind,
  PubPlayer,
  ServerMsg,
  Settings,
  StateSnapshot,
  YouView,
} from "../src/shared/types";
import { DEFAULT_SETTINGS } from "../src/shared/types";
import type { Env } from "./env";

interface GPlayer {
  id: string;
  name: string;
  hand: Card[];
  connected: boolean;
  calledUno: boolean;
  /** 残り1枚で未宣言(宣言せずに番を終えると+2) */
  unoPending: boolean;
  host: boolean;
  ready: boolean;
  /** 終了した順位。null = 対戦中 */
  rank: number | null;
}

interface Room {
  phase: "lobby" | "playing" | "ended";
  players: GPlayer[];
  deck: Card[];
  discard: Card[];
  activeColor: CardColor;
  direction: 1 | -1;
  turn: number; // -1 = 未開始
  turnEndsAt: number;
  stack: number; // スタッキング中の罰札枚数
  pendingKind: Kind | null; // "draw2" | "wild4"
  drawnIds: Record<string, string[] | undefined>; // ドロー後の Keep/Play 判定
  pickingBy: string | null; // seven0 の7で交換相手選択中のプレイヤー
  rankings: { id: string; name: string; rank: number }[];
  settings: Settings;
  publicRoom: boolean;
  /** 同じ数字連続プレイの猶予期限(epoch ms)。0=無効 */
  chainUntil: number;
}

/** 同じ数字チェーンの猶予時間(ms) */
const GRACE_MS = 3000;

function newRoom(): Room {
  return {
    phase: "lobby",
    players: [],
    deck: [],
    discard: [],
    activeColor: "wild",
    direction: 1,
    turn: -1,
    turnEndsAt: 0,
    stack: 0,
    pendingKind: null,
    drawnIds: {},
    pickingBy: null,
    rankings: [],
    settings: { ...DEFAULT_SETTINGS },
    publicRoom: true,
    chainUntil: 0,
  };
}

const DRAW_TO_PLAY_CAP = 20;

export class GameRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private lobbyPublished = false;
  private readonly code: string;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.code = ctx.id.name ?? "";
  }

  private async load(): Promise<Room> {
    if (!this.room) {
      this.room =
        (await this.ctx.storage.get<Room>("room")) ?? newRoom();
    }
    return this.room;
  }

  private async save() {
    if (this.room) await this.ctx.storage.put("room", this.room);
  }

  /** RPC: 部屋作成直後に Worker から呼ぶ(公開/非公開) */
  async setPublic(v: boolean) {
    const r = await this.load();
    r.publicRoom = v;
    await this.save();
    await this.publishLobby(r);
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    return new Response("Not Found", { status: 404 });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(String(message)) as Record<string, unknown>;
    } catch {
      return;
    }
    const room = await this.load();
    const att = (ws.deserializeAttachment() as { playerId?: string });

    if (msg.t === "join") {
      await this.handleJoin(ws, room, msg);
      return;
    }

    const pid = att?.playerId;
    if (!pid) return;

    let toast: string | null = null;
    switch (msg.t) {
      case "start":
        toast = await this.onStart(pid);
        break;
      case "ready":
        toast = await this.onReady(pid, msg.v === true);
        break;
      case "play":
        toast = await this.onPlay(
          pid,
          String(msg.cardId ?? ""),
          msg.color as Color | undefined,
        );
        break;
      case "draw":
        toast = await this.onDraw(pid);
        break;
      case "keep":
        toast = await this.onKeep(pid);
        break;
      case "callUno":
        toast = await this.onCallUno(pid);
        break;
      case "pickHand":
        toast = await this.onPickHand(pid, String(msg.targetId ?? ""));
        break;
      case "restart":
        toast = await this.onRestart(pid);
        break;
      case "settings":
        toast = await this.onSettings(pid, msg.patch as Partial<Settings> | undefined);
        break;
      case "chat": {
        const text = String(msg.text ?? "").slice(0, 200);
        if (!text) return;
        const attAny = att as { spectator?: boolean; name?: string };
        const sender = attAny.spectator
          ? attAny.name || "観戦者"
          : room.players.find((p) => p.id === pid)?.name ?? "?";
        await this.save();
        await this.broadcast({ t: "chat", name: sender, text });
        return;
      }
      default:
        return;
    }
    const dToast = await this.resolveDisconnected(room);
    if (dToast) toast = toast ? `${toast} ${dToast}` : dToast;
    await this.save();
    await this.broadcast(toast ? { t: "toast", text: toast } : undefined);
  }

  override async webSocketClose(ws: WebSocket) {
    const room = await this.load();
    const att = (ws.deserializeAttachment() as {
      playerId?: string;
      spectator?: boolean;
    });
    const p = room.players.find((x) => x.id === att?.playerId);
    if (!p) return;
    // タブ複製: 同じ playerId の別ソケットがまだ生きていれば切断扱いにしない
    const stillConnected = this.ctx.getWebSockets().some((s) => {
      if (s === ws) return false;
      const a = s.deserializeAttachment() as { playerId?: string };
      return a?.playerId === p.id;
    });
    if (stillConnected) return;
    p.connected = false;
    if (room.phase === "lobby") {
      // ロビーでは離脱=削除。ホストがいなくなったら先頭が繰り上がり
      room.players = room.players.filter((x) => x.id !== p.id);
      if (!room.players.some((x) => x.host) && room.players[0]) {
        room.players[0].host = true;
      }
    }
    await this.save();
    await this.publishLobby(room);
    // 全員切断なら部屋を削除
    const anyConnected = room.players.some((x) => x.connected);
    if (!anyConnected) {
      await this.deleteRoom(room);
      return;
    }
    if (room.phase === "playing" && room.players[room.turn]?.id === p.id) {
      const dToast = await this.resolveDisconnected(room);
      await this.save();
      await this.broadcast(dToast ? { t: "toast", text: dToast } : undefined);
    } else {
      await this.broadcast();
    }
  }

  private async handleJoin(ws: WebSocket, room: Room, msg: Record<string, unknown>) {
    const rawName = String(msg.name ?? "").trim().slice(0, 16) || "Player";
    const prevId = typeof msg.playerId === "string" ? msg.playerId : undefined;
    const prev = prevId
      ? room.players.find((p) => p.id === prevId)
      : undefined;

    // 観戦: 対戦中/終了後の部屋へはプレイヤーとして入らず観戦扱い
    if (!prev && room.phase !== "lobby") {
      ws.serializeAttachment({ spectator: true, name: rawName });
      ws.send(this.m({ t: "init", playerId: "", code: this.code, spectator: true }));
      await this.save();
      await this.broadcast();
      return;
    }

    if (prev) {
      // 再接続
      prev.connected = true;
      prev.name = rawName;
      ws.serializeAttachment({ playerId: prev.id });
      ws.send(this.m({ t: "init", playerId: prev.id, code: this.code }));
      // タブ複製対策: 同じ playerId の古い接続を閉じる
      for (const s of this.ctx.getWebSockets()) {
        if (s === ws) continue;
        const a = s.deserializeAttachment() as { playerId?: string };
        if (a?.playerId === prev.id) {
          try {
            s.close(4001, "replaced");
          } catch {
            /* noop */
          }
        }
      }
      await this.save();
      await this.broadcast({ t: "toast", text: `${prev.name} rejoined.` });
      return;
    }
    if (room.phase !== "lobby" || room.players.length >= room.settings.maxPlayers) {
      ws.send(this.m({ t: "toast", text: "This room is full or in game." }));
      ws.close(4000, "full");
      return;
    }
    let name = rawName;
    while (room.players.some((p) => p.name === name)) {
      name = `${rawName.slice(0, 13)}-${Math.floor(Math.random() * 90 + 10)}`;
    }
    const p: GPlayer = {
      id: crypto.randomUUID(),
      name,
      hand: [],
      connected: true,
      calledUno: false,
      unoPending: false,
      host: room.players.length === 0,
      ready: false,
      rank: null,
    };
    room.players.push(p);
    ws.serializeAttachment({ playerId: p.id });
    ws.send(this.m({ t: "init", playerId: p.id, code: this.code }));
    await this.save();
    await this.publishLobby(room);
    await this.broadcast();
  }

  // ---- ゲームアクション(戻り値は全員への toast 文 or null) ----

  private async onStart(pid: string): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "lobby") return null;
    const me = r.players.find((p) => p.id === pid);
    if (!me?.host) return "Only the host can start.";
    if (r.players.length < 2) return "Need at least 2 players.";
    if (r.players.some((p) => !p.host && !p.ready)) {
      return "Waiting for all players to ready.";
    }

    r.deck = shuffle(makeDeck());
    for (const p of r.players) {
      p.hand = r.deck.splice(0, 7);
      p.calledUno = false;
      p.unoPending = false;
      p.ready = false;
      p.rank = null;
    }
    // 最初のフリップは数字札まで(オリジナルの挙動不明のための規定)
    let first: Card | undefined;
    while ((first = r.deck.pop())) {
      if (first.kind === "number") break;
      r.deck.unshift(first);
    }
    if (!first) return null;
    r.discard = [first];
    r.activeColor = first.color as CardColor;
    r.direction = 1;
    r.stack = 0;
    r.pendingKind = null;
    r.pickingBy = null;
    r.drawnIds = {};
    r.rankings = [];
    r.phase = "playing";
    r.turn = 0;
    await this.setTurn(r);
    await this.publishLobby(r);
    await this.resolveDisconnected(r);
    return `${r.players[r.turn].name} goes first!`;
  }

  private async onReady(pid: string, v: boolean): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "lobby") return null;
    const p = r.players.find((x) => x.id === pid);
    if (!p || p.host) return null;
    p.ready = v;
    return null;
  }

  private async onPlay(pid: string, cardId: string, color?: Color): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "playing") return null;
    const idx = r.players.findIndex((p) => p.id === pid);
    if (idx < 0) return null;
    const p = r.players[idx];
    const isCurrent = r.turn === idx;
    const top = r.discard.at(-1) ?? null;
    const cardIdx = p.hand.findIndex((c) => c.id === cardId);
    if (cardIdx < 0) return null;
    const card = p.hand[cardIdx];

    // 同じ数字チェーン猶予中は同数字カードのみ出せる(自分の手番のみ)
    const inChainGrace =
      r.chainUntil > Date.now() && isCurrent && r.stack === 0;
    if (
      inChainGrace &&
      !(card.kind === "number" && top?.kind === "number" && card.num === top.num)
    ) {
      return null;
    }

    if (r.stack > 0) {
      if (!isCurrent || !canStackOn(card, r.pendingKind)) return null;
    } else if (!isCurrent) {
      if (!(r.settings.jumpIn && jumpInEligible(card, top))) return null;
    } else if (!isPlayable(card, top, r.activeColor)) {
      return null;
    }

    if (card.kind === "wild" || card.kind === "wild4") {
      if (!color || !COLORS.includes(color)) return null;
      r.activeColor = color;
    } else {
      r.activeColor = card.color;
    }
    p.hand.splice(cardIdx, 1);
    r.discard.push(card);
    delete r.drawnIds[p.id];

    let toast: string | null = null;
    // UNO宣言は残り2枚で。宣言済みなら残り1枚でペナルティなし。未宣言なら unoPending を立てる
    if (p.hand.length === 1) {
      if (!p.calledUno) p.unoPending = true;
    }
    p.calledUno = false;

    // 手札ゼロ: 最後の1枚を未宣言のまま出したら +2 ペナルティで続行
    if (p.hand.length === 0) {
      if (p.unoPending && !p.calledUno) {
        const got = this.drawN(r, p, 2);
        p.unoPending = false;
        toast = `${p.name} forgot to call UNO! Drew ${got}.`;
      } else {
        await this.finishPlayer(r, p);
        return `${p.name} finished!`;
      }
    }

    // Jump In の場合、効果の基準位置をここに移す
    if (!isCurrent) r.turn = idx;

    if (r.settings.sevenZero && card.kind === "number" && card.num === 7) {
      r.pickingBy = p.id;
      return `${p.name} played a 7. Pick someone to swap hands with.`;
    }
    if (r.settings.sevenZero && card.kind === "number" && card.num === 0) {
      this.rotateHands(r);
      await this.endPlayerTurn(r, 1);
      return "Everyone passed their hands!";
    }

    switch (card.kind) {
      case "reverse": {
        r.direction *= -1;
        await this.endPlayerTurn(r, r.players.length === 2 ? 2 : 1);
        break;
      }
      case "skip": {
        await this.endPlayerTurn(r, 2);
        break;
      }
      case "draw2":
      case "wild4": {
        const n = card.kind === "draw2" ? 2 : 4;
        if (r.settings.stacking) {
          r.stack += n;
          r.pendingKind = card.kind;
          await this.endPlayerTurn(r, 1);
          // スタックできない相手は自動ドロー後、プレイ可能。できる相手には3秒の猶予
          const victim = r.players[r.turn];
          if (victim && !victim.hand.some((c) => canStackOn(c, r.pendingKind))) {
            const took = this.drawStack(r, victim);
            toast =
              (toast ? `${toast} ` : "") +
              `${victim.name} was forced to draw ${took}.`;
          } else if (victim) {
            r.chainUntil = Date.now() + GRACE_MS;
            await this.ctx.storage.setAlarm(r.chainUntil);
          }
        } else {
          const victim = this.peekNext(r);
          if (victim) {
            const got = this.drawN(r, victim, n);
            toast =
              (toast ? `${toast} ` : "") +
              `${victim.name} draws ${got} and is skipped.`;
          }
          await this.endPlayerTurn(r, 2);
        }
        break;
      }
      default: {
        // 同じ数字は連続で出せる: 手札に同じ数字が残っていれば3秒の猶予
        if (
          card.kind === "number" &&
          p.hand.some((c) => c.kind === "number" && c.num === card.num)
        ) {
          r.chainUntil = Date.now() + GRACE_MS;
          await this.ctx.storage.setAlarm(r.chainUntil);
          break;
        }
        await this.endPlayerTurn(r, 1);
      }
    }
    return toast;
  }

  private async onDraw(pid: string): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "playing" || r.players[r.turn]?.id !== pid) return null;
    const p = r.players[r.turn];
    if (r.drawnIds[p.id]) return null;

    if (r.stack > 0) {
      const took = this.drawStack(r, p);
      return `${p.name} took ${took} cards.`;
    }

    const ids: string[] = [];
    do {
      const c = this.drawOne(r);
      if (!c) break;
      p.hand.push(c);
      ids.push(c.id);
    } while (
      r.settings.drawToPlay &&
      !ids.some((id) =>
        isPlayable(p.hand.find((x) => x.id === id)!, r.discard.at(-1) ?? null, r.activeColor),
      ) &&
      ids.length < DRAW_TO_PLAY_CAP
    );
    if (ids.length > 0) {
      // drawToPlay オフ: 1枚引いて出せなければ即ターン終了(keep選択を出さない)
      if (!r.settings.drawToPlay) {
        const drawn = p.hand.find((x) => x.id === ids[0]);
        const playable = drawn
          ? isPlayable(drawn, r.discard.at(-1) ?? null, r.activeColor)
          : false;
        if (!playable) {
          return this.endPlayerTurn(r, 1);
        }
      }
      r.drawnIds[p.id] = ids;
      // 同じ数字の出せるカードを引いた/持っていた場合、3秒で自動進行
      const top = r.discard.at(-1);
      const hasSameNum =
        top?.kind === "number" &&
        p.hand.some(
          (c) =>
            c.kind === "number" && c.num === top.num && isPlayable(c, top, r.activeColor),
        );
      if (hasSameNum) {
        r.chainUntil = Date.now() + GRACE_MS;
        await this.ctx.storage.setAlarm(r.chainUntil);
      }
    }
    return null;
  }

  private async onKeep(pid: string): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "playing" || r.players[r.turn]?.id !== pid) return null;
    const ids = r.drawnIds[pid];
    if (!ids) return null;
    const forced = this.mustPlay(r, r.players[r.turn], ids);
    if (forced) return null;
    delete r.drawnIds[pid];
    return this.endPlayerTurn(r, 1);
  }

  private async onCallUno(pid: string): Promise<string | null> {
    const r = await this.load();
    const p = r.players.find((x) => x.id === pid);
    if (!p || r.phase !== "playing" || p.hand.length !== 2 || p.calledUno) {
      return null;
    }
    p.calledUno = true;
    p.unoPending = false;
    return `${p.name} called UNO!`;
  }

  private async onPickHand(pid: string, targetId: string): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "playing" || r.pickingBy !== pid) return null;
    const me = r.players.find((p) => p.id === pid);
    const target = r.players.find((p) => p.id === targetId);
    if (!me || !target || target.id === me.id) return null;
    const tmp = me.hand;
    me.hand = target.hand;
    target.hand = tmp;
    r.pickingBy = null;
    const pen = await this.endPlayerTurn(r, 1);
    return (
      (pen ? pen + " " : "") +
      `${me.name} swapped hands with ${target.name}!`
    );
  }

  private async onRestart(pid: string): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "ended") return null;
    if (!r.players.find((p) => p.id === pid)?.host) return "Only the host can restart.";
    const fresh = newRoom();
    fresh.publicRoom = r.publicRoom;
    fresh.settings = r.settings;
    fresh.players = r.players.map((p) => ({
      ...p,
      hand: [],
      calledUno: false,
      unoPending: false,
      ready: false,
      rank: null,
    }));
    this.room = fresh;
    await this.publishLobby(fresh);
    return "Back to the lobby!";
  }

  private async onSettings(pid: string, patch?: Partial<Settings>): Promise<string | null> {
    const r = await this.load();
    if (r.phase !== "lobby") return "Rules can only be changed in the lobby.";
    if (!r.players.find((p) => p.id === pid)?.host) return "Only the host can change rules.";
    if (!patch) return null;
    const ruleKeys = ["stacking", "forcePlay", "drawToPlay", "jumpIn", "sevenZero"] as const;
    for (const k of ruleKeys) {
      if (typeof patch[k] === "boolean") {
        (r.settings[k] as boolean) = patch[k] as boolean;
      }
    }
    if (typeof patch.maxPlayers === "number") {
      r.settings.maxPlayers = Math.min(12, Math.max(2, Math.round(patch.maxPlayers)));
    }
    if (typeof patch.turnSeconds === "number") {
      r.settings.turnSeconds = Math.min(120, Math.max(10, Math.round(patch.turnSeconds)));
    }
    return null;
  }

  // ---- ターンタイムアウト(DO alarm) ----

  override async alarm() {
    const r = await this.load();
    if (r.phase !== "playing") return;
    const p = r.players[r.turn];
    if (!p) return;

    // 猶予切れ: スタック中なら強制ドロー、それ以外は普通にターン進行
    if (r.chainUntil > 0 && Date.now() >= r.chainUntil) {
      r.chainUntil = 0;
      delete r.drawnIds[p.id];
      let toast: string | null;
      if (r.stack > 0 && !r.pickingBy) {
        toast = (await this.onDraw(p.id)) || `${p.name} was forced to draw.`;
        await this.save();
        await this.broadcast(toast ? { t: "toast", text: toast } : undefined);
        return;
      }
      const pen = await this.endPlayerTurn(r, 1);
      await this.save();
      await this.broadcast(
        pen ? { t: "toast", text: pen } : undefined,
      );
      return;
    }

    let toast: string | null = null;
    if (!p.connected) {
      await this.endPlayerTurn(r, 1);
      toast = `${p.name} timed out.`;
    } else if (r.pickingBy === p.id) {
      const others = r.players.filter((x) => x.id !== p.id);
      const target = others[Math.floor(Math.random() * others.length)];
      toast = (await this.onPickHand(p.id, target.id)) || "Hand swap timed out.";
    } else if (r.drawnIds[p.id]) {
      const ids = r.drawnIds[p.id]!;
      const playableDrawn = ids.find((id) => {
        const c = p.hand.find((x) => x.id === id)!;
        return isPlayable(c, r.discard.at(-1) ?? null, r.activeColor);
      });
      if (playableDrawn && this.mustPlay(r, p, ids)) {
        toast = (await this.onPlay(p.id, playableDrawn, this.commonColor(p))) ?? "";
      } else {
        delete r.drawnIds[p.id];
        const pen = await this.endPlayerTurn(r, 1);
        toast = pen ?? toast;
      }
    } else if (r.stack > 0) {
      toast = (await this.onDraw(p.id)) ?? "";
    } else {
      const playable = p.hand.find((c) =>
        isPlayable(c, r.discard.at(-1) ?? null, r.activeColor),
      );
      if (playable) {
        toast = (await this.onPlay(p.id, playable.id, this.commonColor(p))) ?? "";
      } else {
        await this.onDraw(p.id);
        const ids = r.drawnIds[p.id];
        const playableDrawn = ids?.find((id) => {
          const c = p.hand.find((x) => x.id === id)!;
          return isPlayable(c, r.discard.at(-1) ?? null, r.activeColor);
        });
        if (playableDrawn && this.mustPlay(r, p, ids!)) {
          toast = (await this.onPlay(p.id, playableDrawn, this.commonColor(p))) ?? "";
        } else {
          delete r.drawnIds[p.id];
          const pen = await this.endPlayerTurn(r, 1);
          if (pen) toast = pen;
        }
      }
      toast = toast || `${p.name} timed out.`;
    }
    const dToast = await this.resolveDisconnected(r);
    if (dToast) toast = toast ? `${toast} ${dToast}` : dToast;
    await this.save();
    await this.broadcast({
      t: "toast",
      text: toast || `${p.name} timed out.`,
    });
  }

  // ---- 内部ヘルパ ----

  private mustPlay(r: Room, p: GPlayer, drawnIds: string[]): boolean {
    if (!(r.settings.forcePlay || r.settings.drawToPlay)) return false;
    return drawnIds.some((id) => {
      const c = p.hand.find((x) => x.id === id)!;
      return isPlayable(c, r.discard.at(-1) ?? null, r.activeColor);
    });
  }

  /** 手番プレイヤーの行動が終了 → UNO未宣言ペナルティを判定してからターンを進める */
  private async endPlayerTurn(r: Room, times: number): Promise<string | null> {
    const p = r.players[r.turn];
    let toast: string | null = null;
    if (p && p.unoPending && !p.calledUno && r.phase === "playing") {
      const got = this.drawN(r, p, 2);
      p.unoPending = false;
      toast = `${p.name} forgot to call UNO! Drew ${got}.`;
    }
    await this.advanceTurn(r, times);
    return toast;
  }

  private async setTurn(r: Room) {
    r.chainUntil = 0;
    r.turnEndsAt = Date.now() + r.settings.turnSeconds * 1000;
    r.drawnIds = {};
    await this.ctx.storage.setAlarm(r.turnEndsAt);
  }

  private async advanceTurn(r: Room, times: number) {
    if (r.players.length === 0) return;
    let i = r.turn < 0 ? 0 : r.turn;
    for (let n = 0; n < times; n++) {
      i = this.nextActiveIndex(r, i);
    }
    r.turn = i;
    await this.setTurn(r);
  }

  /** 現在 index から進行方向へ、次の未終了プレイヤーの index を返す */
  private nextActiveIndex(r: Room, from: number): number {
    const n = r.players.length;
    let i = from;
    for (let k = 0; k < n; k++) {
      i = (i + r.direction + n) % n;
      if (r.players[i].rank == null) return i;
    }
    return from;
  }

  /** 切断プレイヤーの手番を1アクション自動解決する。切断者でなければ null */
  private async autoResolve(r: Room, p: GPlayer): Promise<string | null> {
    // 7で交換待ち → ランダムな相手を自動選択
    if (r.pickingBy === p.id) {
      const others = r.players.filter((x) => x.id !== p.id);
      const target = others[Math.floor(Math.random() * others.length)];
      if (!target) return null;
      return (await this.onPickHand(p.id, target.id)) ?? "";
    }
    // ドロー後判定中: 出せるなら出す、出せなければターン終了
    if (r.drawnIds[p.id]) {
      const ids = r.drawnIds[p.id]!;
      const top = r.discard.at(-1) ?? null;
      const playableDrawn = ids.find((id) => {
        const c = p.hand.find((x) => x.id === id)!;
        return isPlayable(c, top, r.activeColor);
      });
      if (playableDrawn) {
        return (await this.onPlay(p.id, playableDrawn, this.commonColor(p))) ?? "";
      }
      delete r.drawnIds[p.id];
      return this.endPlayerTurn(r, 1);
    }
    // スタック中: スタックできるなら即スタック、できなければ即ドロー
    if (r.stack > 0) {
      const stackable = p.hand.find((c) => canStackOn(c, r.pendingKind));
      if (stackable) {
        return (await this.onPlay(p.id, stackable.id, this.commonColor(p))) ?? "";
      }
      return this.onDraw(p.id);
    }
    // 通常: 出せるカード(同数字チェーン猶予中は同数字のみ)
    const top = r.discard.at(-1) ?? null;
    const inChain = r.chainUntil > Date.now() && r.stack === 0;
    const playable = p.hand.find((c) => {
      if (inChain) {
        return (
          c.kind === "number" &&
          top?.kind === "number" &&
          c.num === top.num
        );
      }
      return isPlayable(c, top, r.activeColor);
    });
    if (playable) {
      return (await this.onPlay(p.id, playable.id, this.commonColor(p))) ?? "";
    }
    // 出せない → ドロー
    return this.onDraw(p.id);
  }

  /** 現在の手番が切断中なら自動解決を続ける。toast を連結して返す */
  private async resolveDisconnected(r: Room): Promise<string | null> {
    let toast: string | null = null;
    let guard = 0;
    while (r.phase === "playing" && guard++ < r.players.length) {
      const p = r.players[r.turn];
      if (!p || p.connected) break;
      const t = await this.autoResolve(r, p);
      if (t) toast = toast ? `${toast} ${t}` : t;
    }
    return toast;
  }

  private peekNext(r: Room): GPlayer | undefined {
    return r.players[this.nextActiveIndex(r, r.turn)];
  }

  private drawOne(r: Room): Card | undefined {
    return r.deck.pop() ?? this.reshuffle(r);
  }

  private drawN(r: Room, p: GPlayer, n: number): number {
    let got = 0;
    for (let k = 0; k < n; k++) {
      const c = this.drawOne(r);
      if (!c) break;
      p.hand.push(c);
      got++;
    }
    return got;
  }

  /** スタック中の罰札をドローし、drawnIds を立ててプレイ/キープ選択を出す */
  private drawStack(r: Room, p: GPlayer): number {
    const took = r.stack;
    const ids: string[] = [];
    for (let k = 0; k < took; k++) {
      const c = this.drawOne(r);
      if (!c) break;
      p.hand.push(c);
      ids.push(c.id);
    }
    r.stack = 0;
    r.pendingKind = null;
    if (ids.length > 0) r.drawnIds[p.id] = ids;
    return took;
  }

  /** 捨て札(山以外)をシャッフルしてデッキに戻す */
  private reshuffle(r: Room): Card | undefined {
    if (r.discard.length <= 1) return undefined;
    const top = r.discard.pop()!;
    r.deck = shuffle(r.discard);
    r.discard = [top];
    return r.deck.pop();
  }

  /** 0: 手札を進行方向へ一枚ずつ回す(未終了プレイヤーのみ) */
  private rotateHands(r: Room) {
    const active = r.players.filter((p) => p.rank == null);
    const n = active.length;
    if (n < 2) return;
    const old = active.map((p) => p.hand);
    active.forEach((p, i) => {
      p.hand = old[(i - r.direction + n) % n];
    });
  }

  /** タイムアウト時のワイルド色選択: 手札に最も多い色 */
  private commonColor(p: GPlayer): Color {
    const counts: Record<Color, number> = { red: 0, green: 0, yellow: 0, blue: 0 };
    for (const c of p.hand) {
      if (c.kind === "number" || c.kind === "skip" || c.kind === "reverse" || c.kind === "draw2") {
        counts[c.color as Color]++;
      }
    }
    return COLORS.reduce((a, b) => (counts[a] >= counts[b] ? a : b));
  }

  /** プレイヤーの終了処理。残り1人になったらゲーム終了 */
  private async finishPlayer(r: Room, p: GPlayer) {
    const finished = r.players.filter((x) => x.rank != null).length;
    p.rank = finished + 1;
    r.rankings.push({ id: p.id, name: p.name, rank: p.rank });
    // 残り1人(最後の一人)が決まったらゲーム終了
    const remaining = r.players.filter((x) => x.rank == null).length;
    if (remaining <= 1) {
      const last = r.players.find((x) => x.rank == null);
      if (last) {
        last.rank = r.players.length;
        r.rankings.push({ id: last.id, name: last.name, rank: last.rank });
      }
      await this.endGame(r);
      return;
    }
    await this.endPlayerTurn(r, 1);
  }

  private async endGame(r: Room) {
    r.phase = "ended";
    r.pickingBy = null;
    r.stack = 0;
    r.pendingKind = null;
    r.drawnIds = {};
    await this.ctx.storage.deleteAlarm();
    r.rankings.sort((a, b) => a.rank - b.rank);
    const winner = r.rankings[0];
    try {
      await this.env.DB.prepare(
        "INSERT INTO matches (room_code, winner_name, player_count) VALUES (?, ?, ?)",
      )
        .bind(this.code, winner?.name ?? "", r.players.length)
        .run();
    } catch (e) {
      console.error("d1 insert failed:", e);
    }
    await this.publishLobby(r);
  }

  /** 部屋削除: 公開一覧(KV)から外し、DOストレージをクリア */
  private async deleteRoom(r: Room) {
    try {
      await this.env.KV.delete(`room:${this.code}`);
    } catch (e) {
      console.error("kv delete error:", e);
    }
    this.lobbyPublished = false;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---- state 生成・配信 ----

  private gameState(r: Room): GameState {
    return {
      phase: r.phase,
      players: this.pubPlayers(r),
      top: r.discard.at(-1) ?? null,
      activeColor: r.activeColor,
      direction: r.direction,
      turn: r.turn,
      turnEndsAt: r.turnEndsAt,
      stack: r.stack,
      rankings: [...r.rankings].sort((a, b) => a.rank - b.rank),
      settings: r.settings,
    };
  }

  private pubPlayers(r: Room): PubPlayer[] {
    return r.players.map((p) => ({
      id: p.id,
      name: p.name,
      count: p.hand.length,
      connected: p.connected,
      host: p.host,
      calledUno: p.calledUno,
      ready: p.ready,
      rank: p.rank,
    }));
  }

  private youView(r: Room, playerId: string): YouView {
    const p = r.players.find((x) => x.id === playerId);
    const empty: YouView = {
      id: "",
      name: "",
      cards: [],
      playable: [],
      drawnIds: null,
      mustPlay: false,
      calledUno: false,
      canCallUno: false,
      picking: false,
    };
    if (!p) return empty;
    const g = this.gameState(r);
    const top = r.discard.at(-1) ?? null;
    const isCurrent = g.phase === "playing" && r.players[r.turn]?.id === p.id;
    const drawn = r.drawnIds[p.id] ?? null;
    const playable =
      g.phase !== "playing"
        ? p.hand.map(() => false)
        : p.hand.map((c) => {
            if (r.stack > 0) return isCurrent && canStackOn(c, r.pendingKind);
            // 同じ数字チェーン猶予中(ドロー解決前)は同数字のみ
            if (
              r.chainUntil > Date.now() &&
              isCurrent &&
              !drawn
            ) {
              return (
                c.kind === "number" &&
                top !== null &&
                top.kind === "number" &&
                c.num === top.num
              );
            }
            const base = isPlayable(c, top, r.activeColor);
            if (isCurrent) return base;
            return r.settings.jumpIn && jumpInEligible(c, top);
          });
    return {
      id: p.id,
      name: p.name,
      cards: p.hand,
      playable,
      drawnIds: drawn,
      mustPlay: !!drawn && this.mustPlay(r, p, drawn),
      calledUno: p.calledUno,
      canCallUno: g.phase === "playing" && p.hand.length === 2 && !p.calledUno,
      picking: r.pickingBy === p.id,
    };
  }

  private m<T extends ServerMsg>(x: T): string {
    return JSON.stringify(x);
  }

  private stateFor(r: Room, att: { playerId?: string; spectator?: boolean }): string {
    const spectator = !!att?.spectator;
    const s: StateSnapshot = {
      ...this.gameState(r),
      you: this.youView(r, att?.playerId ?? ""),
      spectator,
    };
    return this.m({ t: "state", s });
  }

  /** 全接続へ配信。extra(toast/chat)は各 state の前に送る */
  private async broadcast(extra?: ServerMsg) {
    const r = await this.load();
    if (extra) {
      for (const ws of this.ctx.getWebSockets()) {
        try {
          ws.send(this.m(extra));
        } catch {
          /* noop */
        }
      }
    }
    for (const ws of this.ctx.getWebSockets()) {
      const att = (ws.deserializeAttachment() as {
        playerId?: string;
        spectator?: boolean;
      });
      try {
        ws.send(this.stateFor(r, att ?? {}));
      } catch {
        /* noop */
      }
    }
  }

  /** ロビー/対戦中公開の同期。broadcast ではなくライフサイクル変化時のみ呼ぶこと(KV制限対策) */
  private async publishLobby(r: Room) {
    const key = `room:${this.code}`;
    const want =
      r.phase !== "ended" && r.publicRoom && r.players.length > 0;
    try {
      if (want) {
        await this.env.KV.put(
          key,
          JSON.stringify({
            code: this.code,
            count: r.players.length,
            max: r.settings.maxPlayers,
            phase: r.phase as "lobby" | "playing",
          }),
          { expirationTtl: 3600 },
        );
        this.lobbyPublished = true;
      } else if (this.lobbyPublished) {
        await this.env.KV.delete(key);
        this.lobbyPublished = false;
      }
    } catch (e) {
      console.error("kv error:", e);
    }
  }
}
