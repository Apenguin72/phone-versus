import assert from "node:assert/strict";
import test from "node:test";
import {
  BRACKET_SIZES,
  createTournament,
  currentMatch,
  drawEntrants,
  mainMatchCount,
  gameRecord,
  isRestorable,
  pickWinner,
  playedMatches,
  podium,
  progress,
  roundName,
  roundToken,
  semifinalLosers,
  shuffle,
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
  const pool = slugs(91);
  const first = drawEntrants(pool, 16, lcg(1));
  const second = drawEntrants(pool, 16, lcg(2));
  assert.equal(new Set(first).size, 16);
  assert.notEqual(first.join("|"), second.join("|"));
});

test("a pool smaller than the bracket is rejected", () => {
  const options = sizeOptions(20);
  assert.equal(options.find((item) => item.size === 16).enabled, true);
  assert.equal(options.find((item) => item.size === 32).enabled, false);
  assert.equal(options.find((item) => item.size === 32).message, "參賽機型只有 20 支，不能進行 32 強。");
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

test("a finished bracket matches the community submit contract", () => {
  for (const size of BRACKET_SIZES) {
    const state = playAll(createTournament(slugs(size)));
    const record = gameRecord(state);
    assert.equal(record.bracket_size, size);
    assert.equal(record.entrants.length, size);
    assert.equal(new Set(record.entrants).size, size);
    assert.equal(record.matches.length, size);
    assert.deepEqual(playedMatches(state), record.matches);
    const finals = record.matches.filter((match) => match.round === "final");
    const thirds = record.matches.filter((match) => match.round === "third");
    assert.equal(finals.length, 1);
    assert.equal(thirds.length, 1);
    assert.equal(record.matches.at(-2).round, "final");
    assert.equal(record.matches.at(-1).round, "third");
    assert.equal(finals[0].winner, record.top1);
    assert.equal(finals[0].loser, record.top2);
    assert.equal(thirds[0].winner, record.top3);
    assert.equal(new Set([record.top1, record.top2, record.top3]).size, 3);
    const losses = new Map();
    for (const match of record.matches) {
      assert.notEqual(match.winner, match.loser);
      assert.equal(record.entrants.includes(match.winner), true);
      assert.equal(record.entrants.includes(match.loser), true);
      losses.set(match.loser, (losses.get(match.loser) || 0) + 1);
    }
    assert.equal(losses.has(record.top1), false);
    assert.equal(losses.size, size - 1);
    const repeatLosers = [...losses.values()].filter((count) => count > 1);
    assert.equal(repeatLosers.length, 1);
    assert.equal(repeatLosers[0], 2);
    assert.equal(losses.get(thirds[0].loser), 2);
  }
  assert.equal(gameRecord(createTournament(slugs(16))), null);
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
  assert.equal(pickWinner(picked, ""), picked);
  assert.equal(pickWinner(picked, null), picked);
  const restored = undo(picked);
  assert.equal(restored.history.length, 0);
  assert.equal(restored.match, 0);
  assert.equal(currentMatch(restored).winner, null);
  assert.equal(currentMatch(restored).a, first.a);
  assert.equal(undo(restored), restored);
});

test("size options follow the pool, including an empty or tiny field", () => {
  const enabled = (count) => sizeOptions(count).filter((item) => item.enabled).map((item) => item.size);
  assert.deepEqual(enabled(0), []);
  assert.deepEqual(enabled(1), []);
  assert.deepEqual(enabled(15), []);
  assert.deepEqual(enabled(16), [16]);
  assert.deepEqual(enabled(31), [16]);
  assert.deepEqual(enabled(32), [16, 32]);
  assert.deepEqual(enabled(63), [16, 32]);
  assert.deepEqual(enabled(64), [16, 32, 64]);
  assert.deepEqual(enabled(91), [16, 32, 64]);
  assert.equal(sizeOptions(0)[0].message, "參賽機型只有 0 支，不能進行 16 強。");
  assert.equal(sizeOptions(15).find((item) => item.size === 64).message, "參賽機型只有 15 支，不能進行 64 強。");
  assert.equal(sizeOptions(64).every((item) => item.message === ""), true);
  for (const poolSize of [undefined, Number.NaN, -4, Number.POSITIVE_INFINITY]) {
    assert.deepEqual(enabled(poolSize), []);
    assert.equal(sizeOptions(poolSize)[0].message, "參賽機型只有 0 支，不能進行 16 強。");
  }
  assert.deepEqual(enabled(32.9), [16, 32]);
  assert.equal(sizeOptions(32.9).find((item) => item.size === 64).message, "參賽機型只有 32 支，不能進行 64 強。");
});

test("draw skips blank and repeated slugs and rejects sizes that are not 16, 32, or 64", () => {
  const clean = slugs(20);
  const messy = clean.flatMap((slug) => [slug, slug, "", null]);
  assert.deepEqual(drawEntrants(messy, 16, lcg(4)), drawEntrants(clean, 16, lcg(4)));
  assert.deepEqual(drawEntrants(clean, 16, lcg(4)), drawEntrants(clean.slice(), 16, lcg(4)));
  const pool = slugs(20);
  const copy = pool.slice();
  drawEntrants(pool, 16, lcg(3));
  assert.deepEqual(pool, copy);
  assert.throws(() => drawEntrants(["only-one", "", "only-one", null], 16), (error) => {
    assert.equal(error.code, "pool-too-small");
    assert.equal(error.pool, 1);
    assert.equal(error.size, 16);
    return true;
  });
  assert.throws(() => drawEntrants(slugs(91), 24, lcg(1)), /unsupported bracket size 24/);
  assert.throws(() => drawEntrants(slugs(91), 1, lcg(1)), /unsupported bracket size 1/);
  assert.throws(() => drawEntrants(null, 16), /expected a list of slugs/);
});

test("shuffle stays a permutation when random() is outside [0, 1)", () => {
  const items = ["a", "b", "c", "d"];
  for (const random of [() => 1, () => -1, () => Number.NaN, () => 2]) {
    const shuffled = shuffle(items, random);
    assert.deepEqual(shuffled.slice().sort(), ["a", "b", "c", "d"]);
  }
  assert.deepEqual(shuffle(items, () => 0).slice().sort(), items.slice().sort());
  assert.deepEqual(items, ["a", "b", "c", "d"]);
  assert.deepEqual(shuffle(null), []);
});

test("a bracket pairs the draw in order and does not invent byes", () => {
  for (const size of BRACKET_SIZES) {
    const entrants = slugs(size);
    const state = createTournament(entrants);
    entrants[0] = "mutated";
    assert.equal(state.entrants[0], `phone-0`);
    assert.equal(state.rounds[0].length, size / 2);
    state.rounds[0].forEach((match, index) => {
      assert.deepEqual(match, {
        a: `phone-${index * 2}`,
        b: `phone-${index * 2 + 1}`,
        winner: null,
      });
    });
    const later = state.rounds.slice(1).flat();
    assert.equal(later.every((match) => match.a == null && match.b == null && match.winner == null), true);
    assert.equal(state.third, null);
    assert.equal(state.rounds.reduce((sum, round) => sum + round.length, 0), mainMatchCount(size));
  }
  const duplicate = slugs(16);
  duplicate[15] = duplicate[0];
  assert.throws(() => createTournament(duplicate), /duplicate entrants/);
  const blank = slugs(16);
  blank[4] = "";
  assert.throws(() => createTournament(blank), /invalid entrant/);
  assert.throws(() => createTournament(slugs(15)), /unsupported bracket size 15/);
  assert.throws(() => createTournament(slugs(8)), /unsupported bracket size 8/);
  assert.throws(() => createTournament([]), /unsupported bracket size 0/);
  assert.throws(() => createTournament(null), /expected a list of slugs/);
});

test("round labels and submit tokens stay on the elimination names", () => {
  assert.equal(roundToken(64, 0), "64");
  assert.equal(roundToken(32, 0), "32");
  assert.equal(roundToken(32, 2), "8");
  assert.equal(roundToken(16, 0), "16");
  assert.equal(roundToken(16, 1), "8");
  assert.equal(roundToken(16, 2), "4");
  assert.equal(roundToken(16, 3), "final");
  assert.equal(roundToken(16, 20), null);
  assert.equal(roundName(16, 20), "比賽");
  assert.deepEqual(distinctRoundNames(32), ["32強", "16強", "8強", "準決賽", "決賽", "季軍戰"]);
  assert.deepEqual(distinctRoundNames(64), ["64強", "32強", "16強", "8強", "準決賽", "決賽", "季軍戰"]);
  const opening = createTournament(slugs(16));
  assert.deepEqual(progress(opening), { roundName: "16強", index: 1, total: 8 });
  assert.equal(progress(null), null);
  assert.equal(currentMatch(null), null);
  assert.equal(podium(opening), null);
  assert.equal(semifinalLosers(opening), null);
  assert.equal(playedMatches(opening), null);
});

test("picking the other card still produces three distinct places", () => {
  const state = playAll(createTournament(slugs(16)), (_state, match) => match.b);
  assert.deepEqual(podium(state), {
    champion: "phone-15",
    runnerUp: "phone-7",
    third: "phone-11",
  });
  assert.equal(progress(state), null);
  assert.equal(currentMatch(state), null);
  let third = createTournament(slugs(16));
  while (third.phase === "main") third = pickWinner(third, currentMatch(third).a);
  assert.equal(third.phase, "third");
  assert.equal(progress(third).roundName, "季軍戰");
  assert.equal(gameRecord(third), null);
  assert.equal(podium(third), null);
});

test("undo walks back across a round and out of the final", () => {
  let state = createTournament(slugs(16));
  const start = state;
  state = pickWinner(state, "phone-0");
  state = pickWinner(state, "phone-3");
  assert.equal(start.match, 0);
  assert.equal(start.history.length, 0);
  assert.equal(currentMatch(start).winner, null);
  assert.equal(state.rounds[1][0].a, "phone-0");
  assert.equal(state.rounds[1][0].b, "phone-3");
  state = undo(state);
  assert.equal(state.rounds[1][0].a, "phone-0");
  assert.equal(state.rounds[1][0].b, null);
  assert.equal(state.rounds[0][1].winner, null);
  assert.equal(state.match, 1);
  state = undo(state);
  assert.equal(state.rounds[1][0].a, null);
  assert.equal(state.history.length, 0);
  assert.equal(currentMatch(state).winner, null);

  state = playAll(createTournament(slugs(16)), (_current, match) => match.a);
  assert.equal(state.phase, "done");
  state = undo(state);
  assert.equal(state.phase, "third");
  assert.equal(currentMatch(state).winner, null);
  assert.equal(podium(state), null);
  state = undo(state);
  assert.equal(state.phase, "main");
  assert.equal(progress(state).roundName, "決賽");
  assert.equal(currentMatch(state).winner, null);
  assert.equal(state.third.winner, null);
  assert.equal(state.third.a !== state.third.b, true);
});

test("a saved step restores, and a broken save does not", () => {
  const known = new Set(slugs(64));
  for (const size of BRACKET_SIZES) {
    let state = createTournament(slugs(size));
    assert.equal(isRestorable(state, known), true);
    while (state.phase !== "done") {
      state = pickWinner(state, currentMatch(state).a);
      assert.equal(isRestorable(state, known), true);
      assert.equal(isRestorable(JSON.parse(JSON.stringify(state)), known), true);
    }
    const finished = { ...state, submitted: true, submitError: false };
    assert.equal(isRestorable(finished, known), true);
    while (state.history.length) {
      state = undo(state);
      assert.equal(isRestorable(state, known), true);
    }
    assert.equal(state.phase, "main");
    assert.equal(state.match, 0);
    assert.equal(currentMatch(state).winner, null);
  }

  const known16 = new Set(slugs(16));
  const good = createTournament(slugs(16));
  assert.equal(isRestorable(good, known16), true);
  assert.equal(isRestorable(good, new Set()), false);
  assert.equal(isRestorable(good, slugs(16)), false);
  assert.equal(isRestorable(null, known16), false);
  assert.equal(isRestorable({ ...good, version: 2 }, known16), false);
  assert.equal(isRestorable({ ...good, phase: "final" }, known16), false);
  assert.equal(isRestorable({ ...good, history: null }, known16), false);
  assert.equal(isRestorable({ ...good, entrants: good.entrants.slice(0, 15) }, known16), false);
  const duplicated = good.entrants.slice();
  duplicated[1] = duplicated[0];
  assert.equal(isRestorable({ ...good, entrants: duplicated }, known16), false);
  const renamed = good.entrants.slice();
  renamed[0] = "missing-phone";
  assert.equal(isRestorable({ ...good, entrants: renamed }, new Set(renamed)), false);

  const stuck = structuredClone(good);
  stuck.rounds[0][0].winner = stuck.rounds[0][0].a;
  assert.equal(isRestorable(stuck, known16), false);
  const skipped = structuredClone(good);
  skipped.round = 9;
  assert.equal(isRestorable(skipped, known16), false);
  assert.equal(progress(skipped), null);
  assert.equal(currentMatch(skipped), null);

  const mid = pickWinner(createTournament(slugs(16)), "phone-0");
  const badHistory = structuredClone(mid);
  badHistory.history[0].phase = "nope";
  assert.equal(isRestorable(badHistory, known16), false);

  const done = playAll(createTournament(slugs(16)));
  assert.equal(isRestorable(done, known16), true);
  const cleared = structuredClone(done);
  cleared.third.winner = null;
  assert.equal(isRestorable(cleared, known16), false);
  assert.equal(podium(cleared), null);
  assert.equal(gameRecord(cleared), null);
  assert.equal(semifinalLosers(null), null);
  assert.equal(undo(null), null);
});

function distinctRoundNames(size) {
  const names = [];
  let state = createTournament(slugs(size));
  while (state.phase !== "done") {
    const name = progress(state).roundName;
    if (names.at(-1) !== name) names.push(name);
    state = pickWinner(state, currentMatch(state).a);
  }
  return names;
}
