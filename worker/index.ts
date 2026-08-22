import type { Env } from "./env";

export { GameRoom } from "./room";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

interface PublicRoomInfo {
  code: string;
  count: number;
  max: number;
}

/** UI テーマ(R2 に無ければこれを使う)。/api/theme 経由で配信 */
const DEFAULT_THEME = {
  id: "classic",
  name: "Classic",
  table: "#0d5c34",
  accent: "#e7000b",
};

function genCode(): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

async function createRoom(
  env: Env,
  opts: { publicRoom: boolean },
): Promise<string> {
  // 衝突チェック(KV に公開部屋として載っていないコードを採用)
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = genCode();
    const existing = await env.KV.get(`room:${code}`);
    if (!existing) {
      const stub = env.ROOMS.getByName(code);
      await stub.setPublic(opts.publicRoom);
      return code;
    }
  }
  throw new Error("could not allocate room code");
}

async function listPublicRooms(env: Env): Promise<PublicRoomInfo[]> {
  const out: PublicRoomInfo[] = [];
  const list = await env.KV.list<PublicRoomInfo>({ prefix: "room:" });
  for (const key of list.keys) {
    const v = await env.KV.get<PublicRoomInfo>(key.name, "json");
    if (v && v.count > 0) out.push(v);
  }
  return out.sort((a, b) => a.count - b.count);
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    const body = (await request.json().catch(() => ({}))) as {
      quickplay?: boolean;
      publicRoom?: boolean;
    };
    if (body.quickplay) {
      const rooms = await listPublicRooms(env);
      const open = rooms.find((r) => r.count < r.max);
      if (open) return json({ code: open.code });
    }
    const code = await createRoom(env, { publicRoom: body.publicRoom ?? true });
    return json({ code });
  }

  if (request.method === "GET" && url.pathname === "/api/rooms/public") {
    return json({ rooms: await listPublicRooms(env) });
  }

  if (request.method === "GET" && url.pathname === "/api/leaderboard") {
    const { results } = await env.DB.prepare(
      "SELECT winner_name AS name, COUNT(*) AS wins FROM matches GROUP BY winner_name ORDER BY wins DESC LIMIT 10",
    ).all();
    return json({ rows: results });
  }

  if (request.method === "GET" && url.pathname === "/api/theme") {
    const obj = await env.THEMES.get("theme.json");
    if (obj) {
      return new Response(obj.body, {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
      });
    }
    return json(DEFAULT_THEME);
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    if (url.pathname.startsWith("/ws/")) {
      const code = url.pathname.split("/")[2]?.toUpperCase() ?? "";
      if (!/^[A-Z0-9]{4,12}$/.test(code)) {
        return json({ error: "invalid room code" }, 400);
      }
      const stub = env.ROOMS.getByName(code);
      return stub.fetch(request);
    }
    // 静的アセット(SPA フォールバックは assets 設定が処理)
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
