// Barnes → London Waterloo commute board: when to leave the house for each train, and when the
// White Hart Lane level-crossing barrier is down. Pure functions only (no fetching), so they can be tested.
// Train data comes from the Realtime Trains API (see lib/rtt.ts).

export const BARNES = { crs: "BNS", name: "Barnes", lat: 51.46705, lon: -0.24227 };
export const WATERLOO = { crs: "WAT", name: "London Waterloo" };
/** White Hart Lane level crossing, on the Richmond line about 600 m east of Mortlake station. */
export const CROSSING = { name: "White Hart Lane barrier", station: { crs: "MTL", name: "Mortlake" } };

export interface CommuteConfig {
  /** Minutes from deciding to go to being out of the front door (shoes, coat, lock up). */
  getOutMinutes: number;
  /** Walk from the front door to the platform. */
  walkMinutes: number;
  /** How the walk time was worked out, for display. */
  walkSource: "set" | "home location" | "default";
  /** Minutes to spare on the platform before the train leaves. */
  platformBufferMinutes: number;
  /** Barrier comes down this long before a train reaches the crossing… */
  barrierCloseBeforeMinutes: number;
  /** …and goes up this long after. */
  barrierOpenAfterMinutes: number;
  /** If the walk to the station goes over the crossing, minutes from the front door to the crossing. Null if it doesn't. */
  walkToCrossingMinutes: number | null;
}

const MIN = 60_000;
const WALK_METRES_PER_MIN = 80; // ≈ 4.8 km/h
const STREET_DETOUR = 1.3; // streets aren't straight lines

/** Straight-line distance in metres. */
export function distanceMetres(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/** Walking minutes from a home location to Barnes station (rounded up). */
export function walkMinutesFrom(lat: number, lon: number): number {
  const metres = distanceMetres(lat, lon, BARNES.lat, BARNES.lon) * STREET_DETOUR;
  return Math.max(1, Math.ceil(metres / WALK_METRES_PER_MIN));
}

function num(v: string | undefined): number | null {
  if (v == null || v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Settings from environment variables (see .env.example), with sensible defaults. */
export function configFromEnv(env: Record<string, string | undefined>): CommuteConfig {
  const lat = num(env.COMMUTE_HOME_LAT), lon = num(env.COMMUTE_HOME_LON), walk = num(env.COMMUTE_WALK_MINUTES);
  let walkMinutes = 15, walkSource: CommuteConfig["walkSource"] = "default"; // about White Hart Lane to Barnes station
  if (walk != null) { walkMinutes = walk; walkSource = "set"; }
  else if (lat != null && lon != null) { walkMinutes = walkMinutesFrom(lat, lon); walkSource = "home location"; }
  return {
    getOutMinutes: num(env.COMMUTE_GET_OUT_MINUTES) ?? 2,
    walkMinutes,
    walkSource,
    platformBufferMinutes: num(env.COMMUTE_PLATFORM_BUFFER_MINUTES) ?? 1,
    barrierCloseBeforeMinutes: num(env.COMMUTE_BARRIER_CLOSE_BEFORE_MINUTES) ?? 3,
    barrierOpenAfterMinutes: num(env.COMMUTE_BARRIER_OPEN_AFTER_MINUTES) ?? 1,
    walkToCrossingMinutes: num(env.COMMUTE_WALK_TO_CROSSING_MINUTES),
  };
}

// ---------- UK time ----------

function londonOffsetMs(t: number): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

/** "2026-10-23" + "0812" (UK local time) → epoch ms. Half-minute times like "0812H" are accepted. */
export function londonTime(date: string, hhmm: string, addDays = 0): number {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d + addDays, +hhmm.slice(0, 2), +hhmm.slice(2, 4), hhmm.endsWith("H") ? 30 : 0);
  const first = guess - londonOffsetMs(guess);
  return guess - londonOffsetMs(first);
}

/** Epoch ms → "08:12" in UK time. */
export function formatClock(t: number): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

// ---------- Realtime Trains records ----------

/** The parts of a Realtime Trains location-search service we use. */
export interface RttService {
  serviceUid: string;
  runDate: string;
  trainIdentity?: string;
  serviceType?: string;
  locationDetail: {
    displayAs?: string;
    isPublicCall?: boolean;
    gbttBookedArrival?: string; gbttBookedArrivalNextDay?: boolean;
    gbttBookedDeparture?: string; gbttBookedDepartureNextDay?: boolean;
    realtimeArrival?: string; realtimeArrivalNextDay?: boolean; realtimeArrivalActual?: boolean;
    realtimeDeparture?: string; realtimeDepartureNextDay?: boolean; realtimeDepartureActual?: boolean;
    realtimePass?: string; realtimePassNextDay?: boolean;
    wttBookedPass?: string; wttBookedPassNextDay?: boolean;
    wttBookedArrival?: string; wttBookedDeparture?: string;
    platform?: string; platformConfirmed?: boolean;
    cancelReasonShortText?: string;
    destination?: { description: string }[];
    origin?: { description: string }[];
  };
}

function at(s: RttService, hhmm: string | undefined, nextDay: boolean | undefined, now: number): number | null {
  if (!hhmm) return null;
  let t = londonTime(s.runDate, hhmm, nextDay ? 1 : 0);
  if (!nextDay && t < now - 12 * 60 * MIN) t = londonTime(s.runDate, hhmm, 1); // ran past midnight without a flag
  return t;
}

const isCancelled = (s: RttService) => (s.locationDetail.displayAs ?? "").startsWith("CANCELLED");

// ---------- Departures ----------

export interface Departure {
  uid: string;
  scheduled: number;
  expected: number;
  delayMinutes: number;
  platform: string | null;
  destination: string;
  cancelled: boolean;
  cancelReason: string | null;
  bus: boolean;
}

/** Waterloo-bound departures from Barnes, soonest first. */
export function parseDepartures(services: RttService[], now: number): Departure[] {
  const out: Departure[] = [];
  for (const s of services) {
    const l = s.locationDetail;
    if (l.isPublicCall === false || l.displayAs === "PASS" || l.displayAs === "DESTINATION" || l.displayAs === "TERMINATES") continue;
    const scheduled = at(s, l.gbttBookedDeparture, l.gbttBookedDepartureNextDay, now);
    if (scheduled == null) continue;
    const expected = at(s, l.realtimeDeparture, l.realtimeDepartureNextDay, now) ?? scheduled;
    if (l.realtimeDepartureActual || expected < now - MIN) continue; // already gone
    out.push({
      uid: s.serviceUid,
      scheduled,
      expected,
      delayMinutes: Math.max(0, Math.round((expected - scheduled) / MIN)),
      platform: l.platform ?? null,
      destination: l.destination?.[0]?.description ?? WATERLOO.name,
      cancelled: isCancelled(s),
      cancelReason: l.cancelReasonShortText ?? null,
      bus: s.serviceType === "bus",
    });
  }
  return out.sort((a, b) => a.expected - b.expected);
}

// ---------- Barrier ----------

/**
 * How to get the time a train reaches the crossing from its times at the feed's station:
 * `departs` – it crosses `minutes` after leaving (or passing) that station; `arrives` – `minutes` before arriving (or passing).
 * `estimated` feeds are trains timed further away, used to catch fast trains that don't stop.
 */
export interface CrossingFeed {
  kind: "departs" | "arrives";
  minutes: number;
  /** Line direction, e.g. "down". Feeds for the same group describe the same trains over the crossing. */
  group: string;
  estimated?: boolean;
}

/** `id` is the train plus direction, so a train seen in two feeds for the same direction is only counted once. */
export interface CrossingTrain { id: string; time: number; estimated: boolean }

/** Times trains reach the crossing, from one feed. */
export function crossingTimes(services: RttService[], feed: CrossingFeed, now: number): CrossingTrain[] {
  const out: CrossingTrain[] = [];
  const sign = feed.kind === "departs" ? 1 : -1;
  for (const s of services) {
    if (isCancelled(s) || s.serviceType === "bus") continue;
    const l = s.locationDetail;
    let base: number | null;
    if (l.displayAs === "PASS") {
      base = at(s, l.realtimePass ?? l.wttBookedPass, l.realtimePass ? l.realtimePassNextDay : l.wttBookedPassNextDay, now);
    } else if (feed.kind === "departs") {
      base = at(s, l.realtimeDeparture ?? l.gbttBookedDeparture ?? l.wttBookedDeparture, l.realtimeDeparture ? l.realtimeDepartureNextDay : l.gbttBookedDepartureNextDay, now);
    } else {
      base = at(s, l.realtimeArrival ?? l.gbttBookedArrival ?? l.wttBookedArrival, l.realtimeArrival ? l.realtimeArrivalNextDay : l.gbttBookedArrivalNextDay, now);
    }
    if (base != null) out.push({ id: `${s.serviceUid}:${feed.group}`, time: base + sign * feed.minutes * MIN, estimated: !!feed.estimated });
  }
  return out;
}

export interface BarrierWindow { closes: number; opens: number; trains: number }

/**
 * When the barrier is down: each train closes it from `closeBefore` until `openAfter` around its crossing time.
 * Closures less than a minute apart are joined, since the barrier stays down between them.
 * A train already seen in a more accurate feed (same id) is only counted once.
 */
export function barrierWindows(trains: CrossingTrain[], cfg: Pick<CommuteConfig, "barrierCloseBeforeMinutes" | "barrierOpenAfterMinutes">): BarrierWindow[] {
  const byId = new Map<string, CrossingTrain>();
  for (const t of trains) {
    const seen = byId.get(t.id);
    if (!seen || (seen.estimated && !t.estimated)) byId.set(t.id, t);
  }
  const sorted = [...byId.values()].sort((a, b) => a.time - b.time);
  const out: BarrierWindow[] = [];
  for (const t of sorted) {
    const closes = t.time - cfg.barrierCloseBeforeMinutes * MIN, opens = t.time + cfg.barrierOpenAfterMinutes * MIN;
    const last = out[out.length - 1];
    if (last && closes - last.opens < MIN) { last.opens = Math.max(last.opens, opens); last.trains++; }
    else out.push({ closes, opens, trains: 1 });
  }
  return out;
}

export interface BarrierStatus {
  down: boolean;
  /** When it next changes: opens (if down) or closes (if up). Null if nothing more is known. */
  changesAt: number | null;
  windows: BarrierWindow[];
}

export function barrierStatus(windows: BarrierWindow[], now: number): BarrierStatus {
  const upcoming = windows.filter((w) => w.opens > now);
  const current = upcoming.find((w) => w.closes <= now);
  return {
    down: !!current,
    changesAt: current ? current.opens : upcoming[0]?.closes ?? null,
    windows: upcoming,
  };
}

// ---------- When to leave ----------

export interface Plan {
  /** Start heading out (put shoes on) at this time. */
  leaveAt: number;
  /** Minutes from now until leaveAt (negative = should already have left). */
  leaveInMinutes: number;
  /** How much earlier you have to leave because the barrier would otherwise be down on your walk. */
  barrierExtraMinutes: number;
}

/** Latest time to set off and still be on the platform `platformBufferMinutes` before the train leaves. */
export function planLeave(departure: number, cfg: CommuteConfig, windows: BarrierWindow[], now: number): Plan {
  const deadline = departure - cfg.platformBufferMinutes * MIN;
  const arriveIfLeaving = (leave: number) => {
    const out = leave + cfg.getOutMinutes * MIN;
    if (cfg.walkToCrossingMinutes == null) return out + cfg.walkMinutes * MIN;
    const reach = out + cfg.walkToCrossingMinutes * MIN;
    const closed = windows.find((w) => w.closes <= reach && reach < w.opens);
    return (closed ? closed.opens : reach) + (cfg.walkMinutes - cfg.walkToCrossingMinutes) * MIN;
  };
  const straight = deadline - (cfg.getOutMinutes + cfg.walkMinutes) * MIN;
  let leave = straight;
  // A barrier closure can make the straight calculation too late; step back until it works (or give up after an hour).
  for (let i = 0; arriveIfLeaving(leave) > deadline && i < 240; i++) leave -= 15_000;
  return { leaveAt: leave, leaveInMinutes: Math.floor((leave - now) / MIN), barrierExtraMinutes: Math.ceil((straight - leave) / MIN) };
}

// ---------- The board ----------

export interface BoardTrain extends Departure { plan: Plan | null; catchable: boolean }

export interface Board {
  generatedAt: number;
  from: string;
  to: string;
  config: CommuteConfig;
  /** Door-to-platform minutes, without any barrier wait. */
  journeyMinutes: number;
  trains: BoardTrain[];
  /** The first train you can still make. */
  next: BoardTrain | null;
  barrier: BoardBarrier;
}

export interface BoardBarrier extends BarrierStatus {
  name: string;
  /** "live": from where trains actually are (worker/barrier); "timetable": estimated from train times. */
  source: "live" | "timetable";
  /** Up, but a train is heading for the crossing (live only). */
  closingSoon: boolean;
  /** Live: trains near the crossing. */
  liveTrains: { descr: string; direction: string; role: string }[];
}

/** What the barrier worker's /status returns (the parts used here). */
export interface LiveBarrier {
  feed?: { state: string };
  lastMessageAt: number | null;
  down: boolean;
  closingSoon: boolean;
  trains: { descr: string; direction: string; role: string }[];
}

const LIVE_STALE_MS = 3 * 60_000; // the feed sends a heartbeat for each area about once a minute

/**
 * Use the live state when the worker is connected and hearing from the area; the timetable windows stay as the
 * forecast of later closures and to guess when a live closure will end.
 */
export function applyLive(b: BoardBarrier, live: LiveBarrier | null, now: number): BoardBarrier {
  if (!live || live.feed?.state !== "connected" || live.lastMessageAt == null || now - live.lastMessageAt > LIVE_STALE_MS) return b;
  const current = b.windows.find((w) => w.closes <= now && now < w.opens);
  const later = b.windows.find((w) => w.closes > now);
  return {
    ...b,
    source: "live",
    down: live.down,
    closingSoon: !live.down && live.closingSoon,
    changesAt: live.down ? current?.opens ?? null : live.closingSoon ? null : later?.closes ?? null,
    liveTrains: live.trains,
  };
}

export function buildBoard(departures: Departure[], crossing: CrossingTrain[], cfg: CommuteConfig, now: number): Board {
  const windows = barrierWindows(crossing, cfg);
  const trains = departures.map((d) => {
    const plan = d.cancelled ? null : planLeave(d.expected, cfg, windows, now);
    return { ...d, plan, catchable: !!plan && plan.leaveAt >= now - 30_000 };
  });
  return {
    generatedAt: now,
    from: BARNES.name,
    to: WATERLOO.name,
    config: cfg,
    journeyMinutes: cfg.getOutMinutes + cfg.walkMinutes + cfg.platformBufferMinutes,
    trains,
    next: trains.find((t) => t.catchable) ?? null,
    barrier: { ...barrierStatus(windows, now), name: CROSSING.name, source: "timetable", closingSoon: false, liveTrains: [] },
  };
}
