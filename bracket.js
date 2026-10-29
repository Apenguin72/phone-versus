export const BRACKET_SIZES = [16, 32, 64];

export function mainMatchCount(size) {
  return size - 1;
}

export function sizeOptions(poolSize) {
  return BRACKET_SIZES.map((size) => ({
    size,
    enabled: poolSize >= size,
    message: poolSize >= size ? "" : `主力機型只有 ${poolSize} 支，不能進行 ${size} 強。`,
  }));
}

export function roundName(size, roundIndex) {
  const players = size / 2 ** roundIndex;
  if (players === 2) return "決賽";
  if (players === 4) return "準決賽";
  return `${players}強`;
}

export function shuffle(items, random = Math.random) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function drawEntrants(slugs, size, random = Math.random) {
  const unique = [];
  const seen = new Set();
  for (const slug of slugs) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    unique.push(slug);
  }
  if (unique.length < size) {
    const error = new Error(`pool ${unique.length} is smaller than bracket ${size}`);
    error.code = "pool-too-small";
    error.pool = unique.length;
    error.size = size;
    throw error;
  }
  const drawn = shuffle(unique, random).slice(0, size);
  if (new Set(drawn).size !== size) throw new Error("draw produced duplicates");
  return drawn;
}

export function createTournament(slugs) {
  const size = slugs.length;
  if (!BRACKET_SIZES.includes(size)) throw new Error(`unsupported bracket size ${size}`);
  if (new Set(slugs).size !== size) throw new Error("duplicate entrants");
  const rounds = [];
  const first = [];
  for (let i = 0; i < size; i += 2) {
    first.push({ a: slugs[i], b: slugs[i + 1], winner: null });
  }
  rounds.push(first);
  const depth = Math.log2(size);
  for (let round = 1; round < depth; round += 1) {
    const matches = size / 2 ** (round + 1);
    rounds.push(Array.from({ length: matches }, () => ({ a: null, b: null, winner: null })));
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
  if (state.phase === "third") return state.third;
  return state.rounds[state.round][state.match];
}

export function progress(state) {
  if (!state || state.phase === "done") return null;
  if (state.phase === "third") return { roundName: "季軍戰", index: 1, total: 1 };
  return {
    roundName: roundName(state.size, state.round),
    index: state.match + 1,
    total: state.rounds[state.round].length,
  };
}

export function pickWinner(state, slug) {
  const match = currentMatch(state);
  if (!match || match.winner) return state;
  if (slug !== match.a && slug !== match.b) return state;
  const next = cloneState(state);
  next.history.push(snapshot(state));
  currentMatch(next).winner = slug;
  advance(next);
  return next;
}

export function undo(state) {
  if (!state?.history?.length) return state;
  const prev = state.history[state.history.length - 1];
  return {
    version: state.version,
    size: state.size,
    entrants: state.entrants.slice(),
    rounds: structuredClone(prev.rounds),
    third: structuredClone(prev.third),
    phase: prev.phase,
    round: prev.round,
    match: prev.match,
    history: state.history.slice(0, -1),
  };
}

export function podium(state) {
  if (!state || state.phase !== "done" || !state.third?.winner) return null;
  const final = state.rounds[state.rounds.length - 1][0];
  const champion = final.winner;
  const runnerUp = champion === final.a ? final.b : final.a;
  return { champion, runnerUp, third: state.third.winner };
}

export function semifinalLosers(state) {
  const semis = state.rounds[state.rounds.length - 2];
  if (semis.some((match) => !match.winner)) return null;
  return semis.map((match) => (match.winner === match.a ? match.b : match.a));
}

export function isRestorable(state, knownSlugs) {
  if (!state || state.version !== 1 || !BRACKET_SIZES.includes(state.size)) return false;
  if (!Array.isArray(state.entrants) || state.entrants.length !== state.size) return false;
  if (new Set(state.entrants).size !== state.size) return false;
  if (state.entrants.some((slug) => !knownSlugs.has(slug))) return false;
  if (!Array.isArray(state.rounds) || state.rounds.length !== Math.log2(state.size)) return false;
  if (!["main", "third", "done"].includes(state.phase)) return false;
  return true;
}

function advance(state) {
  if (state.phase === "third") {
    state.phase = "done";
    return;
  }
  const round = state.rounds[state.round];
  const match = round[state.match];
  const winner = match.winner;
  const finalRound = state.round === state.rounds.length - 1;
  if (!finalRound) {
    const dest = state.rounds[state.round + 1][Math.floor(state.match / 2)];
    dest[state.match % 2 === 0 ? "a" : "b"] = winner;
  }
  if (state.match + 1 < round.length) {
    state.match += 1;
    return;
  }
  if (!finalRound) {
    state.round += 1;
    state.match = 0;
    if (state.round === state.rounds.length - 1) {
      const losers = semifinalLosers(state);
      state.third = { a: losers[0], b: losers[1], winner: null };
    }
    return;
  }
  state.phase = "third";
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
  return {
    version: state.version,
    size: state.size,
    entrants: state.entrants.slice(),
    rounds: structuredClone(state.rounds),
    third: structuredClone(state.third),
    phase: state.phase,
    round: state.round,
    match: state.match,
    history: state.history.map((entry) => ({
      rounds: structuredClone(entry.rounds),
      third: structuredClone(entry.third),
      phase: entry.phase,
      round: entry.round,
      match: entry.match,
    })),
  };
}
