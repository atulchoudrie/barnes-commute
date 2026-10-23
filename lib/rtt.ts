import "server-only";
import { BARNES, CROSSING, WATERLOO, applyLive, buildBoard, crossingTimes, parseDepartures, type Board, type CommuteConfig, type CrossingFeed, type LiveBarrier, type RttService } from "./commute";

// Realtime Trains API (https://data.rtt.io). Token from https://api-portal.rtt.io: RTT_TOKEN.
// The free plan allows 10 requests a minute, 100 an hour and 1,000 a day, so every lookup is cached and shared
// between page loads and the widget (Next's data cache): departures for 4 minutes, barrier forecast for 10.
// Worst case, viewed non-stop all day, that's about 40 requests an hour.
const API = "https://data.rtt.io";
const API_VERSION = "2026-04-09";
const DEPARTURES_CACHE_S = 240;
const BARRIER_CACHE_S = 600;

// A token from the portal is either a long-life access token (used directly) or a refresh token, which is
// exchanged for a short-life access token. Which one is found out on first use.
let access: { token: string; until: number } | null = null;

async function accessToken(): Promise<string> {
  const token = process.env.RTT_TOKEN;
  if (!token) throw new Error("Set RTT_TOKEN (free token from api-portal.rtt.io)");
  if (access && access.until - 60_000 > Date.now()) return access.token;
  return token;
}

async function exchangeRefreshToken(): Promise<boolean> {
  const res = await fetch(`${API}/api/get_access_token`, {
    headers: { authorization: `Bearer ${process.env.RTT_TOKEN}`, accept: "application/json", version: API_VERSION },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return false;
  const j = await res.json();
  if (typeof j.token !== "string") return false;
  access = { token: j.token, until: Date.parse(j.validUntil) || Date.now() + 10 * 60_000 };
  return true;
}

async function location(params: Record<string, string>, revalidate: number): Promise<RttService[]> {
  const url = `${API}/gb-nr/location?${new URLSearchParams({ timeWindow: "120", ...params })}`;
  const get = async () => fetch(url, {
    headers: { authorization: `Bearer ${await accessToken()}`, accept: "application/json", version: API_VERSION },
    next: { revalidate },
    signal: AbortSignal.timeout(8000),
  });
  let res = await get();
  if ((res.status === 401 || res.status === 403) && !access && (await exchangeRefreshToken())) res = await get();
  if (res.status === 204) return [];
  if (res.status === 401 || res.status === 403) throw new Error("Realtime Trains didn't accept RTT_TOKEN – check it on api-portal.rtt.io");
  if (res.status === 429) throw new Error("Realtime Trains request limit reached – it'll be back shortly");
  if (!res.ok) throw new Error(`Realtime Trains returned ${res.status}`);
  const j = await res.json();
  return Array.isArray(j.services) ? j.services : [];
}

// Trains over White Hart Lane crossing, from Mortlake times: towards Richmond ("down") they cross about a minute
// before reaching Mortlake; towards London ("up") about a minute after leaving it.
// Fast trains (e.g. Reading and Windsor) don't stop at Mortlake; unless the account returns them as passes there,
// they're picked up from Clapham Junction / Richmond and their crossing time estimated.
const FEEDS: { params: Record<string, string>; feed: CrossingFeed }[] = [
  { params: { code: CROSSING.station.crs, filterFrom: BARNES.crs }, feed: { kind: "arrives", minutes: 1, group: "down" } },
  { params: { code: CROSSING.station.crs, filterTo: BARNES.crs }, feed: { kind: "departs", minutes: 1, group: "up" } },
  { params: { code: "CLJ", filterTo: "RMD" }, feed: { kind: "departs", minutes: 6, group: "down", estimated: true } },
  { params: { code: "RMD", filterTo: "CLJ" }, feed: { kind: "departs", minutes: 3, group: "up", estimated: true } },
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
    location({ code: BARNES.crs, filterTo: WATERLOO.crs }, DEPARTURES_CACHE_S),
    // One failed barrier feed shouldn't take the train times down with it.
    ...FEEDS.map((f) => location(f.params, BARRIER_CACHE_S).catch(() => [] as RttService[])),
  ]);
  const crossing = FEEDS.flatMap((f, i) => crossingTimes(barrier[i], f.feed));
  const board = buildBoard(parseDepartures(departures, now), crossing, cfg, now);
  return { ...board, barrier: applyLive(board.barrier, live, now) };
}

/** The board and its JSON are public URLs (so a phone widget can read them); COMMUTE_KEY, if set, must be passed as ?key=. */
export function commuteKeyOk(key: string | null | undefined): boolean {
  const expected = process.env.COMMUTE_KEY;
  return !expected || key === expected;
}
