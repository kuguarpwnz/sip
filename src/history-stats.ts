import type { DrinkLog } from "./api";

export type PeriodKind = "week" | "month" | "year";
/** `offset` 0 is the period that holds today, -1 the one before it. */
export interface Period { kind: PeriodKind; offset: number }

/** `today` is in progress, `nodata` is before the first log ever, `future` has not happened yet. */
export type DayState = "met" | "missed" | "today" | "nodata" | "future";

export interface DayCell {
  startMs: number;
  /** Day of the month. */
  day: number;
  /** 0 is Monday. */
  weekday: number;
  state: DayState;
  waterMl: number;
  logs: DrinkLog[];
}

export interface MonthCell {
  startMs: number;
  /** 0 is January. */
  month: number;
  /** Average water per completed day with data, null when the month has none. */
  avgMl: number | null;
  state: "met" | "missed" | "nodata";
}

export interface MixRow { typeId: number; waterMl: number; share: number }

export interface Tiles {
  /** Average water per completed day with data. */
  avgMl: number | null;
  metDays: number;
  countedDays: number;
  /** The completed day with the most water, the earliest on a tie. Null when no day has any water. */
  bestDay: { startMs: number; waterMl: number } | null;
  /** Days in a row with the goal met, ending yesterday, plus today once it has reached the goal. Not limited to the period. */
  streak: number;
  /** The month with the highest average. Only for a year. */
  bestMonth: { month: number; avgMl: number } | null;
}

export interface HistoryStats {
  startMs: number;
  endMs: number;
  label: string;
  /** Every day of a week or month, empty for a year. */
  days: DayCell[];
  /** Twelve months of a year, empty otherwise. */
  months: MonthCell[];
  tiles: Tiles;
  /** Average water per completed day with data, for each hour of the day. */
  hours: number[];
  /** Water per drink type over the period, largest share first. */
  mix: MixRow[];
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const short = (month: number) => MONTHS[month].slice(0, 3);

/** Local midnight of the day that holds `ms`. Built from the date fields, so a 23 or 25 hour day is still one day. */
export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

const addDays = (dayStart: number, n: number) => {
  const d = new Date(dayStart);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};

const weekdayOf = (ms: number) => (new Date(ms).getDay() + 6) % 7;

export const dayTitle = (startMs: number) => {
  const d = new Date(startMs);
  return `${WEEKDAYS[weekdayOf(startMs)]}, ${short(d.getMonth())} ${d.getDate()}`;
};

const rangeOf = ({ kind, offset }: Period, now: number) => {
  const d = new Date(now);
  if (kind === "week") {
    const today = startOfDay(now);
    const start = addDays(today, offset * 7 - weekdayOf(today));
    return { startMs: start, endMs: addDays(start, 7) };
  }
  if (kind === "month") {
    return {
      startMs: new Date(d.getFullYear(), d.getMonth() + offset, 1).getTime(),
      endMs: new Date(d.getFullYear(), d.getMonth() + offset + 1, 1).getTime(),
    };
  }
  return {
    startMs: new Date(d.getFullYear() + offset, 0, 1).getTime(),
    endMs: new Date(d.getFullYear() + offset + 1, 0, 1).getTime(),
  };
};

const labelOf = (kind: PeriodKind, startMs: number, endMs: number, now: number) => {
  const first = new Date(startMs);
  if (kind === "year") return String(first.getFullYear());
  if (kind === "month") {
    return first.getFullYear() === new Date(now).getFullYear() ? MONTHS[first.getMonth()] : `${MONTHS[first.getMonth()]} ${first.getFullYear()}`;
  }
  const last = new Date(addDays(endMs, -1));
  return first.getMonth() === last.getMonth()
    ? `${short(first.getMonth())} ${first.getDate()} to ${last.getDate()}`
    : `${short(first.getMonth())} ${first.getDate()} to ${short(last.getMonth())} ${last.getDate()}`;
};

const groupByDay = (logs: DrinkLog[]) => {
  const byDay = new Map<number, DrinkLog[]>();
  for (const l of logs) {
    const key = startOfDay(l.atMs);
    const day = byDay.get(key);
    if (day) day.push(l);
    else byDay.set(key, [l]);
  }
  return byDay;
};

const sumWater = (logs: DrinkLog[]) => logs.reduce((n, l) => n + l.waterMl, 0);

/** One day's logs newest first, with their water. */
export const dayEntries = (logs: DrinkLog[], startMs: number) => {
  const end = addDays(startMs, 1);
  const entries = logs.filter((l) => l.atMs >= startMs && l.atMs < end).sort((a, b) => b.atMs - a.atMs || b.id - a.id);
  return { logs: entries, waterMl: sumWater(entries) };
};

/**
 * Everything History shows, from logs fetched once. Every day is judged against `goalMl`.
 * Days before the first log are `nodata` and counted nowhere, a later day without logs is a missed 0 ml,
 * and today is shown but left out of averages, goal counts and the best day.
 */
export const historyStats = (logs: DrinkLog[], firstAtMs: number | null, goalMl: number, now: number, period: Period): HistoryStats => {
  const byDay = groupByDay(logs);
  const today = startOfDay(now);
  const firstDay = firstAtMs === null ? null : startOfDay(firstAtMs);
  const waterOn = (dayStart: number) => sumWater(byDay.get(dayStart) ?? []);

  const cellAt = (startMs: number): DayCell => {
    const state: DayState =
      startMs > today ? "future"
      : startMs === today ? "today"
      : firstDay === null || startMs < firstDay ? "nodata"
      : waterOn(startMs) >= goalMl ? "met"
      : "missed";
    const dayLogs = state === "future" || state === "nodata" ? [] : (byDay.get(startMs) ?? []);
    const d = new Date(startMs);
    return { startMs, day: d.getDate(), weekday: weekdayOf(startMs), state, waterMl: sumWater(dayLogs), logs: dayLogs };
  };

  const { startMs, endMs } = rangeOf(period, now);
  const cells: DayCell[] = [];
  for (let d = startMs; d < endMs; d = addDays(d, 1)) cells.push(cellAt(d));

  const completed = cells.filter((c) => c.state === "met" || c.state === "missed");
  const total = sumWater(completed.flatMap((c) => c.logs));
  const average = (sum: number, n: number) => (n ? Math.round(sum / n) : null);

  let streak = 0;
  if (firstDay !== null) {
    for (let d = addDays(today, -1); d >= firstDay && waterOn(d) >= goalMl; d = addDays(d, -1)) streak++;
  }
  if (waterOn(today) >= goalMl) streak++;

  const best = completed.reduce<DayCell | undefined>((a, c) => (!a || c.waterMl > a.waterMl ? c : a), undefined);

  const months: MonthCell[] = [];
  if (period.kind === "year") {
    for (let m = 0; m < 12; m++) {
      const inMonth = completed.filter((c) => new Date(c.startMs).getMonth() === m);
      const sum = sumWater(inMonth.flatMap((c) => c.logs));
      months.push({
        startMs: new Date(new Date(startMs).getFullYear(), m, 1).getTime(),
        month: m,
        avgMl: average(sum, inMonth.length),
        state: inMonth.length === 0 ? "nodata" : sum >= goalMl * inMonth.length ? "met" : "missed",
      });
    }
  }
  const bestMonth = months.reduce<MonthCell | undefined>((a, c) => (c.avgMl !== null && (!a || c.avgMl > a.avgMl!) ? c : a), undefined);

  const hourSums = new Array<number>(24).fill(0);
  for (const c of completed) for (const l of c.logs) hourSums[new Date(l.atMs).getHours()] += l.waterMl;

  const byType = new Map<number, number>();
  for (const c of cells) {
    if (c.state === "future" || c.state === "nodata") continue;
    for (const l of c.logs) byType.set(l.typeId, (byType.get(l.typeId) ?? 0) + l.waterMl);
  }
  const mixTotal = [...byType.values()].reduce((a, b) => a + b, 0);
  const mix = [...byType]
    .filter(([, waterMl]) => waterMl > 0)
    .map(([typeId, waterMl]) => ({ typeId, waterMl, share: waterMl / mixTotal }))
    .sort((a, b) => b.share - a.share || a.typeId - b.typeId);

  return {
    startMs,
    endMs,
    label: labelOf(period.kind, startMs, endMs, now),
    days: period.kind === "year" ? [] : cells,
    months,
    tiles: {
      avgMl: average(total, completed.length),
      metDays: completed.filter((c) => c.state === "met").length,
      countedDays: completed.length,
      bestDay: best && best.waterMl > 0 ? { startMs: best.startMs, waterMl: best.waterMl } : null,
      streak,
      bestMonth: bestMonth ? { month: bestMonth.month, avgMl: bestMonth.avgMl! } : null,
    },
    hours: hourSums.map((sum) => (completed.length ? sum / completed.length : 0)),
    mix,
  };
};
