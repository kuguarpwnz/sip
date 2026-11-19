import type { DrinkLog } from "./api";
import { dayTitle } from "./format";

export interface Day { startMs: number; logs: DrinkLog[] }

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** The non-empty local days before `todayStartMs`, newest day first, each with its logs newest first. */
export const earlierDays = (logs: DrinkLog[], todayStartMs: number): Day[] => {
  const byDay = new Map<number, DrinkLog[]>();
  for (const l of logs) {
    if (l.atMs >= todayStartMs) continue;
    const start = startOfDay(l.atMs);
    byDay.set(start, [...(byDay.get(start) ?? []), l]);
  }
  return [...byDay]
    .sort(([a], [b]) => b - a)
    .map(([startMs, dayLogs]) => ({ startMs, logs: dayLogs.sort((a, b) => b.atMs - a.atMs || b.id - a.id) }));
};

export const dayLabel = (startMs: number, todayStartMs: number) => {
  const t = new Date(todayStartMs);
  const yesterday = new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1).getTime();
  return startMs === yesterday ? "Yesterday" : dayTitle(startMs);
};
