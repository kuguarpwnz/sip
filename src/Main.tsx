import { createEffect, createMemo, For, on, onMount, Show, type JSX } from "solid-js";
import * as api from "./api";
import type { DrinkLog } from "./api";
import { ago, fmtMl, hhmm } from "./format";
import { GEAR } from "./glyphs";
import { Glyph, Icon } from "./Icon";
import { PickerButton, pickFromList } from "./PickerList";
import { Settings } from "./settings-lazy";
import {
  drink,
  now,
  layerOf,
  openLayer,
  permission,
  refreshReminderInfo,
  selectedTypeId,
  selectedVolumeId,
  setPick,
  setPermission,
  showToast,
  snap,
  status,
  tell,
} from "./store";

const s = () => snap()!;

const LONG_PRESS_MS = 450;
const MOVE_SLOP_PX = 10;

const ChipRow = (p: { label: string; selected: number | undefined; children: JSX.Element }) => {
  let el!: HTMLDivElement;
  onMount(() => el.querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" }));
  createEffect(
    on(
      () => p.selected,
      () => el.querySelector(".on")?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" }),
      { defer: true },
    ),
  );
  return (
    <div class="chips" role="radiogroup" aria-label={p.label} ref={el}>
      {p.children}
    </div>
  );
};

export default function Main() {
  const total = createMemo(() => s().todayLogs.reduce((sum, l) => sum + l.ml, 0));
  const percent = () => Math.round((total() / s().settings.dailyGoalMl) * 100);
  const newestFirst = createMemo(() => [...s().todayLogs].sort((a, b) => b.atMs - a.atMs));
  const typeById = createMemo(() => new Map(s().types.map((t) => [t.id, t])));
  const volume = () => s().volumes.find((v) => v.id === selectedVolumeId());

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
  const openEditor = (logId: number) => {
    cancelPress();
    if (layerOf("logEditor")?.logId !== logId) openLayer({ kind: "logEditor", logId });
  };
  const pressStart = (e: PointerEvent, logId: number) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swallowClick = false;
    pressX = e.clientX;
    pressY = e.clientY;
    cancelPress();
    pressTimer = setTimeout(() => {
      swallowClick = true;
      void api.haptic().catch(() => {});
      openEditor(logId);
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
        <button
          class="icon-btn"
          aria-label="Settings"
          onPointerDown={() => void Settings.preload()}
          onClick={() => openLayer({ kind: "settings" })}
        >
          <Glyph path={GEAR} />
        </button>
      </header>

      <section class="summary">
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

      <ul class="logs">
        <For each={newestFirst()} fallback={<li class="empty">No drinks yet today</li>}>
          {(l) => (
            <li>
              <button
                onPointerDown={(e) => pressStart(e, l.id)}
                onPointerMove={pressMove}
                onPointerUp={cancelPress}
                onPointerCancel={cancelPress}
                onPointerLeave={cancelPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openEditor(l.id);
                }}
                onClick={() => rowClick(l)}
              >
                <time>{hhmm(l.atMs)}</time>
                <Icon name={typeById().get(l.typeId)?.icon ?? "droplet"} />
                <span class="what">{typeById().get(l.typeId)?.label}</span>
                <span class="ml">{fmtMl(l.ml)} ml</span>
              </button>
            </li>
          )}
        </For>
      </ul>

      <div class="dock">
        <Show
          when={pickFromList()}
          fallback={
            <>
              <ChipRow label="Drink type" selected={selectedTypeId()}>
                <For each={s().types.filter((t) => !t.archived)}>
                  {(t) => (
                    <button
                      role="radio"
                      aria-checked={t.id === selectedTypeId()}
                      classList={{ on: t.id === selectedTypeId() }}
                      onClick={() => setPick((p) => ({ ...p, typeId: t.id }))}
                    >
                      <Icon name={t.icon} />
                      {t.label}
                    </button>
                  )}
                </For>
              </ChipRow>
              <ChipRow label="Volume" selected={selectedVolumeId()}>
                <For each={s().volumes}>
                  {(v) => (
                    <button
                      role="radio"
                      aria-checked={v.id === selectedVolumeId()}
                      classList={{ on: v.id === selectedVolumeId() }}
                      onClick={() => setPick((p) => ({ ...p, volumeId: v.id }))}
                    >
                      <Icon name={v.icon} />
                      {fmtMl(v.ml)} ml
                    </button>
                  )}
                </For>
              </ChipRow>
            </>
          }
        >
          <PickerButton />
        </Show>
        <button class="drink" onClick={drink}>
          + DRINK {volume() ? `${fmtMl(volume()!.ml)} ml` : ""}
        </button>
      </div>
    </main>
  );
}
