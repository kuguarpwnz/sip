import { describe, expect, it } from "vitest";
import type { DrinkLog } from "./api";
import { dayLabel, earlierDays } from "./days";

const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
const midnight = (day: number) => at(day, 0);
let nextId = 1;
const log = (atMs: number): DrinkLog => ({ id: nextId++, atMs, ml: 250, typeId: 1, waterMl: 250 });

const TODAY = midnight(22);

describe("earlierDays", () => {
  it("groups logs into local days, newest day first and each day's logs newest first", () => {
    const a = log(at(18, 8));
    const b = log(at(20, 9));
    const c = log(at(20, 17));
    const d = log(at(18, 23, 59));

    const days = earlierDays([a, b, c, d], TODAY);

    expect(days.map((x) => [x.startMs, x.logs.map((l) => l.id)])).toEqual([
      [midnight(20), [c.id, b.id]],
      [midnight(18), [d.id, a.id]],
    ]);
  });

  it("skips empty days and leaves out today and later", () => {
    const days = earlierDays([log(at(19, 12)), log(at(22, 0)), log(at(22, 9)), log(at(23, 9))], TODAY);

    expect(days.map((x) => x.startMs)).toEqual([midnight(19)]);
  });

  it("breaks a tie on the time by the higher id first", () => {
    const a = log(at(20, 9));
    const b = log(at(20, 9));

    expect(earlierDays([a, b], TODAY)[0].logs.map((l) => l.id)).toEqual([b.id, a.id]);
  });

  it("returns nothing for no logs", () => {
    expect(earlierDays([], TODAY)).toEqual([]);
  });
});

describe("dayLabel", () => {
  it("calls the day before today Yesterday and any other day by its date", () => {
    expect(dayLabel(midnight(21), TODAY)).toBe("Yesterday");
    expect(dayLabel(midnight(17), TODAY)).toBe("Tue, Nov 17");
  });
});
