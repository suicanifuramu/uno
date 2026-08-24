import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { ClientMsg, ServerMsg, StateSnapshot } from "@/shared/types";

const NAME_KEY = "uno:name";

export function getName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* noop */
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json() as Promise<T>;
}

export const createRoom = (quickplay: boolean) =>
  api<{ code: string }>("/api/rooms", {
    method: "POST",
    body: JSON.stringify({ quickplay }),
  });

export interface PublicRoomInfo {
  code: string;
  count: number;
  max: number;
}

export const fetchPublicRooms = () =>
  api<{ rooms: PublicRoomInfo[] }>("/api/rooms/public");

export const fetchLeaderboard = () =>
  api<{ rows: { name: string; wins: number }[] }>("/api/leaderboard");

export function goGame(code: string) {
  location.hash = `/game/${code.toUpperCase()}`;
}

export interface ChatEntry {
  name: string;
  text: string;
}

/** 部屋への WebSocket 接続と state 管理(enabled=false の間は接続しない) */
export function useGameRoom(code: string, opts?: { enabled?: boolean }) {
  const [state, setState] = useState<StateSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const enabled = opts?.enabled ?? true;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${location.host}/ws/${encodeURIComponent(code)}`);
    wsRef.current = socket;

    socket.onopen = () => {
      if (disposed) return;
      setConnected(true);
      socket.send(
        JSON.stringify({
          t: "join",
          name: getName() || "Player",
          playerId: localStorage.getItem(`uno:p:${code}`) ?? undefined,
        }),
      );
    };
    socket.onclose = () => {
      if (!disposed) setConnected(false);
    };
    socket.onmessage = (ev) => {
      if (disposed) return;
      const msg = JSON.parse(String(ev.data)) as ServerMsg;
      switch (msg.t) {
        case "init":
          localStorage.setItem(`uno:p:${code}`, msg.playerId);
          break;
        case "state":
          setState(msg.s);
          break;
        case "toast":
          toast.info(msg.text);
          break;
        case "chat":
          setChat((c) => [...c.slice(-49), { name: msg.name, text: msg.text }]);
          break;
      }
    };
    return () => {
      disposed = true;
      socket.close();
      wsRef.current = null;
    };
  }, [code, enabled]);

  const send = useCallback((msg: ClientMsg) => {
    wsRef.current?.send(JSON.stringify(msg));
  }, []);

  return { state, connected, chat, send };
}

/** 指定間隔で Date.now() を返す(タイマー表示用) */
export function useTick(intervalMs: number): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** 2音チャイム(880→1320Hz)を鳴らす。自分の手番遷移時に呼ぶ */
export function playChime() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.12;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.2);
    });
    setTimeout(() => ctx.close(), 600);
  } catch {
    /* noop */
  }
}
