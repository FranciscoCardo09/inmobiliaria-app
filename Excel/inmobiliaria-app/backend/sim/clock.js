// Controllable fake clock. Preloaded with `node -r ./sim/clock.js`.
// Overrides the global Date so `new Date()` / `Date.now()` return a simulated
// "now". Anything constructed WITH args (new Date('2026-06-10')) is unaffected.
// Control via global.__setNow(isoString) / global.__realNow().
const RealDate = Date;
let simEpoch = null; // ms; null => real time

function FakeDate(...args) {
  if (args.length === 0) {
    return new RealDate(simEpoch == null ? RealDate.now() : simEpoch);
  }
  return new RealDate(...args);
}
FakeDate.prototype = RealDate.prototype;
FakeDate.now = () => (simEpoch == null ? RealDate.now() : simEpoch);
FakeDate.parse = RealDate.parse;
FakeDate.UTC = RealDate.UTC;
Object.setPrototypeOf(FakeDate, RealDate);

global.Date = FakeDate;
global.__RealDate = RealDate;
// Set simulated now to noon local on the given Y-M-D (avoids tz day-shift).
global.__setNow = (y, m, d) => {
  simEpoch = new RealDate(y, m - 1, d, 12, 0, 0).getTime();
};
global.__clearNow = () => { simEpoch = null; };
global.__now = () => new FakeDate().toISOString();
