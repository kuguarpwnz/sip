import { describe, expect, it } from "vitest";
import type { DrinkLog } from "./api";
import { dayEntries, historyStats, type Period } from "./history-stats";

const GOAL = 2000;
const WEEK: Period = { kind: "week", offset: 0 };
const MONTH: Period = { kind: "month", offset: 0 };
const YEAR: Period = { kind: "year", offset: 0 };

/** Local time, so the tests mean the same in every time zone. Months are 1 to 12. */
const at = (y: number, m: number, d: number, h = 12, min = 0, ms = 0) => new Date(y, m - 1, d, h, min, 0, ms).getTime();

let nextId = 1;
const log = (atMs: number, waterMl: number, typeId = 1, ml = waterMl): DrinkLog => ({ id: nextId++, atMs, ml, typeId, waterMl });

/** A day that reached the goal, in two drinks. */
const met = (y: number, m: number, d: number): DrinkLog[] => [log(at(y, m, d, 9), 1000), log(at(y, m, d, 18), 1000)];

const stats = (logs: DrinkLog[], now: number, period: Period = WEEK, goal = GOAL) => {
  const sorted = [...logs].sort((a, b) => a.atMs - b.atMs);
  return historyStats(sorted, sorted.length ? sorted[0].atMs : null, goal, now, period);
};
const states = (s: ReturnType<typeof stats>) => s.days.map((d) => d.state);

// Tue 17 Nov 2026 is the week of Mon 16 to Sun 22 November.
const TUE = at(2026, 11, 17);

describe("week boundaries", () => {
  it("runs Monday to Sunday and labels the dates", () => {
    const s = stats([], TUE);

    expect(s.days.map((d) => d.day)).toEqual([16, 17, 18, 19, 20, 21, 22]);
    expect(s.days.map((d) => d.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(s.label).toBe("Nov 16 to 22");
    expect(s.startMs).toBe(at(2026, 11, 16, 0));
    expect(s.endMs).toBe(at(2026, 11, 23, 0));
  });

  it("keeps Sunday night in the week and starts the next one at Monday midnight", () => {
    expect(stats([], at(2026, 11, 22, 23, 59)).label).toBe("Nov 16 to 22");
    expect(stats([], at(2026, 11, 23, 0, 0)).label).toBe("Nov 23 to 29");
  });

  it("goes back by whole weeks, and names both months across a month boundary", () => {
    expect(stats([], TUE, { kind: "week", offset: -1 }).label).toBe("Nov 9 to 15");
    expect(stats([], at(2026, 12, 2), WEEK).label).toBe("Nov 30 to Dec 6");
    expect(stats([], at(2026, 12, 2), WEEK).days.map((d) => d.day)).toEqual([30, 1, 2, 3, 4, 5, 6]);
  });

  it("puts a drink at 23:59:59.999 on its own day and one at midnight on the next", () => {
    const s = stats([log(at(2026, 11, 15, 8), 100), log(at(2026, 11, 15, 23, 59, 59 * 1000 + 999), 300), log(at(2026, 11, 16, 0, 0), 500)], TUE);

    expect(s.days[0].waterMl).toBe(500);
    const before = stats([], TUE, { kind: "week", offset: -1 });
    expect(before.days[6].day).toBe(15);
  });
});

describe("month boundaries", () => {
  it("covers the whole month, with the weekday of the 1st", () => {
    const s = stats([], TUE, MONTH);

    expect(s.label).toBe("November");
    expect(s.days).toHaveLength(30);
    expect(s.days[0].weekday).toBe(6);
    expect(s.days[29].day).toBe(30);
  });

  it("knows month lengths, and adds the year to a month of another year", () => {
    const march = at(2027, 3, 5);
    expect(stats([], march, { kind: "month", offset: -1 }).days).toHaveLength(28);
    expect(stats([], march, { kind: "month", offset: -1 }).label).toBe("February");
    expect(stats([], TUE, { kind: "month", offset: -11 }).label).toBe("December 2025");
    expect(stats([], TUE, { kind: "month", offset: -11 }).days).toHaveLength(31);
  });

  it("crosses the year when stepping back from January", () => {
    expect(stats([], at(2027, 1, 10), { kind: "month", offset: -1 }).label).toBe("December 2026");
  });
});

describe("year boundaries", () => {
  it("has twelve months and no day cells", () => {
    const s = stats([], TUE, YEAR);

    expect(s.label).toBe("2026");
    expect(s.months).toHaveLength(12);
    expect(s.days).toEqual([]);
    expect(stats([], TUE, { kind: "year", offset: -1 }).label).toBe("2025");
  });

  it("averages each month over its completed days with data, zero days included, and judges it against the goal", () => {
    const logs = [log(at(2026, 9, 29), 2000), log(at(2026, 9, 30), 3000), log(at(2026, 10, 1), 3000), log(at(2026, 10, 2), 2000), log(at(2026, 11, 2), 500)];
    const s = stats(logs, TUE, YEAR);
    const month = (i: number) => s.months[i];

    expect(month(8)).toMatchObject({ avgMl: 2500, state: "met" });
    expect(month(9)).toMatchObject({ avgMl: Math.round(5000 / 31), state: "missed" });
    expect(month(10)).toMatchObject({ avgMl: Math.round(500 / 16), state: "missed" });
    expect(month(7)).toMatchObject({ avgMl: null, state: "nodata" });
    expect(month(11)).toMatchObject({ avgMl: null, state: "nodata" });
    expect(s.tiles.bestMonth).toEqual({ month: 8, avgMl: 2500 });
  });

  it("counts a month at exactly the goal as met, and one just under as missed", () => {
    const now = at(2026, 10, 7);

    expect(stats([log(at(2026, 10, 5), 2000), log(at(2026, 10, 6), 2000)], now, YEAR).months[9]).toMatchObject({ avgMl: 2000, state: "met" });
    expect(stats([log(at(2026, 10, 5), 2000), log(at(2026, 10, 6), 1999)], now, YEAR).months[9]).toMatchObject({ avgMl: 2000, state: "missed" });
  });

  it("totals the year per completed day, not per month", () => {
    const s = stats([...met(2026, 1, 5), log(at(2026, 1, 6), 500)], at(2026, 1, 8), YEAR);

    // 5 Jan to 7 Jan are completed with data: 2000, 500, 0.
    expect(s.tiles).toMatchObject({ avgMl: 833, metDays: 1, countedDays: 3 });
  });
});

describe("today is in progress", () => {
  const logs = [...met(2026, 11, 16), log(at(2026, 11, 17, 8), 2500)];

  it("shows today with its water but not as met or missed", () => {
    const s = stats(logs, TUE);

    expect(s.days[1]).toMatchObject({ state: "today", waterMl: 2500 });
    expect(s.days[0].state).toBe("met");
  });

  it("leaves today out of the average, the goal count and the best day", () => {
    const s = stats(logs, TUE);

    expect(s.tiles.avgMl).toBe(2000);
    expect(s.tiles.metDays).toBe(1);
    expect(s.tiles.countedDays).toBe(1);
    expect(s.tiles.bestDay).toEqual({ startMs: at(2026, 11, 16, 0), waterMl: 2000 });
  });

  it("leaves today's hours out of the hour averages", () => {
    const s = stats(logs, TUE);

    expect(s.hours[8]).toBe(0);
    expect(s.hours[9]).toBe(1000);
  });

  it("shows no best day when only today has water", () => {
    const s = stats([log(at(2026, 11, 17, 8), 500)], TUE);

    expect(s.tiles).toMatchObject({ avgMl: null, countedDays: 0, bestDay: null });
    expect(s.days[1].state).toBe("today");
  });

  it("marks later days of this week as future", () => {
    expect(states(stats(logs, TUE))).toEqual(["met", "today", "future", "future", "future", "future", "future"]);
  });

  it("counts yesterday as completed once the clock passes midnight", () => {
    const next = stats([...logs, log(at(2026, 11, 18, 7), 100)], at(2026, 11, 18, 7, 30));

    expect(next.days[1].state).toBe("met");
    expect(next.days[2].state).toBe("today");
  });
});

describe("days before the first log", () => {
  const logs = [log(at(2026, 11, 18, 9), 1000), log(at(2026, 11, 19, 9), 2500)];
  const now = at(2026, 11, 22, 10);

  it("are no data, and a day after it with no logs is a missed 0 ml", () => {
    const s = stats(logs, now);

    expect(states(s)).toEqual(["nodata", "nodata", "missed", "met", "missed", "missed", "today"]);
    expect(s.days[4].waterMl).toBe(0);
  });

  it("are left out of every count", () => {
    const s = stats(logs, now);

    expect(s.tiles).toMatchObject({ metDays: 1, countedDays: 4, avgMl: Math.round(3500 / 4) });
  });

  it("make the first log's own day the start, even when the log is late in the day", () => {
    const s = stats([log(at(2026, 11, 18, 23, 30), 100)], now);

    expect(s.days[2].state).toBe("missed");
    expect(s.days[1].state).toBe("nodata");
  });

  it("leave a whole earlier month with no data and no averages", () => {
    const s = stats(logs, now, { kind: "month", offset: -1 });

    expect(states(s).every((x) => x === "nodata")).toBe(true);
    expect(s.tiles).toMatchObject({ avgMl: null, metDays: 0, countedDays: 0, bestDay: null });
    expect(s.mix).toEqual([]);
  });

  it("make everything no data except today when nothing was ever logged", () => {
    const s = historyStats([], null, GOAL, now, WEEK);

    expect(states(s)).toEqual(["nodata", "nodata", "nodata", "nodata", "nodata", "nodata", "today"]);
    expect(s.tiles).toMatchObject({ avgMl: null, countedDays: 0, streak: 0 });
    expect(s.hours.every((h) => h === 0)).toBe(true);
  });
});

describe("zero-log days", () => {
  it("count as missed days in the average and in the total of days", () => {
    const s = stats([...met(2026, 11, 16)], at(2026, 11, 20, 10));

    expect(states(s).slice(0, 4)).toEqual(["met", "missed", "missed", "missed"]);
    expect(s.tiles).toMatchObject({ avgMl: 500, metDays: 1, countedDays: 4 });
  });

  it("count in the hour averages' divisor", () => {
    const s = stats([log(at(2026, 11, 16, 8), 600)], at(2026, 11, 20, 10));

    expect(s.hours[8]).toBe(150);
  });
});

describe("water, not volume", () => {
  it("counts waterMl everywhere", () => {
    const coffee = log(at(2026, 11, 16, 9), 990, 2, 1000);
    const s = stats([coffee, log(at(2026, 11, 16, 12), 1000)], at(2026, 11, 17, 8));

    expect(s.days[0]).toMatchObject({ waterMl: 1990, state: "missed" });
    expect(s.tiles.avgMl).toBe(1990);
    expect(s.mix.find((m) => m.typeId === 2)?.waterMl).toBe(990);
  });
});

describe("the goal", () => {
  it("judges every past day against the goal it is given", () => {
    const logs = [log(at(2026, 11, 16, 9), 1800), log(at(2026, 11, 17, 9), 2100)];
    const now = at(2026, 11, 19, 9);

    expect(states(stats(logs, now, WEEK, 2000)).slice(0, 2)).toEqual(["missed", "met"]);
    expect(states(stats(logs, now, WEEK, 1800)).slice(0, 2)).toEqual(["met", "met"]);
    expect(states(stats(logs, now, WEEK, 3000)).slice(0, 2)).toEqual(["missed", "missed"]);
  });
});

describe("the streak", () => {
  it("runs across a month boundary", () => {
    const logs = [...met(2026, 10, 29), ...met(2026, 10, 30), ...met(2026, 10, 31), ...met(2026, 11, 1), ...met(2026, 11, 2)];
    const now = at(2026, 11, 3, 9);

    expect(stats(logs, now, MONTH).tiles.streak).toBe(5);
    expect(stats(logs, now, { kind: "month", offset: -1 }).tiles.streak).toBe(5);
  });

  it("adds today once it has reached the goal", () => {
    const logs = [...met(2026, 10, 31), ...met(2026, 11, 1), log(at(2026, 11, 2, 8), 2000)];

    expect(stats(logs, at(2026, 11, 2, 9)).tiles.streak).toBe(3);
    expect(stats([...logs.slice(0, 4), log(at(2026, 11, 2, 8), 1999)], at(2026, 11, 2, 9)).tiles.streak).toBe(2);
  });

  it("stops at a missed day, and starts over at 1 when only today is met", () => {
    const logs = [...met(2026, 10, 29), log(at(2026, 10, 30), 100), ...met(2026, 10, 31), ...met(2026, 11, 1)];

    expect(stats(logs, at(2026, 11, 2, 9)).tiles.streak).toBe(2);
    const gap = [...logs, log(at(2026, 11, 3, 8), 2500)];
    expect(stats(gap, at(2026, 11, 3, 9)).tiles.streak).toBe(1);
  });

  it("is 0 when yesterday was missed and today has not reached the goal", () => {
    expect(stats([...met(2026, 11, 14), log(at(2026, 11, 16), 10)], at(2026, 11, 17, 9)).tiles.streak).toBe(0);
  });

  it("does not run into days before the first log", () => {
    expect(stats(met(2026, 11, 16), at(2026, 11, 17, 9)).tiles.streak).toBe(1);
  });

  it("does not count a met day that is the only one before a gap of no data", () => {
    expect(stats([], at(2026, 11, 17, 9)).tiles.streak).toBe(0);
  });
});

describe("the best day", () => {
  it("is the completed day with the most water, and the earliest of equals", () => {
    const logs = [log(at(2026, 11, 16, 9), 1500), log(at(2026, 11, 17, 9), 2600), log(at(2026, 11, 18, 9), 2600), log(at(2026, 11, 19, 9), 4000)];
    const s = stats(logs, at(2026, 11, 19, 20));

    expect(s.tiles.bestDay).toEqual({ startMs: at(2026, 11, 17, 0), waterMl: 2600 });
  });
});

describe("hours of the day", () => {
  it("averages water per hour over the completed days with data", () => {
    const logs = [
      log(at(2026, 11, 16, 8, 5), 500),
      log(at(2026, 11, 16, 8, 50), 250),
      log(at(2026, 11, 16, 20, 10), 250),
      log(at(2026, 11, 17, 8, 0), 300),
      log(at(2026, 11, 17, 23, 59), 100),
      log(at(2026, 11, 18, 8, 0), 9999),
    ];
    const s = stats(logs, at(2026, 11, 18, 12));

    expect(s.hours).toHaveLength(24);
    expect(s.hours[8]).toBe((750 + 300) / 2);
    expect(s.hours[20]).toBe(125);
    expect(s.hours[23]).toBe(50);
    expect(s.hours[0]).toBe(0);
  });

  it("only looks at the period", () => {
    const logs = [log(at(2026, 11, 9, 8), 800), log(at(2026, 11, 16, 8), 400)];

    expect(stats(logs, TUE, WEEK).hours[8]).toBe(400);
    expect(stats(logs, TUE, { kind: "week", offset: -1 }).hours[8]).toBe(800 / 7);
  });
});

describe("the drink mix", () => {
  it("shares the period's water by type, largest first", () => {
    const logs = [
      log(at(2026, 11, 16, 8), 600, 1),
      log(at(2026, 11, 16, 9), 198, 2),
      log(at(2026, 11, 16, 10), 99, 3),
      log(at(2026, 11, 16, 11), 103, 4),
      log(at(2026, 11, 16, 12), 0, 5, 300),
      log(at(2026, 11, 17, 9), 1000, 1),
    ];
    const s = stats(logs, at(2026, 11, 18, 9));

    expect(s.mix.map((m) => m.typeId)).toEqual([1, 2, 4, 3]);
    expect(s.mix[0]).toMatchObject({ waterMl: 1600, share: 0.8 });
    expect(s.mix.reduce((n, m) => n + m.share, 0)).toBeCloseTo(1, 10);
  });

  it("breaks ties by type id and leaves out types with no water", () => {
    const s = stats([log(at(2026, 11, 16, 8), 100, 3), log(at(2026, 11, 16, 9), 100, 2), log(at(2026, 11, 16, 10), 0, 1, 250)], at(2026, 11, 18, 9));

    expect(s.mix.map((m) => m.typeId)).toEqual([2, 3]);
  });

  it("includes what was drunk today, since it is water in the period", () => {
    const s = stats([log(at(2026, 11, 17, 8), 400, 2)], TUE);

    expect(s.mix).toEqual([{ typeId: 2, waterMl: 400, share: 1 }]);
  });
});

describe("a day's entries", () => {
  it("lists the day's drinks newest first and totals their water", () => {
    const a = log(at(2026, 11, 16, 8), 300);
    const b = log(at(2026, 11, 16, 8), 200);
    const c = log(at(2026, 11, 16, 14), 100);
    const other = log(at(2026, 11, 17, 0), 999);

    const day = dayEntries([a, b, c, other], at(2026, 11, 16, 0));

    expect(day.logs.map((l) => l.id)).toEqual([c.id, b.id, a.id]);
    expect(day.waterMl).toBe(600);
  });
});
