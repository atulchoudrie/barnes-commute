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
    barrierCloseBeforeMinutes: num(env.COMMUTE_BARRIER_CLOSE_BEFORE_MINUTES) ?? 2,
    barrierOpenAfterMinutes: num(env.COMMUTE_BARRIER_OPEN_AFTER_MINUTES) ?? 0.5,
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

/** One activity's times (arrival, departure or pass), from the Realtime Trains API (data.rtt.io). ISO 8601 strings. */
export interface RttTimes {
  scheduleAdvertised?: string;
  scheduleInternal?: string;
  realtimeForecast?: string;
  realtimeEstimate?: string;
  realtimeActual?: string;
  isCancelled?: boolean;
  cancellationReasonCode?: string;
}

/** The parts of a Realtime Trains location line-up service (GET /gb-nr/location) we use. */
export interface RttService {
  temporalData: {
    arrival?: RttTimes;
    departure?: RttTimes;
    pass?: RttTimes;
    displayAs?: string | null; // CALL, CANCELLED, DIVERTED, STARTS, TERMINATES, PASS
    scheduledCallType?: string | null;
  };
  locationMetadata?: { platform?: { planned?: string; actual?: string } };
  origin?: { location: { description: string } }[];
  destination?: { location: { description: string }; temporalData?: RttTimes }[];
  scheduleMetadata: { uniqueIdentity: string; trainReportingIdentity?: string; modeType?: string; inPassengerService?: boolean };
}

/** ISO 8601 → epoch ms. Times without a UTC offset are UK local time (the API may leave the offset off). */
export function parseUkTime(iso: string | undefined): number {
  if (!iso) return NaN;
  if (/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(iso)) return Date.parse(iso);
  const m = iso.match(/^(\d{4}-\d\d-\d\d)T(\d\d):(\d\d)(?::(\d\d))?/);
  if (!m) return NaN;
  return londonTime(m[1], m[2] + m[3]) + Number(m[4] ?? 0) * 1000;
}
const ms = parseUkTime;
/** Timetabled time (public, else working timetable). */
const booked = (t: RttTimes | undefined) => { const v = ms(t?.scheduleAdvertised ?? t?.scheduleInternal); return Number.isNaN(v) ? null : v; };
/** Best current time: actual, then forecast/estimate, then timetable. */
const best = (t: RttTimes | undefined) => {
  const v = ms(t?.realtimeActual ?? t?.realtimeForecast ?? t?.realtimeEstimate);
  return Number.isNaN(v) ? booked(t) : v;
};
const isCancelled = (s: RttService) => s.temporalData.displayAs === "CANCELLED" || !!s.temporalData.departure?.isCancelled;
const isBus = (s: RttService) => s.scheduleMetadata.modeType === "BUS";
const isLoop = (s: RttService) =>
  !!s.origin?.some((o) => o.location.description === WATERLOO.name) && !!s.destination?.some((d) => d.location.description === WATERLOO.name);

/**
 * Where the train is going today: destinations cut from the journey (e.g. a train terminating short) are marked
 * cancelled and skipped; a train that divides has more than one.
 */
function destinationName(s: RttService): string | null {
  const all = s.destination ?? [];
  const live = all.filter((d) => !d.temporalData?.isCancelled);
  const names = [...new Set((live.length ? live : all).map((d) => d.location.description))];
  return names.length ? names.join(" / ") : null;
}

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
  /** Arrival at the end of the journey (Waterloo, or Barnes on the way home), when looked up. */
  arriveScheduled?: number | null;
  arriveExpected?: number | null;
}

/** Waterloo-bound departures from Barnes, soonest first. */
export function parseDepartures(services: RttService[], now: number): Departure[] {
  const out: Departure[] = [];
  for (const s of services) {
    const t = s.temporalData;
    if (t.displayAs === "PASS" || t.displayAs === "TERMINATES" || s.scheduleMetadata.inPassengerService === false) continue;
    const scheduled = booked(t.departure);
    if (scheduled == null) continue;
    const expected = best(t.departure) ?? scheduled;
    if (t.departure?.realtimeActual || expected < now - MIN) continue; // already gone
    out.push({
      uid: s.scheduleMetadata.uniqueIdentity,
      scheduled,
      expected,
      delayMinutes: Math.max(0, Math.round((expected - scheduled) / MIN)),
      platform: s.locationMetadata?.platform?.actual ?? s.locationMetadata?.platform?.planned ?? null,
      destination: destinationName(s) ?? WATERLOO.name,
      cancelled: isCancelled(s),
      cancelReason: t.departure?.cancellationReasonCode ?? null,
      bus: isBus(s),
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

/**
 * `id` is the train, so it's counted once however many feeds list it: a train crosses White Hart Lane only once, but
 * a loop train calls at Barnes before and after Mortlake, so it appears in both the "from Barnes" and "to Barnes" feeds.
 */
export interface CrossingTrain { id: string; time: number; estimated: boolean }

/** Times trains reach the crossing, from one feed. */
export function crossingTimes(services: RttService[], feed: CrossingFeed): CrossingTrain[] {
  const out: CrossingTrain[] = [];
  const sign = feed.kind === "departs" ? 1 : -1;
  for (const s of services) {
    if (isCancelled(s) || isBus(s)) continue;
    // Estimated feeds (Clapham Junction ⇄ Richmond) are there for fast trains that skip Mortlake. Loop services
    // (Waterloo round to Waterloo) also run between those stations the other way round, via Hounslow and Barnes
    // Bridge, without crossing White Hart Lane; loops that do cross it stop at Mortlake and are already counted.
    if (feed.estimated && isLoop(s)) continue;
    const t = s.temporalData;
    const base = t.displayAs === "PASS" ? best(t.pass) : best(feed.kind === "departs" ? t.departure : t.arrival);
    if (base != null) out.push({ id: s.scheduleMetadata.uniqueIdentity, time: base + sign * feed.minutes * MIN, estimated: !!feed.estimated });
  }
  return out;
}

export interface BarrierWindow { closes: number; opens: number; trains: number }

/**
 * When the barrier is down: each train closes it from `closeBefore` until `openAfter` around its crossing time.
 * Overlapping closures are joined (the barrier stays down); any gap between them shows as open.
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
    if (last && closes <= last.opens) { last.opens = Math.max(last.opens, opens); last.trains++; }
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

// ---------- Back from Waterloo ----------

export interface ReturnTrain extends Departure {
  /** Arrival at Barnes: timetable and best current time. Null if not known yet. */
  arriveScheduled: number | null;
  arriveExpected: number | null;
  /** Arrival at Barnes plus the walk home. */
  homeAt: number | null;
}

/** Each train's first arrival at a station, from that station's arrivals list (loop trains can call twice). */
function firstArrivals(atStation: RttService[]): Map<string, RttTimes | undefined> {
  const arrivals = new Map<string, RttTimes | undefined>();
  for (const s of atStation) {
    const uid = s.scheduleMetadata.uniqueIdentity, a = s.temporalData.arrival, seen = arrivals.get(uid);
    if (!arrivals.has(uid) || (booked(a) ?? Infinity) < (booked(seen) ?? Infinity)) arrivals.set(uid, a);
  }
  return arrivals;
}

/** Adds each departure's arrival time at the other end, from that station's arrivals. */
export function withArrivals<T extends Departure>(departures: T[], atDestination: RttService[]): T[] {
  const arrivals = firstArrivals(atDestination);
  return departures.map((d) => {
    const a = arrivals.get(d.uid);
    return { ...d, arriveScheduled: booked(a), arriveExpected: best(a) };
  });
}

/**
 * Leaves out trains that a later one gets you there no later than. That drops loop services going the long way
 * round – they also "call at" the far end, an hour later – and a loop train listed at both of its calls.
 */
export function dropOvertaken<T extends Departure>(trains: T[]): T[] {
  return trains.filter((t) => t.arriveExpected == null || !trains.some((o) =>
    o !== t && !o.cancelled && o.expected > t.expected && o.arriveExpected != null && o.arriveExpected <= t.arriveExpected!));
}

/** Barnes-bound trains from Waterloo (departure board), with their arrival at Barnes and a home-by time. */
export function parseReturns(fromWaterloo: RttService[], atBarnes: RttService[], cfg: Pick<CommuteConfig, "walkMinutes">, now: number): ReturnTrain[] {
  const trains = withArrivals(parseDepartures(fromWaterloo, now), atBarnes).map((d) => ({
    ...d,
    destination: d.destination === WATERLOO.name ? "loop back to Waterloo" : d.destination,
    arriveScheduled: d.arriveScheduled ?? null,
    arriveExpected: d.arriveExpected ?? null,
    homeAt: d.arriveExpected == null ? null : d.arriveExpected + cfg.walkMinutes * MIN,
  }));
  return dropOvertaken(trains);
}

/** A train on a National Rail station departure board (lib/ldb.ts). `std` is the timetabled departure, "HH:MM". */
export interface StationBoardService { std: string; platform: string | null; destination: string | null; cancelled: boolean }

/**
 * Labels trains with what the station board shows: its destination (loop trains are shown by a point on the loop,
 * e.g. "Teddington", rather than "London Waterloo") and platform. Matched by timetabled departure time.
 */
export function withStationBoard<T extends Departure>(trains: T[], board: StationBoardService[] | null): T[] {
  if (!board?.length) return trains;
  return trains.map((t) => {
    const s = board.find((b) => b.std === formatClock(t.scheduled));
    if (!s) return t;
    return { ...t, destination: s.destination ?? t.destination, platform: s.platform ?? t.platform, cancelled: t.cancelled || s.cancelled };
  });
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
  /** Trains back from Waterloo to Barnes; null if not asked for. */
  back: ReturnTrain[] | null;
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
    // The live state decides "now": if it says up, a forecast closure covering this moment (a late or
    // cancelled train) isn't shown, so the page doesn't say both "open" and "down now".
    windows: live.down ? b.windows : b.windows.filter((w) => w !== current),
    liveTrains: live.trains,
  };
}

export function buildBoard(departures: Departure[], crossing: CrossingTrain[], cfg: CommuteConfig, now: number, back: ReturnTrain[] | null = null): Board {
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
    back,
  };
}

// ---------- Barrier wording ----------

const minsUntil = (t: number, now: number) => Math.max(1, Math.ceil((t - now) / MIN));

/**
 * "Closed for 4 min", "Open for 6 min", "Open – train approaching, closes soon for about 8 min". Durations come from when the state next
 * changes; for a closing barrier, from the forecast closure the approaching train belongs to.
 */
export function barrierPhrase(b: BoardBarrier, now: number): string {
  if (b.down) return b.changesAt ? `Closed for ${minsUntil(b.changesAt, now)} min` : "Closed";
  if (b.closingSoon) {
    const w = b.windows.find((x) => x.opens > now);
    // Still up: a train is on its way, so it's about to close.
    return w ? `Open – train approaching, closes soon for about ${minsUntil(w.opens, Math.max(now, w.closes))} min` : "Open – train approaching, closes soon";
  }
  return b.changesAt ? `Open for ${minsUntil(b.changesAt, now)} min` : "Open – no trains due";
}

// ---------- Plain-text summary (Android widget apps) ----------

/** "to" Waterloo before 1pm, "from" Waterloo from 1pm until 3am (UK time). */
export function autoJourney(now: number): "to" | "from" {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
  return hour >= 13 || hour < 3 ? "from" : "to";
}

/**
 * A few lines of text for a home-screen widget that shows text from a URL (e.g. KWGT's web get). Uses clock times
 * rather than countdowns, since these widgets only refresh every few minutes.
 */
export function summaryText(board: Board, journey: "to" | "from", now: number): string {
  const b = board.barrier;
  const barrier = `Barrier: ${barrierPhrase(b, now)}${b.source === "live" ? " (live)" : ""}`;
  const lines: string[] = [];
  if (journey === "to") {
    const trains = board.trains.filter((t) => t.catchable).slice(0, 3);
    lines.push("Barnes → Waterloo");
    if (!trains.length) lines.push("No trains you can make");
    trains.forEach((t, i) => {
      const exp = t.delayMinutes > 0 ? ` (exp ${formatClock(t.expected)})` : "";
      const plat = t.platform ? ` P${t.platform}` : "";
      lines.push(i === 0
        ? `Leave ${formatClock(t.plan!.leaveAt)} for the ${formatClock(t.scheduled)}${exp}${plat}`
        : `${formatClock(t.scheduled)}${exp} – leave ${formatClock(t.plan!.leaveAt)}`);
    });
  } else {
    const trains = (board.back ?? []).filter((t) => !t.cancelled && t.expected >= now - 30_000).slice(0, 3);
    lines.push("Waterloo → Barnes");
    if (!trains.length) lines.push("No trains to Barnes soon");
    for (const t of trains) {
      const exp = t.delayMinutes > 0 ? ` (exp ${formatClock(t.expected)})` : "";
      const plat = t.platform ? ` P${t.platform}` : "";
      const arrive = t.arriveExpected != null ? ` → Barnes ${formatClock(t.arriveExpected)}` : "";
      lines.push(`${formatClock(t.scheduled)}${exp}${plat}${arrive}`);
    }
  }
  lines.push(barrier);
  lines.push(`Updated ${formatClock(now)}`);
  return lines.join("\n");
}
