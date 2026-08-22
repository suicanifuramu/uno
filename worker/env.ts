import type { GameRoom } from "./room";

export interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  KV: KVNamespace;
  DB: D1Database;
  THEMES: R2Bucket;
  ASSETS: Fetcher;
}
