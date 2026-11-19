import { createEffect, createMemo, createSignal, For, on, Show } from "solid-js";
import * as api from "./api";
import type { DrinkLog } from "./api";
import { ago, fmtMl, hhmm } from "./format";
import { type Day, dayLabel, earlierDays } from "./days";
import { CHART_BAR, CHEVRON_LEFT, CHEVRON_RIGHT, GEAR } from "./glyphs";
import { Glyph, Icon } from "./Icon";
import { PickerButton } from "./DrinkPicker";
import { History } from "./history-lazy";
import { Settings } from "./settings-lazy";
import {
  closeAllLayers,
  closeLayer,
  drink,
  now,
  layerOf,
  openLayer,
  permission,
  refreshReminderInfo,
  selectedVolumeId,
  setPick,
  setPermission,
  showToast,
  snap,
  status,
  tell,
} from "./store";

const s = () => snap()!;

const openHistory = () => {
  if (!layerOf("history")) openLayer({ kind: "history" });
};

/** Every log before today, grouped into days. Nothing fetches until the first tap on Earlier. */
const fetchEarlier = async () => {
  const todayStart = snap()!.dayStartMs;
  try {
    return earlierDays((await api.logsBetween(0, todayStart)).logs, todayStart);
  } catch (e) {
    showToast(String(e instanceof Error ? e.message : e));
  }
};

const LONG_PRESS_MS = 450;
const MOVE_SLOP_PX = 10;

export default function Main() {
  const total = createMemo(() => s().todayLogs.reduce((sum, l) => sum + l.waterMl, 0));
  const percent = () => Math.round((total() / s().settings.dailyGoalMl) * 100);
  const newestFirst = createMemo(() => [...s().todayLogs].sort((a, b) => b.atMs - a.atMs));
  const typeById = createMemo(() => new Map(s().types.map((t) => [t.id, t])));
  const volume = () => s().volumes.find((v) => v.id === selectedVolumeId());

  const [days, setDays] = createSignal<Day[]>([]);
  const [shown, setShown] = createSignal(0);
  const past = () => layerOf("pastDay");
  const shownIndex = () => days().findIndex((d) => d.startMs === shown());
  const rows = () => (past() ? (days()[shownIndex()]?.logs ?? []) : newestFirst());
  const older = () => days()[shownIndex() + 1];

  let loading = false;
  const openEarlier = async () => {
    if (loading) return;
    loading = true;
    const fetched = await fetchEarlier();
    loading = false;
    if (!fetched) return;
    if (!fetched.length) return showToast("No earlier drinks yet");
    setDays(fetched);
    setShown(fetched[0].startMs);
    openLayer({ kind: "pastDay" });
  };

  const goTo = (i: number) => (days()[i] ? setShown(days()[i].startMs) : closeLayer());

  // Edits and deletes change the snapshot, so the open view fetches again. If its day emptied out, it moves to the nearest day left.
  let fetchId = 0;
  createEffect(
    on(
      snap,
      async () => {
        if (!past()) return;
        const id = ++fetchId;
        const fetched = await fetchEarlier();
        if (!fetched || id !== fetchId || !past()) return;
        setDays(fetched);
        const gap = (d: Day) => Math.abs(d.startMs - shown());
        const near = fetched.reduce<Day | undefined>((best, d) => (!best || gap(d) < gap(best) ? d : best), undefined);
        if (!near) closeAllLayers();
        else if (gap(near)) setShown(near.startMs);
      },
      { defer: true },
    ),
  );

  const logDrink = async () => {
    if ((await drink()) && past()) closeAllLayers();
  };

  const pickLog = (l: DrinkLog) => {
    const t = typeById().get(l.typeId);
    const typeId = t && !t.archived ? t.id : undefined;
    const volumeId = s().volumes.find((v) => v.ml === l.ml)?.id;
    setPick((p) => ({
      typeId: typeId ?? p.typeId,
      volumeId: volumeId ?? p.volumeId,
    }));
    const misses = [
      volumeId === undefined && `No ${fmtMl(l.ml)} ml volume to select`,
      typeId === undefined && `${t?.label ?? "That drink"} is no longer a drink type`,
    ].filter(Boolean);
    if (misses.length) showToast(misses.join(", and "));
    else void api.haptic().catch(() => {});
  };

  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let pressX = 0;
  let pressY = 0;
  let swallowClick = false;
  const cancelPress = () => clearTimeout(pressTimer);
  const openEditor = (log: DrinkLog) => {
    cancelPress();
    if (layerOf("logEditor")?.log.id !== log.id) openLayer({ kind: "logEditor", log });
  };
  const pressStart = (e: PointerEvent, log: DrinkLog) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swallowClick = false;
    pressX = e.clientX;
    pressY = e.clientY;
    cancelPress();
    pressTimer = setTimeout(() => {
      swallowClick = true;
      void api.haptic().catch(() => {});
      openEditor(log);
    }, LONG_PRESS_MS);
  };
  const pressMove = (e: PointerEvent) => {
    if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > MOVE_SLOP_PX) cancelPress();
  };
  const rowClick = (l: DrinkLog) => {
    if (swallowClick) swallowClick = false;
    else pickLog(l);
  };

  const allowReminders = async () => {
    const before = permission();
    if (await tell(async () => setPermission(await api.requestNotificationPermission()))) {
      // Android stops showing the permission dialog after repeated denials, so only system settings can help.
      if (before === "denied" && permission() !== "granted") void tell(() => api.openSystemSettings("notifications"));
      void refreshReminderInfo();
    }
  };

  return (
    <main>
      <header>
        <h1>Today</h1>
        <div class="tools">
          <button class="icon-btn" aria-label="History" onPointerDown={() => void History.preload()} onClick={openHistory}>
            <Glyph path={CHART_BAR} />
          </button>
          <button
            class="icon-btn"
            aria-label="Settings"
            onPointerDown={() => void Settings.preload()}
            onClick={() => openLayer({ kind: "settings" })}
          >
            <Glyph path={GEAR} />
          </button>
        </div>
      </header>

      <section class="summary" onPointerDown={() => void History.preload()} onClick={openHistory}>
        <div class="ring" role="img" aria-label={`${percent()} percent of the daily goal`}>
          <svg viewBox="0 0 120 120">
            <circle class="track" cx="60" cy="60" r="52" />
            <circle
              class="bar"
              cx="60"
              cy="60"
              r="52"
              pathLength="100"
              style={{ "stroke-dashoffset": 100 - Math.min(percent(), 100) }}
            />
          </svg>
          <span>{percent()}%</span>
        </div>
        <p class="total">
          {fmtMl(total())} / {fmtMl(s().settings.dailyGoalMl)} ml
        </p>
        <p class="since">
          {s().lastDrinkAtMs === null ? "no drinks yet" : `last drink ${ago(s().lastDrinkAtMs!, now())}`}
        </p>
      </section>

      <Show when={permission() && permission() !== "granted"}>
        <div class="card">
          <span>Reminders need notification permission.</span>
          <button class="btn" onClick={allowReminders}>
            Allow reminders
          </button>
        </div>
      </Show>
      <Show when={status()?.missedReminderAtMs}>
        {(at) => (
          <div class="card warn">
            <span>The {hhmm(at())} reminder didn't arrive</span>
            <button class="btn" onClick={() => openLayer({ kind: "settings", focus: "reliability" })}>
              Fix
            </button>
          </div>
        )}
      </Show>

      <Show
        when={past()}
        fallback={
          <div class="daybar">
            <button class="earlier" onClick={() => void openEarlier()}>
              <Glyph path={CHEVRON_LEFT} />
              Earlier
            </button>
          </div>
        }
      >
        <div class="daybar on" role="group" aria-label="Earlier day">
          <button class="icon-btn" aria-label="Older day" disabled={!older()} onClick={() => goTo(shownIndex() + 1)}>
            <Glyph path={CHEVRON_LEFT} />
          </button>
          <strong>{dayLabel(shown(), s().dayStartMs)}</strong>
          <button class="icon-btn" aria-label="Newer day" onClick={() => goTo(shownIndex() - 1)}>
            <Glyph path={CHEVRON_RIGHT} />
          </button>
          <button class="earlier today" onClick={closeLayer}>
            Today
          </button>
        </div>
      </Show>

      <ul class="logs" classList={{ past: !!past() }}>
        <For each={rows()} fallback={<Show when={!past()}><li class="empty">No drinks yet today</li></Show>}>
          {(l) => (
            <li>
              <button
                onPointerDown={(e) => pressStart(e, l)}
                onPointerMove={pressMove}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onPointerLeave={cancelPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openEditor(l);
                }}
                onClick={() => rowClick(l)}
              >
                <time>{hhmm(l.atMs)}</time>
                <Icon name={typeById().get(l.typeId)?.icon ?? "droplet"} />
                <span class="what">{typeById().get(l.typeId)?.label}</span>
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

      <div class="dock">
        <PickerButton />
        <button class="drink" onClick={logDrink}>
          + DRINK {volume() ? `${fmtMl(volume()!.ml)} ml` : ""}
        </button>
      </div>
    </main>
  );
}
