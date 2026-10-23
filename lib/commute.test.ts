import { test } from "node:test";
import assert from "node:assert/strict";
import { applyLive, barrierStatus, barrierWindows, buildBoard, configFromEnv, crossingTimes, formatClock, londonTime, parseDepartures, planLeave, walkMinutesFrom, type CommuteConfig, type RttService } from "./commute.ts";

const DAY = "2026-10-23"; // BST (UTC+1)
const at = (hhmm: string) => londonTime(DAY, hhmm);
const MIN = 60_000;

const cfg: CommuteConfig = {
  getOutMinutes: 2, walkMinutes: 8, walkSource: "set", platformBufferMinutes: 1,
  barrierCloseBeforeMinutes: 3, barrierOpenAfterMinutes: 1, walkToCrossingMinutes: null,
};

const svc = (uid: string, l: RttService["locationDetail"], runDate = DAY): RttService => ({ serviceUid: uid, runDate, locationDetail: { isPublicCall: true, displayAs: "CALL", ...l } });

test("UK local times convert across British Summer Time", () => {
  assert.equal(new Date(at("0812")).toISOString(), "2026-10-23T07:12:00.000Z");
  assert.equal(new Date(londonTime("2026-12-01", "0812")).toISOString(), "2026-12-01T08:12:00.000Z");
  assert.equal(new Date(at("0812H")).toISOString(), "2026-10-23T07:12:30.000Z");
  assert.equal(formatClock(at("0812")), "08:12");
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
    svc("B", { gbttBookedDeparture: "0812", realtimeDeparture: "0815", platform: "2", destination: [{ description: "London Waterloo" }] }),
    svc("A", { gbttBookedDeparture: "0805", realtimeDeparture: "0805" }),
    svc("gone", { gbttBookedDeparture: "0758", realtimeDeparture: "0759", realtimeDepartureActual: true }),
    svc("X", { gbttBookedDeparture: "0820", displayAs: "CANCELLED_CALL", cancelReasonShortText: "a fault" }),
  ], now);
  assert.deepEqual(d.map((x) => x.uid), ["A", "B", "X"]);
  assert.equal(d[1].delayMinutes, 3);
  assert.equal(d[1].platform, "2");
  assert.equal(d[2].cancelled, true);
});

test("trains after midnight on the same run date roll into the next day", () => {
  const now = at("2350");
  const [d] = parseDepartures([svc("late", { gbttBookedDeparture: "0005", gbttBookedDepartureNextDay: true })], now);
  assert.equal(d.scheduled - now, 15 * MIN);
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
  const now = at("0800");
  const down = crossingTimes([svc("D", { gbttBookedArrival: "0810", realtimeArrival: "0811" })], { kind: "arrives", minutes: 1, group: "down" }, now);
  assert.deepEqual(down[0], { id: "D:down", time: at("0810"), estimated: false });
  const up = crossingTimes([svc("U", { gbttBookedDeparture: "0820", realtimeDeparture: "0820" })], { kind: "departs", minutes: 1, group: "up" }, now);
  assert.equal(up[0].time, at("0821"));
  const pass = crossingTimes([svc("P", { displayAs: "PASS", realtimePass: "0825H" })], { kind: "arrives", minutes: 1, group: "down" }, now);
  assert.equal(pass[0].time, at("0824") + 30_000);
  const est = crossingTimes([svc("F", { gbttBookedDeparture: "0830" })], { kind: "departs", minutes: 6, group: "down", estimated: true }, now);
  assert.deepEqual(est[0], { id: "F:down", time: at("0836"), estimated: true });
  assert.equal(crossingTimes([svc("C", { gbttBookedArrival: "0830", displayAs: "CANCELLED_CALL" })], { kind: "arrives", minutes: 1, group: "down" }, now).length, 0);
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
    svc("soon", { gbttBookedDeparture: "0806" }), // would need to leave 07:55
    svc("next", { gbttBookedDeparture: "0816", realtimeDeparture: "0818" }),
  ], now);
  const b = buildBoard(deps, [], cfg, now);
  assert.equal(b.trains[0].catchable, false);
  assert.equal(b.next?.uid, "next");
  assert.equal(formatClock(b.next!.plan!.leaveAt), "08:07");
  assert.equal(b.journeyMinutes, 11);
});

test("live barrier state overrides the forecast while the feed is fresh", () => {
  const now = at("0800");
  const deps = parseDepartures([svc("next", { gbttBookedDeparture: "0830" })], now);
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
