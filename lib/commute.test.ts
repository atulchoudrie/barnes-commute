import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLive, autoJourney, barrierStatus, summaryText, parseReturns, parseUkTime, barrierWindows, buildBoard, configFromEnv, crossingTimes, formatClock, londonTime, parseDepartures, planLeave, walkMinutesFrom, type CommuteConfig, type RttService } from "./commute.ts";

const DAY = "2026-10-23"; // BST (UTC+1)
const at = (hhmm: string) => londonTime(DAY, hhmm);
const MIN = 60_000;

const cfg: CommuteConfig = {
  getOutMinutes: 2, walkMinutes: 8, walkSource: "set", platformBufferMinutes: 1,
  barrierCloseBeforeMinutes: 3, barrierOpenAfterMinutes: 1, walkToCrossingMinutes: null,
};

// A data.rtt.io location line-up service; times given as UK "HHMM" on DAY ("HHMMH" = half past the minute).
const iso = (hhmm: string) => new Date(at(hhmm)).toISOString();
type Times = { s?: string; f?: string; a?: string; cancelled?: boolean };
const times = (t?: Times) => t && { scheduleAdvertised: t.s && iso(t.s), realtimeForecast: t.f && iso(t.f), realtimeActual: t.a && iso(t.a), isCancelled: t.cancelled };
const svc = (uid: string, o: { dep?: Times; arr?: Times; pass?: Times; displayAs?: string; platform?: string; mode?: string }): RttService => ({
  temporalData: { departure: times(o.dep), arrival: times(o.arr), pass: times(o.pass), displayAs: o.displayAs ?? "CALL" },
  locationMetadata: { platform: { planned: o.platform } },
  destination: [{ location: { description: "London Waterloo" } }],
  scheduleMetadata: { uniqueIdentity: uid, modeType: o.mode ?? "TRAIN" },
});

test("UK local times convert across British Summer Time", () => {
  assert.equal(new Date(at("0812")).toISOString(), "2026-10-23T07:12:00.000Z");
  assert.equal(new Date(londonTime("2026-12-01", "0812")).toISOString(), "2026-12-01T08:12:00.000Z");
  assert.equal(new Date(at("0812H")).toISOString(), "2026-10-23T07:12:30.000Z");
  assert.equal(formatClock(at("0812")), "08:12");
});

test("API times without an offset are read as UK time, not the server's", () => {
  assert.equal(parseUkTime("2026-10-23T11:21:00"), at("1121"));
  assert.equal(parseUkTime("2026-10-23T11:21"), at("1121"));
  assert.equal(parseUkTime("2026-12-01T08:12:30"), Date.parse("2026-12-01T08:12:30Z"));
  assert.equal(parseUkTime("2026-10-23T11:21:00+01:00"), at("1121"));
  assert.equal(parseUkTime("2026-10-23T10:21:00Z"), at("1121"));
  assert.ok(Number.isNaN(parseUkTime(undefined)));
});

test("walk time from a home location, or as set", () => {
  assert.equal(walkMinutesFrom(51.46705, -0.24227), 1);
  assert.equal(walkMinutesFrom(51.4716, -0.2423), 9); // ~500m north → ~660m by street
  assert.equal(configFromEnv({ COMMUTE_HOME_LAT: "51.4716", COMMUTE_HOME_LON: "-0.2423" }).walkSource, "home location");
  const set = configFromEnv({ COMMUTE_WALK_MINUTES: "6", COMMUTE_HOME_LAT: "51.4716", COMMUTE_HOME_LON: "-0.2423" });
  assert.equal(set.walkMinutes, 6);
  assert.equal(set.walkSource, "set");
});

test("departures use expected times, skip departed trains and keep cancellations", () => {
  const now = at("0800");
  const d = parseDepartures([
    svc("B", { dep: { s: "0812", f: "0815" }, platform: "2" }),
    svc("A", { dep: { s: "0805", f: "0805" } }),
    svc("gone", { dep: { s: "0758", a: "0759" } }),
    svc("X", { dep: { s: "0820", cancelled: true }, displayAs: "CANCELLED" }),
  ], now);
  assert.deepEqual(d.map((x) => x.uid), ["A", "B", "X"]);
  assert.equal(d[1].delayMinutes, 3);
  assert.equal(d[1].platform, "2");
  assert.equal(d[2].cancelled, true);
});

test("leave time = departure − platform buffer − walk − getting out", () => {
  const p = planLeave(at("0812"), cfg, [], at("0750"));
  assert.equal(formatClock(p.leaveAt), "08:01");
  assert.equal(p.leaveInMinutes, 11);
  assert.equal(p.barrierExtraMinutes, 0);
});

test("a barrier closure on the walk makes you leave earlier", () => {
  const c = { ...cfg, walkToCrossingMinutes: 3 }; // reach the crossing 5 min after setting off
  // Straight calculation: leave 08:01, at crossing 08:06 – but it's down 08:05–08:08.
  const windows = [{ closes: at("0805"), opens: at("0808"), trains: 1 }];
  const p = planLeave(at("0812"), c, windows, at("0750"));
  // Waiting at the barrier would get you there 08:13 – too late – so you must cross before it shuts at 08:05.
  assert.equal(formatClock(p.leaveAt), "07:59");
  assert.equal(p.leaveAt, at("0800") - 15_000); // reach the crossing 08:04:45
  assert.equal(p.barrierExtraMinutes, 2);
  // Once the barrier is up again by the time you'd reach it, no change.
  assert.equal(planLeave(at("0814"), c, windows, at("0750")).barrierExtraMinutes, 0);
});

test("crossing times: before arriving at Mortlake, after leaving it, passes and estimates", () => {
  const down = crossingTimes([svc("D", { arr: { s: "0810", f: "0811" } })], { kind: "arrives", minutes: 1, group: "down" });
  assert.deepEqual(down[0], { id: "D:down", time: at("0810"), estimated: false });
  const up = crossingTimes([svc("U", { dep: { s: "0820", f: "0820" } })], { kind: "departs", minutes: 1, group: "up" });
  assert.equal(up[0].time, at("0821"));
  const pass = crossingTimes([svc("P", { displayAs: "PASS", pass: { s: "0825", f: "0825H" } })], { kind: "arrives", minutes: 1, group: "down" });
  assert.equal(pass[0].time, at("0824") + 30_000);
  const est = crossingTimes([svc("F", { dep: { s: "0830" } })], { kind: "departs", minutes: 6, group: "down", estimated: true });
  assert.deepEqual(est[0], { id: "F:down", time: at("0836"), estimated: true });
  assert.equal(crossingTimes([svc("C", { arr: { s: "0830" }, displayAs: "CANCELLED" })], { kind: "arrives", minutes: 1, group: "down" }).length, 0);
  assert.equal(crossingTimes([svc("Bus", { arr: { s: "0830" }, mode: "BUS" })], { kind: "arrives", minutes: 1, group: "down" }).length, 0);
});

test("barrier windows merge back-to-back trains and prefer real times over estimates", () => {
  const w = barrierWindows([
    { id: "A:d", time: at("0810"), estimated: false },
    { id: "A:d", time: at("0812"), estimated: true }, // same train from the Clapham feed – ignored
    { id: "B:u", time: at("0814"), estimated: false }, // closes 08:11, within a minute of A opening → one closure
    { id: "A:u", time: at("0840"), estimated: true }, // same train, other direction (on its way back) – kept
  ], cfg);
  assert.equal(w.length, 2);
  assert.deepEqual(w[0], { closes: at("0807"), opens: at("0815"), trains: 2 });
  assert.equal(w[1].closes, at("0837"));

  assert.deepEqual(barrierStatus(w, at("0800")), { down: false, changesAt: at("0807"), windows: w });
  const down = barrierStatus(w, at("0810"));
  assert.equal(down.down, true);
  assert.equal(down.changesAt, at("0815"));
  assert.deepEqual(barrierStatus(w, at("0900")), { down: false, changesAt: null, windows: [] });
});

test("board picks the first train you can still make", () => {
  const now = at("0800");
  const deps = parseDepartures([
    svc("soon", { dep: { s: "0806" } }), // would need to leave 07:55
    svc("next", { dep: { s: "0816", f: "0818" } }),
  ], now);
  const b = buildBoard(deps, [], cfg, now);
  assert.equal(b.trains[0].catchable, false);
  assert.equal(b.next?.uid, "next");
  assert.equal(formatClock(b.next!.plan!.leaveAt), "08:07");
  assert.equal(b.journeyMinutes, 11);
});

test("live barrier state overrides the forecast while the feed is fresh", () => {
  const now = at("0800");
  const deps = parseDepartures([svc("next", { dep: { s: "0830" } })], now);
  const forecast = buildBoard(deps, [{ id: "A:d", time: at("0803"), estimated: false }, { id: "B:d", time: at("0820"), estimated: false }], cfg, now).barrier;
  assert.equal(forecast.source, "timetable");
  assert.equal(forecast.down, true); // 08:00–08:04 forecast

  const live = { feed: { state: "connected" }, lastMessageAt: now - 30_000, down: false, closingSoon: false, trains: [] };
  const open = applyLive(forecast, live, now);
  assert.equal(open.source, "live");
  assert.equal(open.down, false); // the train is late: live says open
  assert.equal(open.changesAt, at("0817")); // next forecast closure

  const down = applyLive(forecast, { ...live, down: true, trains: [{ descr: "2K15", direction: "towards Richmond", role: "protect" }] }, now);
  assert.equal(down.down, true);
  assert.equal(down.changesAt, at("0804"));
  assert.equal(down.liveTrains[0].descr, "2K15");

  const closing = applyLive(forecast, { ...live, closingSoon: true }, now);
  assert.deepEqual([closing.down, closing.closingSoon, closing.changesAt], [false, true, null]);

  assert.equal(applyLive(forecast, { ...live, lastMessageAt: now - 10 * 60_000 }, now).source, "timetable"); // stale
  assert.equal(applyLive(forecast, { ...live, feed: { state: "disconnected" } }, now).source, "timetable");
  assert.equal(applyLive(forecast, null, now).source, "timetable");
});

test("trains back from Waterloo get their Barnes arrival and a home-by time", () => {
  const now = at("1700");
  const fromWaterloo = [svc("R1", { dep: { s: "1712", f: "1714" }, platform: "17" }), svc("R2", { dep: { s: "1727" } })];
  const atBarnes = [svc("R1", { arr: { s: "1728", f: "1730" } })];
  const [r1, r2] = parseReturns(fromWaterloo, atBarnes, { walkMinutes: 12 }, now);
  assert.equal(r1.platform, "17");
  assert.equal(r1.delayMinutes, 2);
  assert.equal(r1.arriveExpected, at("1730"));
  assert.equal(r1.homeAt, at("1742"));
  assert.equal(r2.arriveExpected, null); // not in the arrivals list yet
  assert.equal(r2.homeAt, null);
});

test("loop trains use their first call at Barnes, and trains beaten to Barnes by a later one are left out", () => {
  const now = at("1120");
  const loop = svc("L", { dep: { s: "1127" } });
  loop.destination = [{ location: { description: "London Waterloo" } }];
  const direct = svc("D", { dep: { s: "1130" } });
  const atBarnes = [svc("L", { arr: { s: "1226" } }), svc("L", { arr: { s: "1244" } }), svc("D", { arr: { s: "1148" } })];
  // The loop goes the long way round and reaches Barnes at 12:26; the 11:30 gets there at 11:48.
  assert.deepEqual(parseReturns([loop, direct], atBarnes, { walkMinutes: 12 }, now).map((r) => r.uid), ["D"]);
  const [alone] = parseReturns([loop], atBarnes, { walkMinutes: 12 }, now);
  assert.equal(alone.arriveExpected, at("1226"));
  assert.equal(alone.destination, "loop back to Waterloo");
});

test("plain-text summary for Android widgets, and which way it shows by time of day", () => {
  assert.equal(autoJourney(at("0800")), "to");
  assert.equal(autoJourney(at("1300")), "from");
  assert.equal(autoJourney(at("0100")), "from");
  const now = at("0800");
  const deps = parseDepartures([svc("A", { dep: { s: "0816", f: "0818" }, platform: "3" }), svc("B", { dep: { s: "0831" } })], now);
  const back = parseReturns([svc("R", { dep: { s: "0830" }, platform: "22" })], [svc("R", { arr: { s: "0848" } })], cfg, now);
  const board = buildBoard(deps, [], cfg, now, back);
  assert.equal(summaryText(board, "to", now), [
    "Barnes → Waterloo",
    "Leave 08:07 for the 08:16 (exp 08:18) P3",
    "08:31 – leave 08:20",
    "Barrier open",
    "Updated 08:00",
  ].join("\n"));
  assert.equal(summaryText(board, "from", now).split("\n")[1], "08:30 P22 → Barnes 08:48");
});
