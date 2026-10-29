import assert from "node:assert/strict";
import test from "node:test";
import {
  BRACKET_SIZES,
  createTournament,
  currentMatch,
  drawEntrants,
  mainMatchCount,
  pickWinner,
  podium,
  progress,
  roundName,
  semifinalLosers,
  sizeOptions,
  undo,
} from "../bracket.js";

function lcg(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function slugs(count) {
  return Array.from({ length: count }, (_, index) => `phone-${index}`);
}

function playAll(state, choose = (_state, match) => match.a) {
  let guard = 0;
  while (state.phase !== "done") {
    const match = currentMatch(state);
    assert.equal(Boolean(match.a && match.b && match.a !== match.b), true);
    const next = pickWinner(state, choose(state, match));
    assert.notEqual(next, state);
    state = next;
    assert.ok(++guard < 200);
  }
  return state;
}

test("bracket sizes and match counts", () => {
  assert.deepEqual(BRACKET_SIZES, [16, 32, 64]);
  assert.equal(mainMatchCount(16), 15);
  assert.equal(mainMatchCount(32), 31);
  assert.equal(mainMatchCount(64), 63);
  assert.equal(roundName(64, 0), "64強");
  assert.equal(roundName(32, 0), "32強");
  assert.equal(roundName(16, 0), "16強");
  assert.equal(roundName(16, 1), "8強");
  assert.equal(roundName(16, 2), "準決賽");
  assert.equal(roundName(16, 3), "決賽");
});

test("draw is unique and a new seed reshuffles", () => {
  const pool = slugs(104);
  const first = drawEntrants(pool, 16, lcg(1));
  const second = drawEntrants(pool, 16, lcg(2));
  assert.equal(new Set(first).size, 16);
  assert.notEqual(first.join("|"), second.join("|"));
});

test("a pool smaller than the bracket is rejected", () => {
  const options = sizeOptions(20);
  assert.equal(options.find((item) => item.size === 16).enabled, true);
  assert.equal(options.find((item) => item.size === 32).enabled, false);
  assert.match(options.find((item) => item.size === 32).message, /不能進行 32 強/);
  assert.equal(options.find((item) => item.size === 64).enabled, false);
  assert.throws(() => drawEntrants(slugs(20), 32, lcg(1)), /smaller than bracket/);
});

for (const size of BRACKET_SIZES) {
  test(`${size}-team bracket plays ${size - 1} matches plus a third-place match`, () => {
    const entrants = slugs(size);
    let state = createTournament(entrants);
    assert.equal(state.rounds.reduce((sum, round) => sum + round.length, 0), size - 1);
    const seen = [];
    let thirdSeen = false;
    while (state.phase !== "done") {
      const info = progress(state);
      if (info.roundName === "季軍戰") thirdSeen = true;
      const match = currentMatch(state);
      seen.push(info.roundName);
      state = pickWinner(state, match.a);
    }
    assert.equal(thirdSeen, true);
    assert.equal(seen.filter((name) => name === "季軍戰").length, 1);
    assert.equal(seen.at(-2), "決賽");
    assert.equal(seen.at(-1), "季軍戰");
    const places = podium(state);
    assert.equal(new Set([places.champion, places.runnerUp, places.third]).size, 3);
    const losers = semifinalLosers(state);
    assert.ok(losers.includes(places.third));
    assert.equal(losers.includes(places.champion), false);
    assert.equal(losers.includes(places.runnerUp), false);
  });
}

test("third place is the winner of the semifinal losers", () => {
  let state = createTournament(slugs(16));
  state = playAll(state, (_state, match) => match.a);
  const places = podium(state);
  assert.equal(places.champion, "phone-0");
  assert.equal(places.runnerUp, "phone-8");
  assert.equal(places.third, "phone-4");
  assert.deepEqual(semifinalLosers(state), ["phone-4", "phone-12"]);
});

test("a second pick does not advance again, and undo restores the match", () => {
  let state = createTournament(slugs(16));
  const first = currentMatch(state);
  const picked = pickWinner(state, first.a);
  assert.equal(picked.history.length, 1);
  assert.equal(picked.round, 0);
  assert.equal(picked.match, 1);
  const again = pickWinner(picked, first.a);
  assert.equal(again, picked);
  const wrong = pickWinner(picked, "phone-99");
  assert.equal(wrong, picked);
  const restored = undo(picked);
  assert.equal(restored.history.length, 0);
  assert.equal(restored.match, 0);
  assert.equal(currentMatch(restored).winner, null);
  assert.equal(currentMatch(restored).a, first.a);
  assert.equal(undo(restored), restored);
});
