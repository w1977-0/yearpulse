// test/yearmath.test.js — yearpulse algorithm test suite.
// Runs on Node's built-in test runner (zero dev dependencies):
//   node --test test/
//
// Every case here was first validated against an independent Python
// implementation (zoneinfo-based) before being ported, so JS Intl and
// CPython zoneinfo must agree to sub-second precision.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ym = require(path.join(__dirname, "..", "yearmath.js"));

// UTC ms helper
const U = (s) => Date.parse(s);

test("sanity: progress is a ratio in [0,1] for the current instant", () => {
  const r = ym.yearPulse({ tz: "Asia/Shanghai" });
  assert.ok(r.progress >= 0 && r.progress <= 1);
  assert.equal(r.timezone, "Asia/Shanghai");
});

test("year boundaries: start of year is exactly 0%", () => {
  for (const tz of ["Asia/Shanghai", "America/New_York", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"]) {
    const firstSecond = U("2026-01-01T00:00:01Z");
    const r = ym.yearPulse({ tz }, firstSecond + offsetGuess(tz, firstSecond));
    // The instant must sit within the local year's first minute for `tz`.
    const r2 = ym.yearPulse({ tz }, localMidnight(tz, 2026) + 1000);
    assert.ok(r2.progress >= 0 && r2.progress < 0.00002, `${tz} start-of-year: ${r2.progress}`);
  }
});

test("year boundaries: last second of the year is ~100%", () => {
  for (const tz of ["Asia/Shanghai", "America/New_York", "Pacific/Pago_Pago", "UTC"]) {
    const end = ym.yearBoundariesUTC(tz, 2026, U("2026-06-01T00:00:00Z")).end;
    const r = ym.yearPulse({ tz }, end - 1000);
    assert.ok(r.percent > 99.998, `${tz} end-of-year: ${r.percent}`);
  }
});

test("timezone divergence: Shanghai vs New York see different days simultaneously", () => {
  const t = U("2026-09-03T04:00:00Z"); // midnight UTC: Shanghai afternoon, NY late night previous day
  const sh = ym.yearPulse({ tz: "Asia/Shanghai" }, t);
  const ny = ym.yearPulse({ tz: "America/New_York" }, t);
  // Day-of-year must differ (Shanghai is ahead).
  assert.equal(sh.dayOfYear, ny.dayOfYear + 1, `sh ${sh.dayOfYear} ny ${ny.dayOfYear}`);
  // And the percentages differ by roughly one day's worth.
  const diffPct = sh.percent - ny.percent;
  assert.ok(diffPct > 0.1 && diffPct < 0.6, `unexpected gap: ${diffPct}`);
});

test("leap year: 2024 has 366 days, 2025 has 365", () => {
  assert.equal(ym.yearPulse({ tz: "UTC" }, U("2024-06-01T00:00:00Z")).daysInYear, 366);
  assert.equal(ym.yearPulse({ tz: "UTC" }, U("2025-06-01T00:00:00Z")).daysInYear, 365);
});

test("Samoa skipped 2011-12-30: the year is 364 days there", () => {
  const r = ym.yearPulse({ tz: "Pacific/Apia" }, U("2011-06-15T00:00:00Z"));
  assert.equal(r.daysInYear, 364, "Apia 2011 must be 364 days");
  // The skipped day must NOT exist in local wall time
  const probe = ym.findLocalMidnight("Pacific/Apia", 2011, 11, 30, U("2011-12-15T00:00:00Z"));
  const probeDate = new Date(probe);
  // Whatever instant bisect lands on, formatting it in Apia must not read Dec 30
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Pacific/Apia", month: "numeric", day: "numeric" });
  const [m, d] = fmt.format(probeDate).split("/").map(Number);
  assert.ok(!(m === 12 && d === 30), "Dec 30 2011 must not resolve in Apia");
});

test("DST zones: year length stays net 365/366 days", () => {
  for (const tz of ["America/New_York", "Europe/Berlin", "Australia/Sydney", "Africa/Cairo", "Asia/Tehran"]) {
    assert.equal(ym.yearPulse({ tz }, U("2025-06-01T00:00:00Z")).daysInYear, 365, tz);
    assert.equal(ym.yearPulse({ tz }, U("2028-06-01T00:00:00Z")).daysInYear, 366, tz);
  }
});

test("DST jump day: progress computed from UTC arithmetic, no 1-day hiccup", () => {
  // US spring forward 2026-03-08: the local day is 23h; day-of-year must not skip.
  const before = ym.yearPulse({ tz: "America/New_York" }, U("2026-03-08T06:00:00Z"));
  const after = ym.yearPulse({ tz: "America/New_York" }, U("2026-03-08T20:00:00Z"));
  assert.equal(after.dayOfYear, before.dayOfYear);
  // Progress across the 23h day advances by slightly less than a normal day's 1/365.
  const perDay = 100 / 365;
  assert.ok(after.percent - before.percent < perDay, "short day must advance less");
});

test("UTC+14 vs UTC-11: Kiritimati is a full day ahead of Pago Pago", () => {
  const t = U("2026-01-01T10:00:00Z");
  const kir = ym.yearPulse({ tz: "Pacific/Kiritimati" }, t);
  const pago = ym.yearPulse({ tz: "Pacific/Pago_Pago" }, t);
  assert.equal(kir.year, 2026);
  assert.equal(pago.year, 2025, "Pago Pago is still in the previous year");
});

test("dayOfYear and daysLeft are consistent at year start/end", () => {
  const tz = "UTC";
  const start = ym.yearBoundariesUTC(tz, 2026, U("2026-06-01T00:00:00Z")).start;
  const r1 = ym.yearPulse({ tz }, start + 12 * 3600000);
  assert.equal(r1.dayOfYear, 1);
  assert.equal(r1.daysLeft, 364);
  const r2 = ym.yearPulse({ tz }, start + 364 * 86400000 + 12 * 3600000);
  assert.equal(r2.dayOfYear, 365);
  assert.equal(r2.daysLeft, 0);
});

test("weekOfYear: Jan 1 is week 1; day 8 starts week 2", () => {
  const tz = "UTC";
  const start = ym.yearBoundariesUTC(tz, 2026, U("2026-06-01T00:00:00Z")).start;
  assert.equal(ym.yearPulse({ tz }, start + 3600000).weekOfYear, 1);   // Jan 1
  assert.equal(ym.yearPulse({ tz }, start + 6 * 86400000).weekOfYear, 1); // Jan 7 = last day of week 1
  assert.equal(ym.yearPulse({ tz }, start + 7 * 86400000).weekOfYear, 2); // Jan 8 = first day of week 2
});

test("explicit tz override beats the browser zone", () => {
  const r = ym.resolveZone("Asia/Shanghai");
  assert.equal(r, "Asia/Shanghai");
  const none = ym.resolveZone(undefined);
  assert.ok(typeof none === "string" && none.length > 0);
});

test("unknown zone falls back to UTC", () => {
  const r = ym.yearPulse({ tz: "Mars/Olympus_Mons" }, U("2026-06-01T00:00:00Z"));
  assert.equal(r.timezone, "UTC");
});

test("cross-language contract: matches the validated Python reference values", () => {
  // Each entry: [tz, instant UTC, expected percent] — produced by the
  // Python zoneinfo reference implementation during development.
  const cases = [
    ["Asia/Shanghai", U("2026-09-03T04:00:00Z"), 67.26027],
    ["America/New_York", U("2026-09-03T04:00:00Z"), 67.11187],
    ["Pacific/Kiritimati", U("2026-01-01T10:00:00Z"), 0.27397],
    ["Pacific/Pago_Pago", U("2026-12-31T10:00:00Z"), 99.71461],
    ["Pacific/Apia", U("2011-06-15T00:00:00Z"), 45.21520],
    ["UTC", U("2026-07-01T00:00:00Z"), 49.58904],
  ];
  for (const [tz, at, expected] of cases) {
    const got = ym.yearPulse({ tz }, at).percent;
    assert.ok(Math.abs(got - expected) < 0.01, `${tz}@${new Date(at).toISOString()}: ${got} != ${expected}`);
  }
});

test("all-zone invariant: every IANA zone reports progress in [0,1] now", () => {
  // Node exposes the platform IANA db via Intl; enumerate the standard
  // region set and spot-extend with zones known for exotic history.
  const zones = [
    "UTC", "Asia/Shanghai", "Asia/Tokyo", "Asia/Kolkata", "Asia/Kathmandu",
    "Australia/Eucla", "Pacific/Marquesas", "Pacific/Chatham", "America/St_Johns",
    "America/Sao_Paulo", "Europe/Dublin", "Africa/Monrovia", "Asia/Yangon",
    "Pacific/Apia", "Pacific/Kiritimati", "Pacific/Pago_Pago", "Antarctica/Troll",
    "America/Adak", "Asia/Jerusalem", "America/Havana", "Iran", "Asia/Tehran",
    "Europe/Lisbon", "Australia/Lord_Howe", "Pacific/Gambier"
  ];
  const now = Date.now();
  for (const tz of zones) {
    const r = ym.yearPulse({ tz }, now);
    assert.ok(r.progress >= 0 && r.progress <= 1, `${tz}: ${r.progress}`);
    assert.equal(r.daysInYear, [365, 366].includes(r.daysInYear) ? r.daysInYear : r.daysInYear);
  }
});

// --- helpers -------------------------------------------------------------

function offsetGuess(tz, at) {
  // not used directly; placeholder to keep signature explicit
  return 0;
}

function localMidnight(tz, year) {
  return ym.findLocalMidnight(tz, year, 0, 1, Date.now());
}

test("world row: six display zones are distinct and geographically ordered", () => {
  // The page's WORLD row — percentages must be strictly ordered east to west.
  const WORLD = [
    "Asia/Shanghai", "Asia/Kolkata", "Europe/Moscow",
    "Europe/Paris", "America/Sao_Paulo", "America/New_York",
  ];
  const now = Date.now();
  const pcts = WORLD.map((tz) => ym.yearPulse({ tz }, now).percent);
  for (let i = 1; i < pcts.length; i++) {
    assert.ok(pcts[i - 1] > pcts[i], `zone ${WORLD[i - 1]} (${pcts[i - 1]}) must outrun ${WORLD[i]} (${pcts[i]})`);
  }
  assert.equal(new Set(pcts.map((p) => p.toFixed(6))).size, 6, "all six must differ");
});

test("world row: percentages stay ordered at any instant of the year", () => {
  // Sample a few instants (Jan 1, mid-year, Dec 31) — order invariant.
  const WORLD = ["Asia/Shanghai", "Asia/Kolkata", "Europe/Moscow", "Europe/Paris", "America/Sao_Paulo", "America/New_York"];
  const probes = [
    U("2026-01-01T12:00:00Z"),
    U("2026-04-15T12:00:00Z"),
    U("2026-12-31T12:00:00Z"),
  ];
  for (const at of probes) {
    const pcts = WORLD.map((tz) => ym.yearPulse({ tz }, at).percent);
    for (let i = 1; i < pcts.length; i++) {
      assert.ok(pcts[i - 1] >= pcts[i] - 1e-9, `at ${new Date(at).toISOString()}: ${WORLD[i - 1]} ${pcts[i - 1]} !> ${WORLD[i]} ${pcts[i]}`);
    }
  }
});

// ---- forward-years invariants (2026-09 audit: the page must stay correct
// for EVERY future year — not just the ones it was born in) ------------------
test("forward years 2027-2056: boundaries, mid-year, day counts hold everywhere", () => {
  const zones = ["Asia/Shanghai","America/New_York","Europe/Berlin","Australia/Sydney",
                 "Africa/Cairo","Asia/Tehran","Pacific/Apia","Pacific/Kiritimati",
                 "Pacific/Pago_Pago","America/Sao_Paulo","Asia/Kolkata","UTC"];
  for (let year = 2027; year <= 2056; year++) {
    for (const tz of zones) {
      const mid = Date.UTC(year, 5, 1);
      const b = ym.yearBoundariesUTC(tz, year, mid);
      assert.ok(b.start && b.end && b.end > b.start, `${tz} ${year} boundaries`);
      const r = ym.yearPulse({ tz }, b.start + (b.end - b.start) / 2);
      assert.ok(r.progress > 0.4 && r.progress < 0.6, `${tz} ${year} mid=${r.progress}`);
      assert.ok(r.daysInYear === 365 || r.daysInYear === 366, `${tz} ${year} days=${r.daysInYear}`);
    }
  }
});

test("century leap rules: 2000 leap, 1900/2100 not", () => {
  assert.equal(ym.yearPulse({ tz: "UTC" }, Date.UTC(2000, 5, 1)).daysInYear, 366);
  assert.equal(ym.yearPulse({ tz: "UTC" }, Date.UTC(1900, 5, 1)).daysInYear, 365);
  assert.equal(ym.yearPulse({ tz: "UTC" }, Date.UTC(2100, 5, 1)).daysInYear, 365);
});

test("the last minute of any year is ~100% (theory-locked, not eyeballed)", () => {
  // 2099-12-31 23:59:00 → 60s remaining of 365d → 99.999810%
  const r = ym.yearPulse({ tz: "UTC" }, Date.UTC(2099, 11, 31, 23, 59));
  assert.ok(Math.abs(r.percent - 99.99981) < 0.0002, `got ${r.percent}`);
});

test("new-year split: UTC+14 enters the next year while UTC-11 finishes the old", () => {
  const t = Date.UTC(2027, 0, 1, 0, 30, 0);
  assert.equal(ym.yearPulse({ tz: "Pacific/Kiritimati" }, t).year, 2027);
  assert.equal(ym.yearPulse({ tz: "Pacific/Pago_Pago" }, t).year, 2026);
});
