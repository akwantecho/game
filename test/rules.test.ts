import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BANK } from "../server/questions";
import { ANSWER_GRACE_MS, Room } from "../server/room";
import { Store } from "../server/store";
import { BUZZ_ANSWER_S, POWER_TIME_S, normalizeAnswer, RESULT_EXTRA_MS, RESULT_MS, stealMs, type Rules, type Special } from "../shared/game";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  for (const q of BANK) q.isActive = true; // tests that shrink the bank put it back
});

/** A started match between seat 0 and seat 1 under `rules`. */
function match(rules: Partial<Rules>) {
  const room = new Room("TESTS", "أ", rules, () => {});
  room.join("ب");
  room.start(0);
  return room;
}

const WRONG = "zzz";
const right = (room: Room) => room.game.q!.answer;
/** First neutral cell with no special and no lock. */
const plain = (room: Room) => room.game.owners.findIndex((o, i) => o === null && !room.game.specials[i] && !room.game.locked.includes(i));
const special = (room: Room, kind: Special) => room.game.specials.indexOf(kind);
/** Let the result screen run out and the next turn begin. */
const settle = () => vi.advanceTimersByTime(RESULT_MS + RESULT_EXTRA_MS);

describe("lobby rules", () => {
  it("only the host changes them, only before the match, and the board follows the size", () => {
    const room = new Room("TESTS", "أ", { size: 4 }, () => {});
    room.join("ب");
    expect(room.view(1).letters).toHaveLength(16);
    room.setRules(1, { size: 6 });
    expect(room.rules.size).toBe(4);
    room.setRules(0, { size: 6, steal: true, timeLimit: 99 });
    expect(room.rules).toMatchObject({ size: 6, steal: true, timeLimit: 20 });
    room.start(0);
    expect(room.view(0).letters).toHaveLength(36);
    expect(new Set(room.view(0).letters).size).toBeGreaterThan(20); // repeats only once letters run out
    room.setRules(0, { size: 4 });
    expect(room.rules.size).toBe(6);
  });
});

describe("steal", () => {
  it("passes a missed question to the other player, who takes the cell", () => {
    const room = match({ steal: true });
    const cell = plain(room);
    room.pick(0, cell);
    room.answer(0, WRONG);
    const v = room.view(1);
    expect(v.phase).toBe("question");
    expect(v.answerer).toBe(1);
    expect(v.stealing).toBe(true);
    expect(v.windowMs).toBe(stealMs(20));
    expect(v.attempts).toEqual([{ seat: 0, ok: false, kind: null, given: WRONG }]);
    room.answer(0, right(room)); // no second try for the one who missed
    expect(room.game.attempts).toHaveLength(1);
    room.answer(1, right(room));
    expect(room.game.owners[cell]).toBe(1);
    expect(room.view(0).result).toMatchObject({ ok: true, owner: 1 });
    expect(room.game.stats).toEqual([{ c: 0, w: 1 }, { c: 1, w: 0 }]);
    settle();
    expect(room.game).toMatchObject({ phase: "pick", current: 1, turn: 2 });
  });

  it("a stealer can pass, or let the clock run, without it counting as wrong", () => {
    const room = match({ steal: true });
    room.pick(0, plain(room));
    room.answer(0, WRONG);
    room.answer(1, "  ");
    expect(room.view(0).result!.attempts[1]).toMatchObject({ seat: 1, kind: "pass" });
    settle();
    room.pick(1, plain(room));
    vi.advanceTimersByTime(20_000 + ANSWER_GRACE_MS);
    expect(room.game.answerer).toBe(0);
    vi.advanceTimersByTime(stealMs(20) + ANSWER_GRACE_MS);
    expect(room.view(0).result).toMatchObject({ owner: null, attempts: [{ kind: "timeout" }, { kind: "timeout" }] });
    // each missed their own question; the steals that ran out or passed don't count
    expect(room.game.stats).toEqual([{ c: 0, w: 1 }, { c: 0, w: 1 }]);
  });
});

describe("buzzer mode", () => {
  it("shows the question to both and lets the first to buzz answer", () => {
    const room = match({ mode: "buzzer" });
    const cell = plain(room);
    room.pick(0, cell);
    expect(room.view(1)).toMatchObject({ phase: "buzz", answerer: null });
    expect(room.view(1).q!.answer).toBeUndefined();
    room.buzz(1);
    room.buzz(0); // too late
    expect(room.view(0)).toMatchObject({ phase: "question", answerer: 1, windowMs: BUZZ_ANSWER_S * 1000 });
    room.answer(0, right(room));
    expect(room.game.phase).toBe("question");
    room.answer(1, right(room));
    expect(room.game.owners[cell]).toBe(1);
    settle();
    expect(room.game.current).toBe(1); // picking still alternates
  });

  it("ends the question when nobody buzzes", () => {
    const room = match({ mode: "buzzer", steal: true });
    room.pick(0, plain(room));
    vi.advanceTimersByTime(20_000 + ANSWER_GRACE_MS);
    expect(room.view(0).result).toMatchObject({ ok: false, owner: null, attempts: [] });
  });

  it("with steal on, a wrong buzz hands the question to the other player", () => {
    const room = match({ mode: "buzzer", steal: true });
    room.pick(0, plain(room));
    room.buzz(0);
    room.answer(0, WRONG);
    expect(room.view(1)).toMatchObject({ answerer: 1, stealing: true });
  });
});

describe("special cells", () => {
  it("scatters each kind by board size", () => {
    for (const [size, k] of [[4, 1], [5, 2], [6, 3]]) {
      const s = match({ specials: true, size }).game.specials;
      for (const kind of ["gold", "bomb", "fast"]) expect(s.filter((x) => x === kind)).toHaveLength(k);
    }
    expect(match({}).game.specials.every((x) => x === null)).toBe(true);
  });

  it("gold gives its taker the next pick", () => {
    const room = match({ specials: true });
    room.pick(0, special(room, "gold"));
    room.answer(0, right(room));
    expect(room.view(0).result!.bonus).toBe(true);
    settle();
    expect(room.game).toMatchObject({ phase: "pick", current: 0, turn: 2 });
  });

  it("missing a bomb costs one of your cells", () => {
    const room = match({ specials: true });
    const mine = plain(room);
    room.pick(0, mine);
    room.answer(0, right(room));
    settle();
    room.pick(1, plain(room));
    room.answer(1, WRONG);
    settle();
    room.pick(0, special(room, "bomb"));
    room.answer(0, WRONG);
    expect(room.view(0).result!.lost).toBe(mine);
    expect(room.game.owners[mine]).toBeNull();
  });

  it("a fast cell halves the clock", () => {
    const room = match({ specials: true, timeLimit: 30 });
    room.pick(0, special(room, "fast"));
    expect(room.view(0).windowMs).toBe(15_000);
  });
});

describe("penalties", () => {
  it("lock: the missed cell can't be picked on the next turn only", () => {
    const room = match({ penalty: "lock" });
    const cell = plain(room);
    room.pick(0, cell);
    room.answer(0, WRONG);
    expect(room.view(0).result!.locked).toBe(true);
    settle();
    expect(room.view(1).locked).toEqual([cell]);
    room.pick(1, cell);
    expect(room.game.phase).toBe("pick");
    room.pick(1, plain(room));
    room.answer(1, right(room));
    settle();
    expect(room.view(0).locked).toEqual([]);
    room.pick(0, cell);
    expect(room.game.phase).toBe("question");
  });

  it("lock gives way when the locked cell is the only one left", () => {
    const room = match({ penalty: "lock" });
    const g = room.game;
    g.owners = g.owners.map((_, i) => (i === 0 ? null : i % 2 ? 0 : 1));
    g.locked = [0];
    expect(room.view(0).locked).toEqual([]);
    room.pick(0, 0);
    expect(g.phase).toBe("question");
  });

  it("gift: the missed cell goes to the opponent, and there is no steal", () => {
    const room = match({ penalty: "gift", steal: true });
    const cell = plain(room);
    room.pick(0, cell);
    room.answer(0, WRONG);
    expect(room.view(0).result).toMatchObject({ ok: false, owner: 1, gift: true });
    expect(room.game.owners[cell]).toBe(1);
  });
});

describe("power-ups", () => {
  it("hint, extra time and skip work once each, for the answerer only", () => {
    const room = match({ powers: true });
    room.pick(0, plain(room));
    room.power(1, "hint");
    expect(room.view(1).hint).toBeNull();
    room.power(0, "hint");
    expect(room.view(0).hint!.letters).toBeGreaterThan(0);
    expect(room.view(1).hint).toBeNull(); // the hint is private

    const before = room.game.deadline;
    room.power(0, "time");
    room.power(0, "time");
    expect(room.game.deadline - before).toBe(POWER_TIME_S * 1000);
    vi.advanceTimersByTime(20_000 + ANSWER_GRACE_MS);
    expect(room.game.phase).toBe("question"); // the added seconds are real

    const q = room.game.q!.id;
    expect(room.view(0).canSkip).toBe(true);
    room.power(0, "skip");
    expect(room.game.q!.id).not.toBe(q);
    expect(room.view(0).hint).toBeNull();
    expect(room.view(0).powers[0]).toEqual({ skip: true, time: true, hint: true });
    expect(room.view(0).canSkip).toBe(true); // more questions exist, but the skip is spent
    const now = room.game.q!.id;
    room.power(0, "skip");
    expect(room.game.q!.id).toBe(now);
  });

  it("do nothing when the rule is off", () => {
    const room = match({});
    room.pick(0, plain(room));
    room.power(0, "hint");
    expect(room.view(0).hint).toBeNull();
    room.power(0, "constructor" as never);
    expect(room.game.powers[0]).toEqual({ skip: false, time: false, hint: false });
  });
});

describe("category choice", () => {
  const categoriesOf = (letter: string) => new Set(BANK.filter((q) => q.letter === letter).map((q) => q.category));
  const letters = [...new Set(BANK.map((q) => q.letter))];

  it("asks the picker for a category when the letter has more than one", () => {
    const room = match({ categories: true });
    const g = room.game;
    g.letters[0] = "ق";
    expect(categoriesOf("ق").has("علوم")).toBe(true);
    room.pick(0, 0);
    const v = room.view(1);
    expect(v.phase).toBe("category");
    expect(v.categories.length).toBeGreaterThan(1);
    expect(v.q).toBeNull();
    room.chooseCategory(1, "علوم");
    expect(g.phase).toBe("category");
    room.chooseCategory(0, "علوم");
    expect(g.phase).toBe("question");
    expect(g.q).toMatchObject({ letter: "ق", category: "علوم" });
  });

  it("goes straight to the question when the letter has one category", () => {
    const room = match({ categories: true });
    // Fake a one-category letter by making every other category's questions inactive.
    const only = BANK.filter((q) => q.letter === letters[0] && q.category !== [...categoriesOf(letters[0])][0]);
    for (const q of only) q.isActive = false;
    try {
      room.game.letters[0] = letters[0];
      room.pick(0, 0);
      expect(room.game.phase).toBe("question");
    } finally {
      for (const q of only) q.isActive = true;
    }
  });
});

describe("no repeated questions", () => {
  /** Every cell shows `letter`; the player on turn picks a neutral cell and misses it. */
  const missTurns = (room: Room, letter: string, turns: number) => {
    const asked: string[] = [];
    for (let t = 0; t < turns; t++) {
      room.game.letters = room.game.letters.map(() => letter);
      room.pick(room.game.current, plain(room));
      asked.push(room.game.q!.id);
      room.answer(room.game.current, WRONG);
      settle();
    }
    return asked;
  };
  const byId = (id: string) => BANK.find((q) => q.id === id)!;

  it("asks each question once, and saves repeated answers for last", () => {
    const pool = BANK.filter((q) => q.letter === "ظ");
    const answers = new Set(pool.map((q) => normalizeAnswer(q.answer)));
    const asked = missTurns(match({}), "ظ", pool.length);
    expect(new Set(asked).size).toBe(pool.length);
    const firstAnswers = asked.slice(0, answers.size).map((id) => normalizeAnswer(byId(id).answer));
    expect(new Set(firstAnswers).size).toBe(answers.size);
  });

  it("remembers across sessions: a new room skips what the logged-in players were asked before", async () => {
    vi.useRealTimers(); // scrypt runs on real timers
    const store = new Store(":memory:");
    const a = await store.login("a@b.co", "1111");
    const b = await store.login("b@b.co", "2222");
    if (!a.ok || !b.ok) throw new Error("login failed");
    vi.useFakeTimers();
    const session = (hostAccount: number, guestAccount: number) => {
      const room = new Room("TESTS", "أ", {}, () => {}, { accountId: hostAccount, history: store });
      room.join("ب", guestAccount);
      room.start(0);
      return room;
    };
    const first = missTurns(session(a.account.id, b.account.id), "ظ", 8);
    // Tomorrow, A plays someone new: still nothing A has seen.
    const c = await (vi.useRealTimers(), store.login("c@b.co", "3333"));
    vi.useFakeTimers();
    if (!c.ok) throw new Error("login failed");
    const second = missTurns(session(c.account.id, a.account.id), "ظ", 8);
    expect(second.filter((id) => first.includes(id))).toEqual([]);
    expect(store.seenCount(a.account.id)).toBe(16);
    expect(store.seenCount(c.account.id)).toBe(8);
  });

  it("remembers across a rematch in the same room", () => {
    const room = match({});
    const first = missTurns(room, "ظ", 10);
    room.game.phase = "won";
    room.rematch();
    const second = missTurns(room, "ظ", 10);
    expect(second.filter((id) => first.includes(id))).toEqual([]);
  });

  it("once a letter is used up, reuses the question asked longest ago", () => {
    const keep = BANK.filter((q) => q.letter === "ظ").slice(0, 2);
    for (const q of BANK) if (q.letter === "ظ" && !keep.includes(q)) q.isActive = false;
    const asked = missTurns(match({}), "ظ", 3);
    expect(asked[2]).toBe(asked[0]);
    expect(asked[1]).not.toBe(asked[0]);
  });

  it("skip never brings back a question already asked", () => {
    const keep = BANK.filter((q) => q.letter === "ظ").slice(0, 2);
    for (const q of BANK) if (q.letter === "ظ" && !keep.includes(q)) q.isActive = false;
    const room = match({ powers: true });
    missTurns(room, "ظ", 1);
    room.game.letters = room.game.letters.map(() => "ظ");
    room.pick(1, plain(room));
    expect(room.view(1).canSkip).toBe(false);
    const q = room.game.q!.id;
    room.power(1, "skip");
    expect(room.game.q!.id).toBe(q);
  });

  it("only offers categories that still have unasked questions", () => {
    const room = match({ categories: true });
    const science = BANK.filter((q) => q.letter === "ق" && q.category === "علوم");
    for (const q of science.slice(1)) q.isActive = false;
    room.game.letters = room.game.letters.map(() => "ق");
    room.pick(0, plain(room));
    expect(room.game.categories).toContain("علوم");
    room.chooseCategory(0, "علوم");
    room.answer(0, WRONG);
    settle();
    room.pick(1, plain(room));
    expect(room.game.categories).not.toContain("علوم");
  });
});
