import { For, onMount, Show, type JSX } from "solid-js";
import "./settings.css";
import * as api from "./api";
import { whenLabel } from "./format";
import { BACK } from "./glyphs";
import { Glyph } from "./Icon";
import ItemSheet from "./ItemSheet";
import { ListEditor } from "./ListEditor";
import {
  closeLayer,
  layerOf,
  now,
  openLayer,
  refreshReminderInfo,
  run,
  showToast,
  snap,
  status,
  tell,
} from "./store";

const save = async (patch: api.SettingsPatch) => {
  const next = await run(() => api.saveSettings(patch));
  if (next) void refreshReminderInfo();
  return next;
};
const patchReminders = (reminders: Partial<api.ReminderSettings>) => save({ reminders });

const Row = (p: { label: string; hint?: string; children: JSX.Element }) => (
  <label class="row">
    <span class="label">
      {p.label}
      <Show when={p.hint}>
        <small>{p.hint}</small>
      </Show>
    </span>
    {p.children}
  </label>
);

const NumberRow = (p: {
  label: string;
  hint: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  onCommit: (n: number) => Promise<unknown>;
}) => (
  <Row label={p.label} hint={p.hint}>
    <span class="unit">
      <input
        type="number"
        inputmode="numeric"
        min={p.min}
        max={p.max}
        value={p.value}
        onChange={async (e) => {
          const el = e.currentTarget;
          const n = Math.round(Number(el.value));
          if (!el.value || !Number.isFinite(n) || n === p.value || !(await p.onCommit(n))) el.value = String(p.value);
        }}
      />
      {p.unit}
    </span>
  </Row>
);

const TimeRow = (p: { label: string; value: string; onCommit: (v: string) => Promise<unknown> }) => (
  <Row label={p.label}>
    <input
      type="time"
      value={p.value}
      onChange={async (e) => {
        const el = e.currentTarget;
        if (!el.value || el.value === p.value || !(await p.onCommit(el.value))) el.value = p.value;
      }}
    />
  </Row>
);

const ToggleRow = (p: { label: string; checked: boolean; onCommit: (v: boolean) => Promise<unknown> }) => (
  <Row label={p.label}>
    <input
      class="switch"
      type="checkbox"
      role="switch"
      checked={p.checked}
      onChange={async (e) => {
        const el = e.currentTarget;
        if (!(await p.onCommit(el.checked))) el.checked = p.checked;
      }}
    />
  </Row>
);

export default function Settings(p: { focus?: "reliability" }) {
  const s = () => snap()!;
  const r = () => s().settings.reminders;
  let reliability!: HTMLElement;

  const checks = (): { label: string; ok?: boolean; target: api.SettingsTarget }[] => [
    { label: "Notifications allowed", ok: status()?.notificationsAllowed, target: "notifications" },
    { label: "Reminder channel not muted", ok: status()?.channelEnabled, target: "notifications" },
    { label: "Exact alarms allowed", ok: status()?.exactAlarmsAllowed, target: "exactAlarms" },
    { label: "Battery usage unrestricted", ok: status()?.batteryUnrestricted, target: "battery" },
  ];

  const testReminder = async () => {
    if (await tell(() => api.sendTestReminder())) showToast("Test reminder arrives in about a minute");
  };

  onMount(() => {
    void refreshReminderInfo();
    if (p.focus === "reliability") reliability.scrollIntoView({ block: "start" });
  });

  return (
    <>
      <div class="screen">
        <header>
          <button class="icon-btn" aria-label="Back" onClick={closeLayer}>
            <Glyph path={BACK} />
          </button>
          <h1>Settings</h1>
        </header>
        <div class="body">
          <section class="group">
            <h2>Daily goal</h2>
            <div class="panel">
              <NumberRow
                label="Goal"
                hint="500 to 6000"
                unit="ml"
                min={500}
                max={6000}
                value={s().settings.dailyGoalMl}
                onCommit={(n) => save({ dailyGoalMl: n })}
              />
            </div>
          </section>

          <ListEditor
            title="Volumes"
            items={s().volumes}
            primary={(v) => `${v.ml} ml`}
            secondary={(v) => v.label}
            addLabel="Add volume"
            onReorder={(ids) => run(() => api.reorderVolumes(ids))}
            onEdit={(id) => openLayer({ kind: "volumeEditor", id })}
            onDelete={(id) => run(() => api.deleteVolume(id))}
            onAdd={() => openLayer({ kind: "volumeEditor", id: null })}
          />

          <ListEditor
            title="Drink types"
            items={s().types.filter((t) => !t.archived)}
            primary={(t) => t.label}
            secondary={(t) => (t.waterPct < 100 ? `${t.waterPct}% water` : "")}
            addLabel="Add drink type"
            onReorder={(ids) => run(() => api.reorderTypes(ids))}
            onEdit={(id) => openLayer({ kind: "typeEditor", id })}
            onDelete={(id) => run(() => api.deleteType(id))}
            onAdd={() => openLayer({ kind: "typeEditor", id: null })}
          />

          <section class="group">
            <h2>Reminders</h2>
            <div class="panel">
              <ToggleRow label="Remind me" checked={r().enabled} onCommit={(enabled) => patchReminders({ enabled })} />
              <NumberRow
                label="Every"
                hint="15 to 240"
                unit="min"
                min={15}
                max={240}
                value={r().intervalMin}
                onCommit={(intervalMin) => patchReminders({ intervalMin })}
              />
              <NumberRow
                label="Quiet after a drink"
                hint="0 to 240"
                unit="min"
                min={0}
                max={240}
                value={r().quietAfterDrinkMin}
                onCommit={(quietAfterDrinkMin) => patchReminders({ quietAfterDrinkMin })}
              />
              <TimeRow label="Active from" value={r().activeFrom} onCommit={(activeFrom) => patchReminders({ activeFrom })} />
              <TimeRow label="Active until" value={r().activeTo} onCommit={(activeTo) => patchReminders({ activeTo })} />
              <ToggleRow
                label="Pause when the goal is met"
                checked={r().pauseWhenGoalMet}
                onCommit={(pauseWhenGoalMet) => patchReminders({ pauseWhenGoalMet })}
              />
            </div>
          </section>

          <section class="group" ref={reliability}>
            <h2>Reliability</h2>
            <div class="panel">
              <For each={checks()}>
                {(c) => (
                  <div class="row">
                    <span class="label">{c.label}</span>
                    <Show when={c.ok !== undefined} fallback={<span class="badge">…</span>}>
                      <Show when={!c.ok} fallback={<span class="badge ok">OK</span>}>
                        <button class="btn fix" onClick={() => void tell(() => api.openSystemSettings(c.target))}>
                          Fix
                        </button>
                      </Show>
                    </Show>
                  </div>
                )}
              </For>
              <div class="row">
                <span class="label">
                  Next reminder
                  <small>
                    {status() === undefined
                      ? "…"
                      : status()!.nextReminderAtMs === null
                        ? "none scheduled"
                        : whenLabel(status()!.nextReminderAtMs!, now())}
                  </small>
                </span>
                <button class="btn" onClick={testReminder}>
                  Send test reminder
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Show when={layerOf("volumeEditor")}>{(l) => <ItemSheet kind="volume" id={l().id} />}</Show>
      <Show when={layerOf("typeEditor")}>{(l) => <ItemSheet kind="type" id={l().id} />}</Show>
    </>
  );
}
