import { useEffect, useState } from "react";
import { Toaster } from "sonner";
import { ThemeToggle } from "@/components/theme-toggle";
import { RulesDialog } from "@/components/rules-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import Leaderboard from "@/pages/Leaderboard";
import Game from "@/pages/Game";
import Home from "@/pages/Home";

function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const route = useHashRoute();
  const gameMatch = route.match(/^#\/game\/([A-Za-z0-9]{4,12})/);
  const inGame = !!gameMatch;

  const [rulesOpen, setRulesOpen] = useState(false);
  /** Game が報告する対戦フェーズ(プレイ中の離脱ガードに使用) */
  const [gamePhase, setGamePhase] = useState<"lobby" | "playing" | "ended" | null>(
    null,
  );
  const playing = inGame && gamePhase === "playing";
  /** 確認後に遷移するハッシュ */
  const [pendingNav, setPendingNav] = useState<string | null>(null);

  const navigate = (hash: string) => {
    if (playing) {
      setPendingNav(hash);
    } else {
      location.hash = hash;
    }
  };

  let view = <Home />;
  if (gameMatch) {
    view = <Game code={gameMatch[1].toUpperCase()} onPhaseChange={setGamePhase} />;
  } else if (route.startsWith("#/rules")) {
    // 直接リンク用。ヘッダーからはオーバーレイで開く
    view = (
      <div className="mx-auto w-full max-w-3xl p-4">
        <Button variant="outline" onClick={() => setRulesOpen(true)}>
          ルールを開く
        </Button>
      </div>
    );
  } else if (route.startsWith("#/leaderboard")) {
    view = <Leaderboard />;
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="flex h-14 items-center gap-4 border-b px-4">
        <a
          href="#/"
          onClick={(e) => {
            e.preventDefault();
            navigate("#/");
          }}
          className="text-lg font-black italic tracking-tight"
        >
          UNO<span className="text-primary">Online</span>
        </a>
        <nav className="ml-auto flex gap-4 text-sm">
          <a
            href="#/"
            onClick={(e) => {
              e.preventDefault();
              navigate("#/");
            }}
            aria-current={route === "#/" || route === "" ? "page" : undefined}
            className="underline-offset-4 hover:text-primary hover:underline"
          >
            ホーム
          </a>
          <button
            type="button"
            onClick={() => setRulesOpen(true)}
            className="text-sm underline-offset-4 hover:text-primary hover:underline"
          >
            ルール
          </button>
          <a
            href="#/leaderboard"
            onClick={(e) => {
              e.preventDefault();
              navigate("#/leaderboard");
            }}
            aria-current={
              route.startsWith("#/leaderboard") ? "page" : undefined
            }
            className="underline-offset-4 hover:text-primary hover:underline"
          >
            ランキング
          </a>
        </nav>
        <ThemeToggle />
      </header>
      <main className="flex-1">{view}</main>

      {/* ルールオーバーレイ */}
      <RulesDialog open={rulesOpen} onOpenChange={setRulesOpen} />

      {/* プレイ中の離脱確認オーバーレイ */}
      <Dialog
        open={pendingNav !== null}
        onOpenChange={(o) => !o && setPendingNav(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogTitle className="text-center">対戦を離れますか?</DialogTitle>
          <DialogDescription className="text-center">
            対戦中に離れると、あなたの手番は自動的にスキップされます。
          </DialogDescription>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Button variant="outline" onClick={() => setPendingNav(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingNav) location.hash = pendingNav;
                setPendingNav(null);
              }}
            >
              離れる
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Toaster position="top-center" richColors />
    </div>
  );
}
