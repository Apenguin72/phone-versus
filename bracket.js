export const BRACKET_SIZES = [16, 32, 64];

const PHASES = ["main", "third", "done"];

export function mainMatchCount(size) {
  return size - 1;
}

export function sizeOptions(poolSize) {
  const count = typeof poolSize === "number" && Number.isFinite(poolSize) && poolSize > 0
    ? Math.floor(poolSize)
    : 0;
  return BRACKET_SIZES.map((size) => ({
    size,
    enabled: count >= size,
    message: count >= size ? "" : `參賽機型只有 ${count} 支，不能進行 ${size} 強。`,
  }));
}

export function roundName(size, roundIndex) {
  const players = size / 2 ** roundIndex;
  if (players === 2) return "決賽";
  if (players === 4) return "準決賽";
  if (!Number.isInteger(players) || players < 2) return "比賽";
  return `${players}強`;
}

export function shuffle(items, random = Math.random) {
  const copy = Array.isArray(items) ? items.slice() : [];
  const roll = typeof random === "function" ? random : Math.random;
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const raw = Number(roll());
    let j = Number.isFinite(raw) ? Math.floor(raw * (i + 1)) : 0;
    if (!Number.isInteger(j) || j < 0) j = 0;
    if (j > i) j = i;
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function drawEntrants(slugs, size, random = Math.random) {
  if (!Array.isArray(slugs)) raise("expected a list of slugs", { code: "invalid-pool" });
  if (!BRACKET_SIZES.includes(size)) {
    raise(`unsupported bracket size ${size}`, { code: "unsupported-size", size });
  }
  const unique = [];
  const seen = new Set();
  for (const slug of slugs) {
    if (!usableSlug(slug) || seen.has(slug)) continue;
    seen.add(slug);
    unique.push(slug);
  }
  if (unique.length < size) {
    raise(`pool ${unique.length} is smaller than bracket ${size}`, {
      code: "pool-too-small",
      pool: unique.length,
      size,
    });
  }
  const drawn = shuffle(unique, random).slice(0, size);
  if (new Set(drawn).size !== size) raise("draw produced duplicates", { code: "duplicate-draw" });
  return drawn;
}

export function createTournament(slugs) {
  if (!Array.isArray(slugs)) raise("expected a list of slugs", { code: "invalid-entrants" });
  const size = slugs.length;
  if (!BRACKET_SIZES.includes(size)) {
    raise(`unsupported bracket size ${size}`, { code: "unsupported-size", size });
  }
  if (slugs.some((slug) => !usableSlug(slug))) {
    raise("invalid entrant", { code: "invalid-entrant" });
  }
  if (new Set(slugs).size !== size) raise("duplicate entrants", { code: "duplicate-entrants" });
  const depth = depthOf(size);
  const rounds = [];
  for (let round = 0; round < depth; round += 1) {
    const matches = size / 2 ** (round + 1);
    rounds.push(Array.from({ length: matches }, (_, index) => (
      round === 0 ? openMatch(slugs[index * 2], slugs[index * 2 + 1]) : openMatch()
    )));
  }
  return {
    version: 1,
    size,
    entrants: slugs.slice(),
    rounds,
    third: null,
    phase: "main",
    round: 0,
    match: 0,
    history: [],
  };
}

export function currentMatch(state) {
  if (!state || state.phase === "done") return null;
  if (state.phase === "third") return state.third ?? null;
  const round = state.rounds?.[state.round];
  if (!Array.isArray(round) || !Number.isInteger(state.match)) return null;
  return round[state.match] ?? null;
}

export function progress(state) {
  if (!state || state.phase === "done") return null;
  if (state.phase === "third") return { roundName: "季軍戰", index: 1, total: 1 };
  const round = state.rounds?.[state.round];
  if (!Array.isArray(round) || !Number.isInteger(state.match) || state.match < 0 || state.match >= round.length) {
    return null;
  }
  return {
    roundName: roundName(state.size, state.round),
    index: state.match + 1,
    total: round.length,
  };
}

export function pickWinner(state, slug) {
  const match = currentMatch(state);
  if (!match || match.winner) return state;
  if (!usableSlug(slug) || (slug !== match.a && slug !== match.b)) return state;
  const next = cloneState(state);
  if (!next) return state;
  next.history.push(snapshot(state));
  const target = currentMatch(next);
  if (!target) return state;
  target.winner = slug;
  if (!advance(next)) return state;
  return next;
}

export function undo(state) {
  if (!state || !Array.isArray(state.history) || state.history.length === 0) return state;
  if (!Array.isArray(state.entrants)) return state;
  const prev = state.history[state.history.length - 1];
  if (!prev || !Array.isArray(prev.rounds)) return state;
  return {
    version: state.version,
    size: state.size,
    entrants: state.entrants.slice(),
    ...snapshot(prev),
    history: state.history.slice(0, -1).map((entry) => (
      entry && typeof entry === "object" ? snapshot(entry) : entry
    )),
  };
}

export function podium(state) {
  if (!state || state.phase !== "done") return null;
  const final = state.rounds?.[state.rounds.length - 1]?.[0];
  if (!isDecided(final) || !isDecided(state.third)) return null;
  const champion = final.winner;
  const runnerUp = opponent(final, champion);
  const third = state.third.winner;
  if (!runnerUp || new Set([champion, runnerUp, third]).size !== 3) return null;
  return { champion, runnerUp, third };
}

export function roundToken(size, roundIndex) {
  const players = size / 2 ** roundIndex;
  if (players === 2) return "final";
  if (!Number.isInteger(players) || players < 4) return null;
  return String(players);
}

/** Play-order matches for submit_game: elimination rounds, then the third-place match. */
export function playedMatches(state) {
  if (!state || state.phase !== "done" || !Array.isArray(state.rounds)) return null;
  const matches = [];
  for (let roundIndex = 0; roundIndex < state.rounds.length; roundIndex += 1) {
    const round = state.rounds[roundIndex];
    if (!Array.isArray(round)) return null;
    const token = roundToken(state.size, roundIndex);
    if (!token) return null;
    for (const match of round) {
      const decided = decidedMatch(match, token);
      if (!decided) return null;
      matches.push(decided);
    }
  }
  const third = decidedMatch(state.third, "third");
  if (!third) return null;
  matches.push(third);
  return matches;
}

/** Payload fields shared by every finished bracket. visitor_id and device are added by the client. */
export function gameRecord(state) {
  const places = podium(state);
  const matches = playedMatches(state);
  if (!places || !matches) return null;
  return {
    bracket_size: state.size,
    entrants: state.entrants.slice(),
    matches,
    top1: places.champion,
    top2: places.runnerUp,
    top3: places.third,
  };
}

export function semifinalLosers(state) {
  const semis = state?.rounds?.[state.rounds.length - 2];
  if (!Array.isArray(semis) || semis.length === 0 || !semis.every(isDecided)) return null;
  const losers = semis.map((match) => opponent(match, match.winner));
  if (losers.some((slug) => !usableSlug(slug))) return null;
  return losers;
}

export function isRestorable(state, knownSlugs) {
  if (!state || state.version !== 1 || !BRACKET_SIZES.includes(state.size)) return false;
  if (typeof knownSlugs?.has !== "function") return false;
  if (!Array.isArray(state.entrants) || state.entrants.length !== state.size) return false;
  if (!state.entrants.every(usableSlug) || new Set(state.entrants).size !== state.size) return false;
  if (state.entrants.some((slug) => !knownSlugs.has(slug))) return false;
  if (!Array.isArray(state.history)) return false;
  const entrants = new Set(state.entrants);
  if (!snapshotIntact(state, state.entrants, entrants)) return false;
  return state.history.every((entry) => entry?.phase !== "done" && snapshotIntact(entry, state.entrants, entrants));
}

function advance(state) {
  if (state.phase === "third") {
    if (!isDecided(state.third)) return false;
    state.phase = "done";
    return true;
  }
  const round = state.rounds?.[state.round];
  const match = round?.[state.match];
  if (!isDecided(match)) return false;
  const winner = match.winner;
  const finalRound = state.round === state.rounds.length - 1;
  if (!finalRound) {
    const dest = state.rounds[state.round + 1]?.[Math.floor(state.match / 2)];
    if (!dest) return false;
    dest[state.match % 2 === 0 ? "a" : "b"] = winner;
  }
  if (state.match + 1 < round.length) {
    state.match += 1;
    return true;
  }
  if (!finalRound) {
    state.round += 1;
    state.match = 0;
    if (state.round === state.rounds.length - 1) {
      const losers = semifinalLosers(state);
      if (!losers || losers.length < 2 || losers[0] === losers[1]) return false;
      state.third = openMatch(losers[0], losers[1]);
    }
    return true;
  }
  state.phase = "third";
  return true;
}

function snapshotIntact(snapshotState, entrants, entrantSet) {
  if (!snapshotState || typeof snapshotState !== "object" || Array.isArray(snapshotState)) return false;
  if (!PHASES.includes(snapshotState.phase)) return false;
  if (!roundsHaveShape(snapshotState.rounds, entrants.length)) return false;
  if (!cursorFits(snapshotState.rounds, snapshotState.phase, snapshotState.round, snapshotState.match)) return false;
  if (!pairingsMatchEntrants(snapshotState.rounds, entrants)) return false;
  if (!thirdFits(snapshotState.rounds, snapshotState.phase, snapshotState.round, snapshotState.third)) return false;
  return slugsAreEntrants(snapshotState.rounds, snapshotState.third, entrantSet);
}

function roundsHaveShape(rounds, size) {
  const depth = depthOf(size);
  if (!depth || !Array.isArray(rounds) || rounds.length !== depth) return false;
  return rounds.every((round, index) => Array.isArray(round) && round.length === size / 2 ** (index + 1));
}

function cursorFits(rounds, phase, round, match) {
  const finalIndex = rounds.length - 1;
  if (!Number.isInteger(round) || !Number.isInteger(match)) return false;
  if (phase === "main") {
    if (round < 0 || round > finalIndex || match < 0 || match >= rounds[round].length) return false;
  } else if (round !== finalIndex || match !== 0) return false;
  for (let roundIndex = 0; roundIndex < rounds.length; roundIndex += 1) {
    for (let index = 0; index < rounds[roundIndex].length; index += 1) {
      const item = rounds[roundIndex][index];
      if (!isPlainMatch(item)) return false;
      const played = phase !== "main" || roundIndex < round || (roundIndex === round && index < match);
      const current = phase === "main" && roundIndex === round && index === match;
      if (played) {
        if (!isDecided(item)) return false;
      } else if (item.winner != null) return false;
      const needsPair = played || current || roundIndex === round;
      if (needsPair && !isOpenPair(item)) return false;
      if (!needsPair && (!optionalSlot(item.a) || !optionalSlot(item.b))) return false;
      if (!needsPair && item.a != null && item.a === item.b) return false;
    }
  }
  return true;
}

function pairingsMatchEntrants(rounds, entrants) {
  for (let index = 0; index < rounds[0].length; index += 1) {
    const match = rounds[0][index];
    if (match.a !== entrants[index * 2] || match.b !== entrants[index * 2 + 1]) return false;
  }
  for (let roundIndex = 0; roundIndex < rounds.length - 1; roundIndex += 1) {
    for (let index = 0; index < rounds[roundIndex].length; index += 1) {
      const match = rounds[roundIndex][index];
      const dest = rounds[roundIndex + 1][Math.floor(index / 2)];
      const slot = index % 2 === 0 ? "a" : "b";
      if (isDecided(match)) {
        if (dest[slot] !== match.winner) return false;
      } else if (dest[slot] != null) return false;
    }
  }
  return true;
}

function thirdFits(rounds, phase, round, third) {
  const finalIndex = rounds.length - 1;
  const showingFinal = phase !== "main" || round === finalIndex;
  if (!showingFinal) return third == null;
  const semis = rounds[finalIndex - 1];
  if (!semis?.every(isDecided)) return false;
  const losers = semis.map((match) => opponent(match, match.winner));
  if (losers.some((slug) => !usableSlug(slug)) || losers[0] === losers[1]) return false;
  if (!isPlainMatch(third) || third.a !== losers[0] || third.b !== losers[1]) return false;
  if (phase === "done") return isDecided(third);
  return third.winner == null;
}

function slugsAreEntrants(rounds, third, entrantSet) {
  const matches = rounds.flat();
  if (third) matches.push(third);
  return matches.every((match) => [match?.a, match?.b, match?.winner].every((slot) => slot == null || entrantSet.has(slot)));
}

function decidedMatch(match, token) {
  if (!isDecided(match)) return null;
  return { round: token, winner: match.winner, loser: opponent(match, match.winner) };
}

function isDecided(match) {
  return isOpenPair(match) && usableSlug(opponent(match, match.winner));
}

function isOpenPair(match) {
  return isPlainMatch(match) && usableSlug(match.a) && usableSlug(match.b) && match.a !== match.b;
}

function optionalSlot(slot) {
  return slot == null || usableSlug(slot);
}

function isPlainMatch(match) {
  return Boolean(match) && typeof match === "object" && !Array.isArray(match);
}

function opponent(match, slug) {
  if (!isPlainMatch(match) || !usableSlug(slug)) return null;
  if (slug === match.a) return match.b;
  if (slug === match.b) return match.a;
  return null;
}

function usableSlug(slug) {
  return typeof slug === "string" && slug.length > 0;
}

function openMatch(a = null, b = null) {
  return { a, b, winner: null };
}

function depthOf(size) {
  const depth = Math.log2(size);
  return Number.isInteger(depth) ? depth : null;
}

function snapshot(state) {
  return {
    rounds: structuredClone(state.rounds),
    third: structuredClone(state.third),
    phase: state.phase,
    round: state.round,
    match: state.match,
  };
}

function cloneState(state) {
  if (!state || !Array.isArray(state.entrants) || !Array.isArray(state.rounds)) return null;
  const history = [];
  const source = Array.isArray(state.history) ? state.history : [];
  for (const entry of source) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.rounds)) return null;
    history.push(snapshot(entry));
  }
  return {
    version: state.version,
    size: state.size,
    entrants: state.entrants.slice(),
    ...snapshot(state),
    history,
  };
}

function raise(message, fields) {
  const error = new Error(message);
  Object.assign(error, fields);
  throw error;
}
