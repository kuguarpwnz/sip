import { createMemo, createResource, createSignal, For, Show, type JSX } from "solid-js";
import "./screen.css";
import "./history.css";
import * as api from "./api";
import { dayTitle, fmtMl, hhmm } from "./format";
import { BACK, CHEVRON_LEFT, CHEVRON_RIGHT } from "./glyphs";
import {
  dayEntries,
  endOfDay,
  historyStats,
  MONTHS,
  WEEKDAYS,
  type DayCell,
  type HistoryStats,
  type MonthCell,
  type PeriodKind,
} from "./history-stats";
import { Glyph, Icon } from "./Icon";
import { Sheet } from "./Sheet";
import { closeLayer, layerOf, now, openLayer, showToast, snap } from "./store";


const KINDS: { kind: PeriodKind; label: string }[] = [
  { kind: "week", label: "Week" },
  { kind: "month", label: "Month" },
  { kind: "year", label: "Year" },
];

const HOUR_LABELS = [0, 6, 12, 18, 23];
const BAR_HEADROOM = 1.15;
const MONTH_INITIALS = "JFMAMJJASOND";
const WEEKDAY_INITIALS = "MTWTFSS";

const dash = (n: number | null, unit = "") => (n === null ? "–" : `${fmtMl(n)}${unit}`);

const dayLabel = (d: DayCell) => {
  const title = dayTitle(d.startMs);
  if (d.state === "nodata") return `${title}, no data`;
  if (d.state === "future") return `${title}, to come`;
  if (d.state === "today") return `${title}, ${fmtMl(d.waterMl)} ml, today`;
  return `${title}, ${fmtMl(d.waterMl)} ml, goal ${d.state}`;
};

const monthLabel = (m: MonthCell) =>
  m.avgMl === null ? `${MONTHS[m.month]}, no data` : `${MONTHS[m.month]}, ${fmtMl(m.avgMl)} ml a day, goal ${m.state}`;

const percentLabel = (share: number) => (share > 0 && share < 0.005 ? "<1%" : `${Math.round(share * 100)}%`);

const Tile = (p: { value: string; label: string }) => (
  <div class="tile">
    <strong>{p.value}</strong>
    <span>{p.label}</span>
  </div>
);

const Tiles = (p: { stats: HistoryStats }) => {
  const t = () => p.stats.tiles;
  const kind = () => p.stats.kind;
  const third = () => {
    if (kind() === "month") return { value: `${t().streak} ${t().streak === 1 ? "day" : "days"}`, label: "in a row" };
    if (kind() === "year") {
      const best = t().bestMonth;
      return { value: dash(best && best.avgMl, " ml"), label: best ? `best, ${MONTHS[best.month]}` : "best month" };
    }
    const best = t().bestDay;
    return { value: dash(best && best.waterMl, " ml"), label: best ? `best, ${WEEKDAYS[(new Date(best.startMs).getDay() + 6) % 7]}` : "best day" };
  };
  return (
    <div class="tiles">
      <Tile value={dash(t().avgMl, " ml")} label="a day" />
      <Tile value={`${t().metDays} of ${t().countedDays}`} label="goal met" />
      <Tile value={third().value} label={third().label} />
    </div>
  );
};

const openDay = (startMs: number) => openLayer({ kind: "historyDay", startMs });

const WeekChart = (p: { days: DayCell[]; goal: number }) => {
  const max = () => Math.max(p.goal * BAR_HEADROOM, ...p.days.map((d) => d.waterMl));
  return (
    <div class="chart">
      <div class="plot">
        <div class="goal" style={{ bottom: `${(p.goal / max()) * 100}%` }}>
          <span>{fmtMl(p.goal)}</span>
        </div>
        <For each={p.days}>
          {(d) => (
            <Show
              when={d.state !== "nodata" && d.state !== "future"}
              fallback={
                <div class="slot" role="img" aria-label={dayLabel(d)}>
                  <i class={`bar ${d.state}`} />
                </div>
              }
            >
              <button class="slot" aria-label={dayLabel(d)} onClick={() => openDay(d.startMs)}>
                <i class={`bar ${d.state}`} style={{ height: `${(d.waterMl / max()) * 100}%` }} />
              </button>
            </Show>
          )}
        </For>
      </div>
      <div class="axis">
        <For each={p.days}>{(d) => <span classList={{ now: d.state === "today" }}>{WEEKDAYS[d.weekday]}</span>}</For>
      </div>
    </div>
  );
};

const MonthGrid = (p: { days: DayCell[] }) => (
  <div class="cal">
    <For each={[...WEEKDAY_INITIALS]}>{(c) => <span class="dow" aria-hidden="true">{c}</span>}</For>
    <For each={Array.from({ length: p.days[0].weekday })}>{() => <span />}</For>
    <For each={p.days}>
      {(d) => (
        <Show
          when={d.state !== "nodata" && d.state !== "future"}
          fallback={
            <span class={`cell ${d.state}`} role="img" aria-label={dayLabel(d)}>
              {d.day}
            </span>
          }
        >
          <button class={`cell ${d.state}`} aria-label={dayLabel(d)} onClick={() => openDay(d.startMs)}>
            {d.day}
          </button>
        </Show>
      )}
    </For>
  </div>
);

const YearChart = (p: { months: MonthCell[]; goal: number }) => {
  const max = () => Math.max(p.goal * BAR_HEADROOM, ...p.months.map((m) => m.avgMl ?? 0));
  return (
    <div class="chart">
      <div class="plot">
        <div class="goal" style={{ bottom: `${(p.goal / max()) * 100}%` }}>
          <span>{fmtMl(p.goal)}</span>
        </div>
        <For each={p.months}>
          {(m) => (
            <div class="slot" role="img" aria-label={monthLabel(m)}>
              <i class={`bar ${m.state}`} style={{ height: m.avgMl === null ? undefined : `${(m.avgMl / max()) * 100}%` }} />
            </div>
          )}
        </For>
      </div>
      <div class="axis year" aria-hidden="true">
        <For each={p.months}>{(m) => <span>{MONTH_INITIALS[m.month]}</span>}</For>
      </div>
    </div>
  );
};

const Hours = (p: { hours: number[] }) => {
  const max = () => Math.max(...p.hours);
  return (
    <div role="img" aria-label="Average water by hour of the day">
      <div class="hours">
        <For each={p.hours}>
          {(h) => <i classList={{ zero: h === 0 }} style={{ height: h === 0 ? undefined : `${(h / max()) * 100}%` }} />}
        </For>
      </div>
      <div class="hours-axis">
        <For each={HOUR_LABELS}>
          {(h) => (
            <span style={{ left: `${((h + 0.5) / 24) * 100}%` }}>{String(h).padStart(2, "0")}</span>
          )}
        </For>
      </div>
    </div>
  );
};

const Mix = (p: { mix: HistoryStats["mix"] }) => {
  const typeOf = (id: number) => snap()?.types.find((t) => t.id === id);
  return (
    <Show when={p.mix.length} fallback={<p class="none">No drinks in this period</p>}>
      <ul class="mix">
        <For each={p.mix}>
          {(m) => (
            <li>
              <Icon name={typeOf(m.typeId)?.icon ?? "droplet"} />
              <span class="what">{typeOf(m.typeId)?.label}</span>
              <span class="track">
                <i style={{ width: `${m.share * 100}%` }} />
              </span>
              <span class="pct">{percentLabel(m.share)}</span>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );
};

const Group = (p: { title: string; children: JSX.Element }) => (
  <section class="group">
    <h2>{p.title}</h2>
    <div class="panel pad">{p.children}</div>
  </section>
);

const DaySheet = (p: { startMs: number; logs: api.DrinkLog[]; goal: number }) => {
  const day = () => dayEntries(p.logs, p.startMs);
  const typeOf = (id: number) => snap()?.types.find((t) => t.id === id);
  return (
    <Sheet title={dayTitle(p.startMs)}>
      <p class="day-total">
        {fmtMl(day().waterMl)} ml, {Math.round((day().waterMl / p.goal) * 100)}%
      </p>
      <ul class="logs">
        <For each={day().logs} fallback={<li class="empty">No drinks this day</li>}>
          {(l) => (
            <li>
              <button onClick={() => openLayer({ kind: "logEditor", log: l })}>
                <time>{hhmm(l.atMs)}</time>
                <Icon name={typeOf(l.typeId)?.icon ?? "droplet"} />
                <span class="what">{typeOf(l.typeId)?.label}</span>
                <span class="ml">
                  {fmtMl(l.ml)} ml
                  <Show when={l.waterMl !== l.ml}>
                    <small>{fmtMl(l.waterMl)} ml water</small>
                  </Show>
                </span>
              </button>
            </li>
          )}
        </For>
      </ul>
    </Sheet>
  );
};

/** One fetch of every log, redone whenever the snapshot changes. A failed refetch keeps what was shown. */
const fetchLogs = async (_: api.Snapshot, info: { value: api.LogRange | undefined }): Promise<api.LogRange> => {
  try {
    return await api.logsBetween(0, endOfDay(Date.now()));
  } catch (e) {
    showToast(e instanceof Error ? e.message : String(e));
    return info.value ?? { logs: [], firstAtMs: null };
  }
};

export default function History() {
  const [kind, setKind] = createSignal<PeriodKind>("week");
  const [offset, setOffset] = createSignal(0);
  const [data] = createResource(snap, fetchLogs);
  const goal = () => snap()!.settings.dailyGoalMl;

  const stats = createMemo(() => {
    const d = data.latest;
    return d ? historyStats(d.logs, d.firstAtMs, goal(), now(), { kind: kind(), offset: offset() }) : undefined;
  });

  const pick = (k: PeriodKind) => {
    setKind(k);
    setOffset(0);
  };

  return (
    <>
      <div class="screen history">
        <header>
          <button class="icon-btn" aria-label="Back" onClick={closeLayer}>
            <Glyph path={BACK} />
          </button>
          <h1>History</h1>
        </header>

        <div class="controls">
          <div class="seg" role="radiogroup" aria-label="Period">
            <For each={KINDS}>
              {(k) => (
                <button role="radio" aria-checked={kind() === k.kind} onClick={() => pick(k.kind)}>
                  {k.label}
                </button>
              )}
            </For>
          </div>
          <div class="nav">
            <button class="icon-btn" aria-label={`Previous ${kind()}`} onClick={() => setOffset((o) => o - 1)}>
              <Glyph path={CHEVRON_LEFT} />
            </button>
            <span class="period" aria-live="polite">
              {stats()?.label}
            </span>
            <button class="icon-btn" aria-label={`Next ${kind()}`} disabled={offset() === 0} onClick={() => setOffset((o) => o + 1)}>
              <Glyph path={CHEVRON_RIGHT} />
            </button>
          </div>
        </div>

        <div class="body">
          <Show when={stats()}>
            {(s) => (
              <>
                <Tiles stats={s()} />
                <div class="panel pad">
                  <Show when={s().kind === "week"}>
                    <WeekChart days={s().days} goal={goal()} />
                  </Show>
                  <Show when={s().kind === "month"}>
                    <MonthGrid days={s().days} />
                  </Show>
                  <Show when={s().kind === "year"}>
                    <YearChart months={s().months} goal={goal()} />
                  </Show>
                </div>
                <Group title="When you drink">
                  <Hours hours={s().hours} />
                </Group>
                <Group title="Drink mix">
                  <Mix mix={s().mix} />
                </Group>
              </>
            )}
          </Show>
        </div>
      </div>

      <Show when={layerOf("historyDay")}>
        {(l) => <DaySheet startMs={l().startMs} logs={data.latest?.logs ?? []} goal={goal()} />}
      </Show>
    </>
  );
}
