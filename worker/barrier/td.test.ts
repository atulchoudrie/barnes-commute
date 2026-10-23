import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DIRECTIONS, Tracker, parseTd, type TdMessage } from "./td.ts";

const T0 = 1_800_000_000_000;
const ca = (area: string, descr: string, from: string, to: string, time = T0): TdMessage => ({ type: "CA", area, time, descr, from, to });
const tracker = (area: string | null = "WX") => new Tracker({ area, directions: DEFAULT_DIRECTIONS, clearSeconds: 45 });

test("parses the TD feed's JSON array", () => {
  const msgs = parseTd(JSON.stringify([
    { CA_MSG: { time: "1800000000000", area_id: "WX", msg_type: "CA", from: "0533", to: "0535", descr: "2K15" } },
    { SF_MSG: { time: "1800000000001", area_id: "WX", msg_type: "SF", address: "1A", data: "04" } },
    { CT_MSG: { time: "1800000000002", area_id: "WX", msg_type: "CT", report_time: "1200" } },
  ]));
  assert.deepEqual(msgs.map((m) => [m.type, m.area, m.time]), [["CA", "WX", T0], ["SF", "WX", T0 + 1], ["CT", "WX", T0 + 2]]);
  assert.deepEqual(parseTd("not json"), []);
});

test("a train approaching, at the protecting signal, then over the crossing", () => {
  const t = tracker();
  t.apply({ type: "CC", area: "WX", time: T0, to: "0523", descr: "2K15" }); // in Barnes platform
  let s = t.status(T0);
  assert.equal(s.down, false);
  assert.equal(s.closingSoon, true);
  assert.equal(s.trains[0].direction, "towards Richmond");

  t.apply(ca("WX", "2K15", "0523", "0533", T0 + 60_000)); // at the signal protecting the crossing
  s = t.status(T0 + 60_000);
  assert.equal(s.down, true);
  assert.equal(s.since, T0 + 60_000);

  t.apply(ca("WX", "2K15", "0533", "0535", T0 + 120_000)); // past it, on the crossing
  assert.equal(t.status(T0 + 140_000).down, true);
  assert.equal(t.status(T0 + 170_000).down, false); // 45 s later the barrier is back up
  assert.equal(t.status(T0 + 170_000).since, T0 + 170_000);
});

test("stepping on past Mortlake clears it straight away; up trains work the same way", () => {
  const t = tracker();
  t.apply(ca("WX", "2R40", "0528", "0526", T0)); // in Mortlake platform towards London
  assert.equal(t.status(T0).down, true);
  t.apply(ca("WX", "2R40", "0526", "0524", T0 + 30_000));
  assert.equal(t.status(T0 + 40_000).down, true);
  t.apply(ca("WX", "2R40", "0524", "0522", T0 + 50_000));
  assert.equal(t.status(T0 + 50_000).down, false);
});

test("trains leaving Barnes from either platform count as approaching", () => {
  const t = tracker();
  t.apply({ type: "CC", area: "WX", time: T0, to: "0525", descr: "2025" });
  assert.equal(t.status(T0).closingSoon, true);
  t.apply(ca("WX", "2025", "0525", "0533", T0 + 30_000));
  assert.equal(t.status(T0 + 30_000).down, true);
});

test("other areas with the same berth numbers are ignored", () => {
  const t = tracker();
  t.apply(ca("ZZ", "1A01", "0523", "0533"));
  assert.equal(t.status(T0).down, false);
});

test("finds the area from trains stepping between the expected berths", () => {
  const t = tracker(null);
  t.apply(ca("ZZ", "1A01", "0533", "0535")); // one matching step elsewhere isn't enough
  assert.equal(t.area().area, null);
  t.apply(ca("WX", "2K15", "0523", "0533"));
  t.apply(ca("WX", "2K15", "0533", "0535"));
  assert.deepEqual(t.area(), { area: "WX", source: "discovered" });
  t.apply(ca("WX", "2K17", "0523", "0533", T0 + 1000));
  assert.equal(t.status(T0 + 1000).down, true);
});

test("logs signalling bit changes in the area", () => {
  const t = tracker();
  t.apply({ type: "SG", area: "WX", time: T0, address: "10", data: "00000000" });
  t.apply({ type: "SF", area: "WX", time: T0 + 1, address: "11", data: "04" });
  assert.deepEqual(t.recentSignals, [{ time: T0 + 1, area: "WX", address: "11", bit: 2, value: 1 }]);
});
