import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Crown,
  LogOut,
  MessageCircle,
  RotateCcw,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";import {
  Card as UICard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Status, StatusIndicator, StatusLabel } from "@/components/ui/status";
import { Switch } from "@/components/ui/switch";
import { ActiveColorDot, UnoCard } from "@/components/game/UnoCard";
import type { Card } from "@/shared/types";
import { getName, setName, useGameRoom, useTick } from "@/lib/client";
import type { Color, PubPlayer, StateSnapshot } from "@/shared/types";

const RULE_TOGGLES = [
  { key: "stacking", label: "スタッキング", desc: "+2 / +4 の罰を重ねてパスできる" },
  { key: "forcePlay", label: "フォースプレイ", desc: "引いた札が出せるなら必ず出す" },
  { key: "drawToPlay", label: "ドロー・トゥ・プレイ", desc: "出せる札を引くまで引き続ける" },
  { key: "jumpIn", label: "ジャンプイン", desc: "完全一致の札なら自分のターン以外でも即出し" },
  { key: "sevenZero", label: "7-0", desc: "7=相手と手札交換 / 0=全員が手札を回す" },
] as const;

const WILD_COLORS: { color: Color; className: string }[] = [
  { color: "red", className: "bg-red-600" },
  { color: "green", className: "bg-green-600" },
  { color: "yellow", className: "bg-yellow-400 text-black" },
  { color: "blue", className: "bg-blue-600" },
];

/** 山札引きアニメの1枚あたり間隔(ms) */
const DRAW_STEP_MS = 130;

export default function Game({
  code,
  onPhaseChange,
}: {
  code: string;
  onPhaseChange?: (phase: "lobby" | "playing" | "ended" | null) => void;
}) {
  const [joined, setJoined] = useState(() => !!getName());
  const { state, connected, chat, send } = useGameRoom(code, {
    enabled: joined,
  });
  const now = useTick(250);
  const [wildCard, setWildCard] = useState<Card | null>(null);
  const [chatOpen, setChatOpen] = useState(false);

  // 山札引きアニメ: 手札に新規追加されたカードを1枚ずつ stagger させる
  const prevHandIdsRef = useRef<Set<string>>(new Set());
  const [drawnAnim, setDrawnAnim] = useState<string[]>([]);
  const handKey =
    state?.phase === "playing"
      ? state.you.cards.map((c) => c.id).join(",")
      : "";
  useEffect(() => {
    if (!handKey) {
      // ロビー/未接続ではリセット(ゲーム開始時に配牌アニメが効く)
      prevHandIdsRef.current = new Set();
      setDrawnAnim([]);
      return;
    }
    const ids = new Set(handKey.split(",").filter(Boolean));
    const fresh = [...ids].filter((id) => !prevHandIdsRef.current.has(id));
    prevHandIdsRef.current = ids;
    if (fresh.length === 0) return;
    setDrawnAnim(fresh);
    const t = setTimeout(
      () => setDrawnAnim([]),
      fresh.length * DRAW_STEP_MS + 320,
    );
    return () => clearTimeout(t);
  }, [handKey]);

  // ヘッダーの離脱ガード用にフェーズを報告
  useEffect(() => {
    onPhaseChange?.(state?.phase ?? null);
    return () => onPhaseChange?.(null);
  }, [state?.phase, onPhaseChange]);

  // 名前未設定で URL 直打ちされた場合 → 名前入力画面を出してから接続
  if (!joined) {
    return <NameGate onJoin={() => setJoined(true)} />;
  }

  if (!state) {
    return (
      <div className="grid h-[calc(100dvh-3.5rem)] place-items-center">
        <p className="text-muted-foreground animate-pulse">接続中…</p>
      </div>
    );
  }

  const you = state.you;
  const me = state.players.find((p) => p.id === you.id);
  const others = state.players.filter((p) => p.id !== you.id);
  const current = state.turn >= 0 ? state.players[state.turn] : undefined;
  const isMyTurn = current?.id === you.id;
  const isHost = !!me?.host;
  const totalMs = state.settings.turnSeconds * 1000;
  const remainingPct =
    state.phase === "playing"
      ? Math.max(0, Math.min(100, ((state.turnEndsAt - now) / totalMs) * 100))
      : 0;
  const canDraw =
    state.phase === "playing" && isMyTurn && !you.drawnIds && !you.picking;

  const playCard = (index: number) => {
    if (!you.playable[index]) return;
    const card = you.cards[index];
    if (card.kind === "wild" || card.kind === "wild4") {
      setWildCard(card);
      return;
    }
    send({ t: "play", cardId: card.id });
  };

  return (
    <div className="relative flex h-[calc(100dvh-3.5rem)] flex-col overflow-hidden">
      {/* ヘッダーバー */}
      <div className="flex items-center gap-2 px-3 py-1">
        <Status variant={connected ? "success" : "error"}>
          <StatusIndicator />
          <StatusLabel>{connected ? "接続中" : "切断 - 再読込してください"}</StatusLabel>
        </Status>
        <span className="ml-auto font-mono text-sm font-bold tracking-widest">
          {code}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label="招待リンクをコピー"
          onClick={() => {
            navigator.clipboard
              .writeText(`${location.origin}${location.pathname}#/game/${code}`)
              .then(() => toast.success("招待リンクをコピーしました"));
          }}
        >
          <Copy />
        </Button>
      </div>

      <div
        className={
          state.phase === "lobby"
            ? "min-h-0 flex-1 overflow-y-auto"
            : "flex min-h-0 flex-1 flex-col"
        }
      >
        {state.phase === "lobby" ? (
          <LobbyView state={state} isHost={isHost} send={send} />
        ) : (
        <>
          {/* 対戦相手 */}
          <div className="flex flex-wrap items-start justify-center gap-3 px-4 py-2">
            {others.map((p) => (
              <OpponentSeat
                key={p.id}
                player={p}
                active={state.phase === "playing" && current?.id === p.id}
                timerPct={
                  state.phase === "playing" && current?.id === p.id
                    ? remainingPct
                    : null
                }
                pickingMode={you.picking}
                onPick={() => send({ t: "pickHand", targetId: p.id })}
              />
            ))}
            {others.length === 0 && (
              <p className="text-muted-foreground">他のプレイヤーを待機中…</p>
            )}
          </div>

          {/* 中央 */}
          <div className="relative flex flex-1 items-center justify-center gap-12">
            {/* デッキ */}
            <div className="flex flex-col items-center gap-2">
              <UnoCard
                faceDown
                size="lg"
                onClick={canDraw ? () => send({ t: "draw" }) : undefined}
                className={canDraw ? "" : "cursor-default"}
                ariaLabel="山札から引く"
              />
              <span className="text-muted-foreground text-xs">山札</span>
            </div>

            {/* 捨て札 */}
            <div className="flex flex-col items-center gap-2">
              {state.top ? (
                <UnoCard card={state.top} size="lg" ariaLabel="捨て札の一番上" />
              ) : (
                <div className="h-32 w-22 rounded-lg border-4 border-dashed border-white/30" />
              )}
              <div className="flex items-center gap-2">
                <ActiveColorDot color={state.activeColor} />
                <span className="text-muted-foreground text-xs">
                  {state.direction === 1 ? (
                    <ArrowUp className="size-4" aria-label="時計回り" />
                  ) : (
                    <ArrowDown className="size-4" aria-label="反時計回り" />
                  )}
                </span>
                {state.stack > 0 && (
                  <Badge variant="destructive">スタック +{state.stack}</Badge>
                )}
              </div>
            </div>

            {/* UNOボタン */}
            {you.canCallUno && isMyTurn && (
              <Button
                onClick={() => send({ t: "callUno" })}
                size="lg"
                className="absolute right-6 bottom-6 size-20 rounded-full text-xl font-black italic shadow-xl"
              >
                UNO!
              </Button>
            )}

            {/* チャット */}
            <ChatPanel
              open={chatOpen}
              onToggle={() => setChatOpen((v) => !v)}
              chat={chat}
              onSend={(text) => send({ t: "chat", text })}
            />
          </div>

          {/* ドロー後の選択 / 手番表示 */}
          <div className="flex h-10 items-center justify-center gap-3 px-4">
            {state.phase === "playing" && isMyTurn && you.drawnIds && (
              <>
                <Badge variant="secondary">{you.drawnIds.length}枚引きました</Badge>
                {you.mustPlay ? (
                  <span className="text-destructive text-sm font-semibold">
                    出せるカードを出してください
                  </span>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => send({ t: "keep" })}>
                    キープしてターン終了
                  </Button>
                )}
              </>
            )}
            {state.phase === "playing" &&
              isMyTurn &&
              !you.drawnIds &&
              !you.picking && <Badge>あなたの番です</Badge>}
            {you.picking && (
              <Badge variant="secondary">
                上のプレイヤーを選んで手札を交換
              </Badge>
            )}
            {!isMyTurn && state.phase === "playing" && (
              <span className="text-muted-foreground text-sm">
                {current?.name} の番です
              </span>
            )}
          </div>

          {/* 自分の手札 */}
          <div className="relative min-h-28 px-4 pb-4 pt-2">
            <Badge variant="secondary" className="absolute right-4 top-0 tabular-nums">
              {you.cards.length}枚
            </Badge>
            <div className="overflow-x-auto">
              <div className="mx-auto flex w-max items-end justify-center gap-1">
                {state.phase === "ended"
                  ? you.cards.map((c) => (
                      <UnoCard key={c.id} card={c} size="sm" dimmed />
                    ))
                  : you.cards.map((c, i) => {
                  const animIdx = drawnAnim.indexOf(c.id);
                  return (
                    <UnoCard
                      key={c.id}
                      card={c}
                      playable={isMyTurn && you.playable[i]}
                      dimmed={!isMyTurn && !you.playable[i]}
                      onClick={() => playCard(i)}
                      className={animIdx >= 0 ? "animate-uno-draw" : undefined}
                      style={
                        animIdx >= 0
                          ? { animationDelay: `${animIdx * DRAW_STEP_MS}ms` }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {/* 勝利ダイアログ */}
          <Dialog open={state.phase === "ended"}>
            <DialogContent>
              <DialogTitle className="text-center text-3xl font-extrabold">
                🎉 {state.winner?.name ?? "?"} の勝ち!
              </DialogTitle>
              <div className="mt-4 flex flex-col gap-3">
                {isHost && (
                  <Button size="lg" onClick={() => send({ t: "restart" })}>
                    <RotateCcw data-icon="inline-start" />
                    ロビーに戻る
                  </Button>
                )}
                <Button variant="outline" render={<a href="#/" />}>
                    <LogOut data-icon="inline-start" />
                    部屋を出る
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
      </div>

      {/* ワイルド色選択 */}
      <Dialog open={wildCard !== null} onOpenChange={(o) => !o && setWildCard(null)}>
        <DialogContent className="max-w-xs">
          <DialogTitle className="text-center">色を選択</DialogTitle>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {WILD_COLORS.map(({ color, className }) => (
              <button
                key={color}
                type="button"
                aria-label={`色: ${color}`}
                className={`h-16 rounded-lg border-4 border-white font-bold uppercase text-white shadow-md transition-transform hover:scale-105 ${className}`}
                onClick={() => {
                  if (!wildCard) return;
                  send({ t: "play", cardId: wildCard.id, color });
                  setWildCard(null);
                }}
              >
                {color}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- ロビー ----

function LobbyView({
  state,
  isHost,
  send,
}: {
  state: StateSnapshot;
  isHost: boolean;
  send: ReturnType<typeof useGameRoom>["send"];
}) {
  return (
    <UICard className="mx-auto my-4 w-full max-w-xl">
      <CardHeader className="items-center text-center">
        <CardTitle>ロビー</CardTitle>
        <CardDescription>下のコードを友だちに共有しましょう</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <CodeBox />
        <Separator />
        <section className="flex flex-col gap-1">
          <p className="text-muted-foreground text-sm font-semibold">
            プレイヤー ({state.players.length}/{state.settings.maxPlayers})
          </p>
          {state.players.map((p) => (
            <PlayerRow key={p.id} player={p} />
          ))}
        </section>
        <Separator />
        <section className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm font-semibold">ハウスルール</p>
          {RULE_TOGGLES.map((r) =>
            isHost ? (
              <label
                key={r.key}
                className="flex cursor-pointer items-center justify-between gap-4 rounded-md px-1 py-1 hover:bg-muted/50"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium">{r.label}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {r.desc}
                  </span>
                </span>
                <Switch
                  checked={state.settings[r.key]}
                  onCheckedChange={(v) => send({ t: "settings", patch: { [r.key]: v } })}
                  aria-label={r.label}
                />
              </label>
            ) : state.settings[r.key] ? (
              <Badge key={r.key} variant="secondary" className="w-fit">
                {r.label}
              </Badge>
            ) : null,
          )}
        </section>
        <Separator />
        {isHost ? (
          <Button
            size="lg"
            disabled={state.players.length < 2}
            onClick={() => send({ t: "start" })}
          >
            ゲーム開始 ({state.players.length}/2人以上)
          </Button>
        ) : (
          <p className="text-center text-muted-foreground">
            ホストが開始するのを待っています…
          </p>
        )}
        <Button variant="ghost" render={<a href="#/" />}>
            <LogOut data-icon="inline-start" />
            部屋を出る
        </Button>
      </CardContent>
    </UICard>
  );
}

function CodeBox() {
  const code = location.hash.split("/")[2]?.toUpperCase() ?? "";
  return (
    <div className="flex items-center justify-center gap-3">
      <span className="font-mono text-3xl font-black tracking-[0.4em]">{code}</span>
      <Button
        variant="outline"
        size="icon"
        aria-label="部屋コードをコピー"
        onClick={() => {
          navigator.clipboard
            .writeText(`${location.origin}${location.pathname}#/game/${code}`)
            .then(() => toast.success("招待リンクをコピーしました"));
        }}
      >
        <Copy />
      </Button>
    </div>
  );
}

function PlayerRow({ player }: { player: PubPlayer }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-1.5">
      <Avatarish name={player.name} />
      <span className="truncate font-medium">{player.name}</span>
      {player.host && (
        <Badge variant="secondary">
          <Crown data-icon="inline-start" />
          HOST
        </Badge>
      )}
      <Status variant={player.connected ? "success" : "error"} className="ml-auto">
        <StatusIndicator />
        <StatusLabel>{player.connected ? "ONLINE" : "OFFLINE"}</StatusLabel>
      </Status>
    </div>
  );
}

// ---- 対戦画面部品 ----

function OpponentSeat({
  player,
  active,
  timerPct,
  pickingMode,
  onPick,
}: {
  player: PubPlayer;
  active: boolean;
  timerPct: number | null;
  pickingMode: boolean;
  onPick: () => void;
}) {
  const body = (
    <>
      <Avatarish name={player.name} large active={active} />
      <span className="max-w-full truncate text-sm font-semibold">{player.name}</span>
      <Badge variant="secondary">{player.count}枚</Badge>
      {player.calledUno && <Badge variant="destructive">UNO!</Badge>}
      {timerPct !== null && (
        <Progress value={timerPct} className="h-1.5 w-full" aria-hidden />
      )}
    </>
  );
  if (pickingMode) {
    return (
      <button
        type="button"
        onClick={onPick}
        className="flex w-24 flex-col items-center gap-1 rounded-xl border-2 border-dashed border-primary p-2 transition-colors hover:bg-primary/10"
      >
        {body}
      </button>
    );
  }
  return (
    <div className="flex w-24 flex-col items-center gap-1 rounded-xl border p-2">
      {body}
    </div>
  );
}

function Avatarish({
  name,
  large,
  active,
}: {
  name: string;
  large?: boolean;
  active?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={`grid place-items-center rounded-full bg-primary/15 font-bold text-primary ring-2 ${
        large ? "size-10 text-lg" : "size-7 text-sm"
      } ${active ? "ring-primary" : "ring-transparent"}`}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

function ChatPanel({
  open,
  onToggle,
  chat,
  onSend,
}: {
  open: boolean;
  onToggle: () => void;
  chat: { name: string; text: string }[];
  onSend: (text: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="absolute left-4 bottom-4 flex flex-col items-start gap-2">
      {open && (
        <div className="flex h-56 w-72 flex-col rounded-lg border bg-card p-2 shadow-lg">
          <div className="flex-1 space-y-1 overflow-y-auto pr-1 text-sm">
            {chat.length === 0 && (
              <p className="text-muted-foreground">まだメッセージはありません</p>
            )}
            {chat.map((c, i) => (
              <p key={i} className="break-words">
                <span className="font-bold">{c.name}: </span>
                {c.text}
              </p>
            ))}
          </div>
          <form
            className="mt-1 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              const v = inputRef.current?.value.trim();
              if (!v) return;
              onSend(v);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            <Input
              ref={inputRef}
              placeholder="メッセージ…"
              maxLength={200}
              aria-label="チャットメッセージ"
            />
            <Button type="submit" size="icon" aria-label="送信">
              <Send />
            </Button>
          </form>
        </div>
      )}
      <Button
        variant="secondary"
        size="sm"
        onClick={onToggle}
        aria-expanded={open}
        aria-label="チャットを開閉"
      >
        <MessageCircle data-icon="inline-start" />
        チャット
      </Button>
    </div>
  );
}

// ---- URL 直打ち時の名前入力(localStorage に名前が無い場合のみ表示) ----

function NameGate({ onJoin }: { onJoin: () => void }) {
  const [value, setValue] = useState("");
  const submit = () => {
    const name = value.trim().slice(0, 16);
    if (!name) {
      toast.error("名前を入力してください");
      return;
    }
    setName(name);
    onJoin();
  };
  return (
    <div className="grid h-[calc(100dvh-3.5rem)] place-items-center p-4">
      <UICard className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>部屋に参加</CardTitle>
          <CardDescription>
            対戦に使う名前を入力してください(この端末に保存されます)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Input
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="名前を入力…"
              maxLength={16}
              autoFocus
              autoComplete="nickname"
              name="username"
              aria-label="プレイヤー名"
            />
            <Button type="submit" size="lg">
              参加する
            </Button>
          </form>
        </CardContent>
      </UICard>
    </div>
  );
}
