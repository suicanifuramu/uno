import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, Plus, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Status, StatusIndicator, StatusLabel } from "@/components/ui/status";
import { Separator } from "@/components/ui/separator";
import { SegmentedInput, SegmentedInputItem } from "@/components/ui/segmented-input";
import {
  createRoom,
  fetchPublicRooms,
  getName,
  goGame,
  setName,
  type PublicRoomInfo,
} from "@/lib/client";

const CODE_LEN = 5;

export default function Home() {
  const [name, setNameState] = useState(getName());
  const [code, setCode] = useState<string[]>(Array(CODE_LEN).fill(""));
  const [creating, setCreating] = useState<"create" | "quick" | null>(null);
  const [rooms, setRooms] = useState<PublicRoomInfo[] | null>(null);
  const itemRefs = useRef<(HTMLInputElement | null)[]>([]);

  const refreshRooms = useCallback(() => {
    fetchPublicRooms()
      .then((r) => setRooms(r.rooms))
      .catch(() => setRooms([]));
  }, []);

  useEffect(() => {
    refreshRooms();
    const id = setInterval(refreshRooms, 5000);
    return () => clearInterval(id);
  }, [refreshRooms]);

  const persistName = (v: string) => {
    setNameState(v);
    setName(v.trim().slice(0, 16));
  };

  const requireName = (): boolean => {
    if (!name.trim()) {
      toast.error("名前を入力してください");
      return false;
    }
    return true;
  };

  const onCreate = async (quickplay: boolean) => {
    if (!requireName()) return;
    setCreating(quickplay ? "quick" : "create");
    try {
      const { code: c } = await createRoom(quickplay);
      goGame(c);
    } catch {
      toast.error("部屋を作成できませんでした");
      setCreating(null);
    }
  };

  const onJoinCode = () => {
    if (!requireName()) return;
    const joined = code.join("").toUpperCase();
    if (joined.length !== CODE_LEN) {
      toast.error("コードを入力してください");
      return;
    }
    goGame(joined);
  };

  const setChar = (i: number, v: string) => {
    const ch = v.replace(/[^a-zA-Z0-9]/g, "").slice(-1).toUpperCase();
    const next = [...code];
    next[i] = ch;
    setCode(next);
    if (ch && i < CODE_LEN - 1) itemRefs.current[i + 1]?.focus();
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 p-4">
      <section className="flex flex-col items-center gap-3 py-10 text-center">
        <div className="flex -space-x-6">
          <CardPreview color="bg-red-600" label="7" />
          <CardPreview color="bg-blue-600" label="⇄" />
          <CardPreview color="conic" label="+4" />
        </div>
        <h1 className="text-4xl font-extrabold tracking-tight">UNO Online</h1>
        <p className="text-muted-foreground">
          ブラウザだけでオンライン対戦。ハウスルール付きのUNO。
        </p>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>プレイヤー名</CardTitle>
          <CardDescription>16文字まで。この端末に保存されます。</CardDescription>
        </CardHeader>
        <CardContent>
          <Input
            value={name}
            onChange={(e) => persistName(e.target.value)}
            placeholder="名前を入力…"
            maxLength={16}
            className="max-w-xs text-base"
            name="username"
            autoComplete="nickname"
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>はじめる</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button
              size="lg"
              onClick={() => onCreate(false)}
              disabled={creating !== null}
            >
              {creating === "create" ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Plus data-icon="inline-start" />
              )}
              部屋を作成
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={() => onCreate(true)}
              disabled={creating !== null}
            >
              {creating === "quick" ? (
                <Loader2 data-icon="inline-start" className="animate-spin" />
              ) : (
                <Play data-icon="inline-start" />
              )}
              クイックプレイ
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>コードで参加</CardTitle>
            <CardDescription>友だちの部屋コード({CODE_LEN}文字)</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <SegmentedInput aria-label="Room code">
              {code.map((c, i) => (
                <SegmentedInputItem
                  key={i}
                  ref={(el) => {
                    itemRefs.current[i] = el;
                  }}
                  value={c}
                  onInput={(e) => setChar(i, (e.target as HTMLInputElement).value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") onJoinCode();
                    if (e.key === "Backspace" && !code[i] && i > 0)
                      itemRefs.current[i - 1]?.focus();
                  }}
                  maxLength={1}
                  inputMode="text"
                  autoComplete="off"
                  className="size-14 text-center font-mono text-2xl uppercase"
                />
              ))}
            </SegmentedInput>
            <Button size="lg" variant="outline" onClick={onJoinCode}>
              参加
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>公開中の部屋</CardTitle>
            <CardDescription>ロビーで待機中の部屋</CardDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={refreshRooms} aria-label="更新">
            <RefreshCw />
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {rooms === null && <p className="text-muted-foreground">読み込み中…</p>}
          {rooms?.length === 0 && (
            <p className="text-muted-foreground">
              公開部屋はありません。自分で作成しましょう!
            </p>
          )}
          {rooms?.map((r) => (
            <div
              key={r.code}
              className="flex items-center gap-3 rounded-lg border p-3"
            >
              <Status variant="success">
                <StatusIndicator />
                <StatusLabel>待機中</StatusLabel>
              </Status>
              <span className="font-mono text-lg font-bold tracking-widest">
                {r.code}
              </span>
              <Badge variant="secondary" className="ml-auto">
                <Users data-icon="inline-start" />
                {r.count}/{r.max}
              </Badge>
              <Button size="sm" onClick={() => goGame(r.code)}>
                参加
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Separator />

      <footer className="pb-8 flex justify-center gap-6 text-sm text-muted-foreground">
        <a href="#/rules" className="underline underline-offset-4">
          ルール
        </a>
        <a href="#/leaderboard" className="underline underline-offset-4">
          リーダーボード
        </a>
      </footer>
    </div>
  );
}

function CardPreview({ color, label }: { color: string; label: string }) {
  return (
    <span
      aria-hidden
      className={`grid h-20 w-14 place-items-center rotate-[-8deg] rounded-lg border-4 border-white text-xl font-black italic text-white shadow-md ${color === "conic" ? "bg-[conic-gradient(from_180deg,#e7000b_0deg,#14b8a6_90deg,#f59e0b_180deg,#2563eb_270deg,#e7000b_360deg)]" : color}`}
    >
      <span className="absolute inset-[12%] -rotate-[20deg] rounded-full bg-white/95" />
      <span className="relative z-10 not-italic text-neutral-900">{label}</span>
    </span>
  );
}
