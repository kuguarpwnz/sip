import { createMemo, For, onMount, Show, type JSX } from "solid-js";
import * as api from "./api";
import { ago, fmtMl, hhmm } from "./format";
import { GEAR } from "./glyphs";
import { Glyph, Icon } from "./Icon";
import { Settings } from "./settings-lazy";
import {
  now,
  openLayer,
  permission,
  refreshReminderInfo,
  run,
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

const ChipRow = (p: { label: string; children: JSX.Element }) => {
  let el!: HTMLDivElement;
  onMount(() => el.querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" }));
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
  const type = () => typeById().get(selectedTypeId() ?? -1);

  const drink = async () => {
    const v = volume();
    const t = type();
    if (!v || !t) return;
    const next = await run(() => api.logDrink(v.id, t.id));
    if (!next) return;
    void api.haptic().catch(() => {});
    const newest = next.todayLogs.reduce((a, b) => (b.id > a.id ? b : a));
    showToast(`Logged ${v.ml} ml ${t.label}`, () => void run(() => api.deleteLog(newest.id)));
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
              <button onClick={() => openLayer({ kind: "logEditor", logId: l.id })}>
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
        <ChipRow label="Drink type">
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
        <ChipRow label="Volume">
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
        <button class="drink" onClick={drink}>
          + DRINK {volume() ? `${fmtMl(volume()!.ml)} ml` : ""}
        </button>
      </div>
    </main>
  );
}
