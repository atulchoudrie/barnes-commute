import "server-only";
import { BARNES, CROSSING, WATERLOO, applyLive, buildBoard, crossingTimes, parseDepartures, type Board, type CommuteConfig, type CrossingFeed, type LiveBarrier, type RttService } from "./commute";

// Realtime Trains API (free account: https://api.rtt.io). Credentials: RTT_USERNAME / RTT_PASSWORD.
const API = "https://api.rtt.io/api/v1/json/search";

async function search(path: string): Promise<RttService[]> {
  const user = process.env.RTT_USERNAME, pass = process.env.RTT_PASSWORD;
  if (!user || !pass) throw new Error("Set RTT_USERNAME and RTT_PASSWORD (free account at api.rtt.io)");
  const res = await fetch(`${API}/${path}`, {
    headers: { authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` },
    next: { revalidate: 30 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Realtime Trains returned ${res.status} for ${path}`);
  const j = await res.json();
  return Array.isArray(j.services) ? j.services : [];
}

// Trains over White Hart Lane crossing, from Mortlake times: towards Richmond ("down") they cross about a minute
// before reaching Mortlake; towards London ("up") about a minute after leaving it.
// Fast trains (e.g. Reading and Windsor) don't stop at Mortlake; unless the account returns them as passes there,
// they're picked up from Clapham Junction / Richmond and their crossing time estimated.
const FEEDS: { path: string; feed: CrossingFeed }[] = [
  { path: `${CROSSING.station.crs}/from/${BARNES.crs}`, feed: { kind: "arrives", minutes: 1, group: "down" } },
  { path: `${CROSSING.station.crs}/to/${BARNES.crs}`, feed: { kind: "departs", minutes: 1, group: "up" } },
  { path: "CLJ/to/RMD", feed: { kind: "departs", minutes: 6, group: "down", estimated: true } },
  { path: "RMD/to/CLJ", feed: { kind: "departs", minutes: 3, group: "up", estimated: true } },
];

/** Live barrier state from the always-on worker (worker/barrier), if BARRIER_LIVE_URL is set. Null if it can't be reached. */
async function loadLive(): Promise<LiveBarrier | null> {
  const url = process.env.BARRIER_LIVE_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/status`, {
      headers: { "x-worker-key": process.env.BARRIER_LIVE_KEY ?? "" },
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

export async function loadBoard(cfg: CommuteConfig, now = Date.now()): Promise<Board> {
  const [live, departures, ...barrier] = await Promise.all([
    loadLive(),
    search(`${BARNES.crs}/to/${WATERLOO.crs}`),
    // One failed barrier feed shouldn't take the train times down with it.
    ...FEEDS.map((f) => search(f.path).catch(() => [] as RttService[])),
  ]);
  const crossing = FEEDS.flatMap((f, i) => crossingTimes(barrier[i], f.feed, now));
  const board = buildBoard(parseDepartures(departures, now), crossing, cfg, now);
  return { ...board, barrier: applyLive(board.barrier, live, now) };
}

/** The board and its JSON are public URLs (so a phone widget can read them); COMMUTE_KEY, if set, must be passed as ?key=. */
export function commuteKeyOk(key: string | null | undefined): boolean {
  const expected = process.env.COMMUTE_KEY;
  return !expected || key === expected;
}
