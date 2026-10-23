// Live White Hart Lane barrier state from Network Rail's Train Describer (TD) feed.
// Network Rail doesn't publish the barrier itself for this area, but it does publish where trains are, berth by berth
// (a berth is the stretch of line in front of a numbered signal). At a CCTV crossing the protecting signal can't clear
// until the barriers are down, so a train in the berth in front of that signal, or just past it, means the barrier is down.
// Pure logic only, so it can be tested; the network side is in stomp.ts / server.ts.

export interface TdMessage {
  type: string; // CA step, CB cancel, CC interpose, CT heartbeat, SF/SG/SH signalling state
  area: string;
  time: number;
  from?: string;
  to?: string;
  descr?: string;
  address?: string;
  data?: string;
}

/** The TD feed sends a JSON array of objects like {"CA_MSG": {...}}. */
export function parseTd(body: string): TdMessage[] {
  let arr: unknown;
  try { arr = JSON.parse(body); } catch { return []; }
  if (!Array.isArray(arr)) arr = [arr];
  const out: TdMessage[] = [];
  for (const item of arr as Record<string, any>[]) {
    for (const key of Object.keys(item ?? {})) {
      const m = item[key];
      if (!m || typeof m !== "object" || !m.area_id) continue;
      out.push({ type: m.msg_type ?? key.slice(0, 2), area: m.area_id, time: Number(m.time) || Date.now(), from: m.from, to: m.to, descr: m.descr, address: m.address, data: m.data });
    }
  }
  return out;
}

/** One direction of travel over the crossing, as TD berth names (4 characters, e.g. "0533"). */
export interface Direction {
  name: string;
  /** A train here is on its way: the barrier is about to come down (or already is). */
  approach: string[];
  /** The berth in front of the signal protecting the crossing: a train here means the barrier is down. */
  protect: string;
  /** The berth just past that signal: a train that has just stepped in is on or over the crossing. */
  beyond: string;
}

export interface LiveConfig {
  /** TD area id. Null: work it out from which area's trains step between the berths below. */
  area: string | null;
  directions: Direction[];
  /** How long after a train passes the protecting signal the barrier stays down (train crossing, then barriers rising). */
  clearSeconds: number;
}

// From the OpenTrainTimes "windsor" signalling map, checked against live moves in TD area BS (Barnes): towards
// Richmond, trains leave Barnes from either platform (signals 523 or 525) into 533, then 535 (Mortlake); towards London,
// 528 → 526 (Mortlake platform) → 524 → 522. White Hart Lane sits between 533 and 535 going down, and between 526 and
// 524 going up. Overridable with BARRIER_DIRECTIONS.
export const DEFAULT_DIRECTIONS: Direction[] = [
  { name: "towards Richmond", approach: ["0523", "0525", "1090"], protect: "0533", beyond: "0535" },
  { name: "towards London", approach: ["0528"], protect: "0526", beyond: "0524" },
];

export interface LiveTrain { descr: string; berth: string; direction: string; role: "approach" | "protect" | "beyond" }

export interface LiveStatus {
  area: string | null;
  areaSource: "set" | "discovered" | null;
  /** Last message of any kind from the area (heartbeats arrive about once a minute). */
  lastMessageAt: number | null;
  down: boolean;
  /** Not down yet, but a train is heading for the crossing. */
  closingSoon: boolean;
  /** When the current state (down / not down) started, if seen. */
  since: number | null;
  trains: LiveTrain[];
}

export interface Step { time: number; area: string; descr: string; from: string; to: string }
export interface SignalChange { time: number; area: string; address: string; bit: number; value: 0 | 1 }

const RING = 300;
const push = <T>(arr: T[], v: T) => { arr.push(v); if (arr.length > RING) arr.shift(); };

export class Tracker {
  /** area → berth → train description (headcode). */
  readonly berths = new Map<string, Map<string, string>>();
  /** area → expected berth steps actually seen there (for finding the area). */
  readonly stepsSeen = new Map<string, Set<string>>();
  readonly lastMessage = new Map<string, number>();
  /** area → S-class address → byte. */
  readonly signals = new Map<string, Map<string, number>>();
  readonly recentSteps: Step[] = [];
  readonly recentSignals: SignalChange[] = [];
  /** `${direction}|${descr}` → when it stepped into the beyond berth. */
  private readonly passed = new Map<string, number>();
  private readonly expected: Set<string>;
  private readonly watched: Set<string>;
  private state: { down: boolean; since: number | null } = { down: false, since: null };

  readonly cfg: LiveConfig;

  constructor(cfg: LiveConfig) {
    this.cfg = cfg;
    this.expected = new Set(cfg.directions.flatMap((d) => [...d.approach.map((a) => `${a}>${d.protect}`), `${d.protect}>${d.beyond}`]));
    this.watched = new Set(cfg.directions.flatMap((d) => [...d.approach, d.protect, d.beyond]));
  }

  area(): { area: string | null; source: LiveStatus["areaSource"] } {
    if (this.cfg.area) return { area: this.cfg.area, source: "set" };
    let best: string | null = null, score = 1; // need at least two different expected steps to be sure
    for (const [area, seen] of this.stepsSeen) if (seen.size > score) { best = area; score = seen.size; }
    return { area: best, source: best ? "discovered" : null };
  }

  apply(m: TdMessage): void {
    this.lastMessage.set(m.area, Math.max(this.lastMessage.get(m.area) ?? 0, m.time));
    if (m.type === "CA" || m.type === "CB" || m.type === "CC") {
      let b = this.berths.get(m.area);
      if (!b) this.berths.set(m.area, (b = new Map()));
      if ((m.type === "CA" || m.type === "CB") && m.from) b.delete(m.from);
      if ((m.type === "CA" || m.type === "CC") && m.to && m.descr) b.set(m.to, m.descr);
      if (m.type === "CA" && m.from && m.to && m.descr) this.step(m.area, m.descr, m.from, m.to, m.time);
    } else if ((m.type === "SF" || m.type === "SG" || m.type === "SH") && m.address && m.data) {
      this.signalBytes(m.area, m.address, m.data, m.time);
    }
    this.evaluate(m.time);
  }

  private step(area: string, descr: string, from: string, to: string, time: number) {
    const key = `${from}>${to}`;
    if (this.expected.has(key)) {
      let s = this.stepsSeen.get(area);
      if (!s) this.stepsSeen.set(area, (s = new Set()));
      s.add(key);
    }
    if (this.watched.has(from) || this.watched.has(to)) push(this.recentSteps, { time, area, descr, from, to });
    if (area !== this.area().area) return;
    for (const d of this.cfg.directions) {
      if (from === d.protect && to === d.beyond) this.passed.set(`${d.name}|${descr}`, time);
      else if (from === d.beyond) this.passed.delete(`${d.name}|${descr}`);
    }
  }

  private signalBytes(area: string, address: string, data: string, time: number) {
    let s = this.signals.get(area);
    if (!s) this.signals.set(area, (s = new Map()));
    const start = parseInt(address, 16);
    for (let i = 0; i * 2 < data.length; i++) {
      const addr = (start + i).toString(16).toUpperCase().padStart(2, "0");
      const value = parseInt(data.slice(i * 2, i * 2 + 2), 16);
      const old = s.get(addr);
      s.set(addr, value);
      // Logged for working out which bit is the protecting signal; see /debug.
      if (old != null && old !== value && area === this.area().area) {
        for (let bit = 0; bit < 8; bit++) {
          if (((old ^ value) >> bit) & 1) push(this.recentSignals, { time, area, address: addr, bit, value: ((value >> bit) & 1) as 0 | 1 });
        }
      }
    }
  }

  private evaluate(now: number) {
    const down = this.compute(now).down;
    if (down !== this.state.down) this.state = { down, since: now };
  }

  private compute(now: number) {
    const { area } = this.area();
    const b = area ? this.berths.get(area) : undefined;
    const trains: LiveTrain[] = [];
    let down = false, closingSoon = false;
    for (const d of this.cfg.directions) {
      const inProtect = b?.get(d.protect);
      if (inProtect) { down = true; trains.push({ descr: inProtect, berth: d.protect, direction: d.name, role: "protect" }); }
      const inBeyond = b?.get(d.beyond);
      const passedAt = inBeyond ? this.passed.get(`${d.name}|${inBeyond}`) : undefined;
      if (inBeyond && passedAt != null && now - passedAt < this.cfg.clearSeconds * 1000) {
        down = true;
        trains.push({ descr: inBeyond, berth: d.beyond, direction: d.name, role: "beyond" });
      }
      for (const a of d.approach) {
        const t = b?.get(a);
        if (t) { closingSoon = true; trains.push({ descr: t, berth: a, direction: d.name, role: "approach" }); }
      }
    }
    return { down, closingSoon: !down && closingSoon, trains };
  }

  status(now: number): LiveStatus {
    this.evaluate(now);
    const { area, source } = this.area();
    return {
      area,
      areaSource: source,
      lastMessageAt: area ? this.lastMessage.get(area) ?? null : null,
      ...this.compute(now),
      since: this.state.since,
    };
  }
}
