// yearmath.js — yearpulse core math. Zero dependencies, runs in browser and Node.
//
// The one rule that makes this correct everywhere: every quantity is compared
// in a TOTAL ORDER of local wall-clock seconds, and all arithmetic is done on
// UTC timestamps. Wall-clock weirdness (DST shifts, Samoa's skipped
// 2011-12-30, half-hour offsets, 25-hour fall-back days) is absorbed because
// local year boundaries are located on the UTC timeline by bisection over
// that total order — no offset tables, no date library, just the platform's
// IANA database via Intl.
//
//   progress = (now_utc - jan1_utc) / (nextjan1_utc - jan1_utc)

(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.yearmath = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var fmtCache = {};
  var zoneSupport = {};

  function supportsZone(tz) {
    if (zoneSupport[tz] !== undefined) return zoneSupport[tz];
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
      zoneSupport[tz] = true;
    } catch (e) {
      zoneSupport[tz] = false;
    }
    return zoneSupport[tz];
  }

  // Cached formatter for a zone; returns a function ms -> local parts.
  function partsFormatter(tz) {
    if (fmtCache[tz]) return fmtCache[tz];
    var dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric", month: "numeric", day: "numeric",
      hour: "numeric", minute: "numeric", second: "numeric",
      hour12: false
    });
    fmtCache[tz] = function (ms) {
      var p = dtf.formatToParts(new Date(ms));
      var o = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
      for (var i = 0; i < p.length; i++) {
        var t = p[i].type, v = p[i].value;
        if (t === "year") o.year = +v;
        else if (t === "month") o.month = +v - 1;
        else if (t === "day") o.day = +v;
        else if (t === "hour") o.hour = +v % 24; // hour12:false can emit "24"
        else if (t === "minute") o.minute = +v;
        else if (t === "second") o.second = +v;
      }
      return o;
    };
    return fmtCache[tz];
  }

  // Total-order key for an instant in a zone:
  //   (local civil day number) * 86400 + seconds within that day.
  // Monotonic non-decreasing along the UTC timeline, strictly increasing
  // except across jumps — exactly what bisection needs.
  function dayKey(tz, ms) {
    var p = partsFormatter(tz)(ms);
    return (Date.UTC(p.year, p.month, p.day) / 86400000) * 86400
      + p.hour * 3600 + p.minute * 60 + p.second;
  }

  // The UTC instant (ms, rounded) at which zone `tz` shows the first
  // 00:00:00 of the given local date — i.e. the local day's midnight.
  // `hintMs` only seeds the ±400-day search window.
  // Returns null when the local date does not exist in that zone
  // (e.g. Pacific/Apia 2011-12-30).
  function findLocalMidnight(tz, year, month, day, hintMs) {
    if (!supportsZone(tz)) {
      return new Date(year, month, day, 0, 0, 0, 0).getTime();
    }
    var targetKey = (Date.UTC(year, month, day) / 86400000) * 86400;
    var anchor = hintMs === undefined ? Date.now() : hintMs;
    var lo = anchor - 400 * 86400000;
    var hi = anchor + 400 * 86400000;
    // Invariant: dayKey(lo) < targetKey <= dayKey(hi)
    if (dayKey(tz, hi) < targetKey) return null;      // date is past the window's end
    if (dayKey(tz, lo) >= targetKey) { hi = lo; lo = hi - 800 * 86400000; }
    for (var i = 0; i < 64; i++) {
      var mid = lo + (hi - lo) / 2;
      if (dayKey(tz, mid) < targetKey) lo = mid;
      else hi = mid;
    }
    var found = Math.round(hi);
    // The local day may not exist (skipped calendar day): verify the landing
    // instant really shows the requested date, else report absence.
    var p = partsFormatter(tz)(found + 43200000); // midday of the candidate local day
    if (p.year !== year || p.month !== month || p.day !== day) return null;
    return found;
  }

  // UTC boundaries of the local year `year` in zone `tz`.
  function yearBoundariesUTC(tz, year, nowMs) {
    var anchor = nowMs === undefined ? Date.now() : nowMs;
    var start = findLocalMidnight(tz, year, 0, 1, anchor);
    var end = findLocalMidnight(tz, year + 1, 0, 1, anchor);
    return { start: start, end: end };
  }

  function resolveZone(explicit) {
    if (explicit) return explicit;
    try {
      var z = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (z && supportsZone(z)) return z;
    } catch (e) {}
    return "UTC";
  }

  function localYearOf(tz, ms) {
    if (!supportsZone(tz)) return new Date(ms).getFullYear();
    return partsFormatter(tz)(ms).year;
  }

  // 1-based day of year via UTC-diff against local Jan 1st (DST never
  // double-counts because both endpoints are instants on the UTC line).
  function localDayOfYear(tz, ms) {
    var y = localYearOf(tz, ms);
    var jan1 = findLocalMidnight(tz, y, 0, 1, ms);
    if (jan1 === null) return 1; // zone-local year without a Jan 1: pathological
    return Math.floor((ms - jan1) / 86400000) + 1;
  }

  // Main entry: everything about "now" in a zone.
  function yearPulse(opts, nowMs) {
    var explicit = opts && opts.tz;
    var tz = resolveZone(explicit);
    if (!supportsZone(tz)) tz = "UTC"; // unknown override falls back to UTC
    var now = nowMs !== undefined ? nowMs : Date.now();
    var year = localYearOf(tz, now);
    var b = yearBoundariesUTC(tz, year, now);
    if (b.start === null || b.end === null) {
      // Zone without a resolvable year boundary — degrade to UTC rather than lie.
      tz = "UTC";
      year = new Date(now).getUTCFullYear();
      b = yearBoundariesUTC(tz, year, now);
    }
    var total = b.end - b.start;
    var progress = total > 0 ? (now - b.start) / total : 0;
    if (progress < 0) progress = 0;
    if (progress > 1) progress = 1;

    var dayOfYear = localDayOfYear(tz, now);
    var daysInYear = Math.round(total / 86400000); // 365, 366, or 364 (Samoa 2011)
    var daysLeft = Math.max(0, daysInYear - dayOfYear);
    var msLeft = Math.max(0, b.end - now);
    var weekOfYear = Math.floor((dayOfYear - 1) / 7) + 1;

    return {
      timezone: tz,
      year: year,
      progress: progress,
      percent: progress * 100,
      dayOfYear: dayOfYear,
      daysInYear: daysInYear,
      daysLeft: daysLeft,
      msLeft: msLeft,
      weekOfYear: weekOfYear,
      yearStart: b.start,
      yearEnd: b.end
    };
  }

  return {
    yearPulse: yearPulse,
    yearBoundariesUTC: yearBoundariesUTC,
    findLocalMidnight: findLocalMidnight,
    resolveZone: resolveZone,
    supportsZone: supportsZone,
    localYearOf: localYearOf,
    localDayOfYear: localDayOfYear,
    dayKey: dayKey
  };
});
