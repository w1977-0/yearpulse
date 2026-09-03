# yearpulse

**The year, as a pulse.** One page: what per cent of the year is already gone, live, correct for *your* timezone.

> Live at **https://w1977-0.github.io/yearpulse/** — a single HTML file, no dependencies, no requests, ~11 KB.

## Why most year-progress pages are wrong

A "what % of the year has passed" number looks like `day / 365`, and that is wrong almost everywhere:

- **Timezones.** Right now, someone in Shanghai and someone in New York are on different days of the year. A single server-rendered percentage is wrong for at least one of them. yearpulse computes in the *viewer's* IANA zone (or any zone via `?tz=Asia/Shanghai`).
- **DST.** A year is 365 days but not 365×24 hours — New York "loses" an hour in March and regains it in November. On the jump days themselves, day-counting arithmetic visibly disagrees with the clock. yearpulse only ever subtracts **UTC timestamps**, so DST is absorbed exactly.
- **Calendar skips.** Samoa skipped 2011-12-30 entirely (the country moved to the other side of the date line): that year had **364 days** in `Pacific/Apia`. day/365 math can never be right there. (yearpulse handles it; there's a test.)
- **Odd offsets.** `Asia/Kathmandu` (+05:45), `Australia/Lord_Howe` (a 30-minute DST), `Pacific/Marquesas` (−09:30). Hour-based assumptions break on all of them.

### The one rule

Every quantity is an instant on the UTC timeline. Local year boundaries ("Jan 1st, midnight, in zone Z") are located by **bisection over a total order of local wall-clock seconds** using only the platform's `Intl` API — no date library, no offset tables, nothing to go stale:

```
progress = (now_utc − jan1_utc) / (nextjan1_utc − jan1_utc)
```

Samoa's skipped day, DST jumps, half-hour offsets: all just points on the number line.

## Use it

- **Open the page** — that's it. The number is computed for your browser's timezone.
- **Share a zone**: append `?tz=Pacific/Apia` (any IANA name). Unknown zones fall back to UTC rather than lying.
- The percentage shows 4 decimals because the last digit ticks every ~80 seconds — watching a year move is the point.

## What's shown

- Live percentage (second-accurate), next to a vertical **pulse bar** — the year still left settles to the bottom like sand in an hourglass; the now-line rides the drain surface. Proportions follow the golden ratio (bar 1:φ² tall).
- Day N of 365/366 (364 if your zone skipped a day that year)
- Days and weeks remaining
- The zone the number was computed for — so you can trust it
- **The world row**: the same instant in six zones that together hold about three quarters of humanity — Shanghai, New Delhi, Moscow, Paris, São Paulo, New York — each with its own local date and live percentage. Watch New York hold yesterday while Shanghai is already a day ahead. The six zones deliberately exercise every offset story: a half-hour zone (Kolkata), DST-on (Paris, New York, São Paulo), DST-off (Moscow), and a southern-hemisphere year.

## Repository layout

```
index.html            the whole site, single file (inlined core)
yearmath.js           the algorithm as a standalone, dual-environment module
test/yearmath.test.js 15 tests: leap years, DST jump days, Samoa's skipped day,
                      UTC+14 vs UTC−11, and cross-checked values from an
                      independent Python zoneinfo reference implementation
```

Run the tests with Node ≥ 18 (no dependencies):

```
node --test test/yearmath.test.js
```

CI runs the same suite on every push, plus checks that `index.html` stays a single self-contained file under 20 KB.

## License

MIT
