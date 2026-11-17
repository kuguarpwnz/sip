// Development only: stands in for the Tauri host so the UI can run in a desktop browser.
// index.tsx imports it under `import.meta.env.DEV`, so it never reaches the release bundle.
import type { DrinkLog as LoggedDrink, DrinkType, PermissionState, ReminderStatus, Settings, Snapshot, Volume } from "../api";

const MIN = 60_000;
const DAY = 86_400_000;
const LATENCY_MS = 25;

const midnight = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** What the host stores. `waterMl` is computed from the type when a snapshot is read. */
type DrinkLog = Omit<LoggedDrink, "waterMl">;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const types: DrinkType[] = [
  { id: 1, label: "Water", icon: "droplet", position: 0, archived: false, waterPct: 100 },
  { id: 2, label: "Coffee", icon: "coffee", position: 1, archived: false, waterPct: 99 },
  { id: 3, label: "Tea", icon: "teapot", position: 2, archived: false, waterPct: 99 },
  { id: 4, label: "Juice", icon: "lemon-2", position: 3, archived: false, waterPct: 88 },
  { id: 5, label: "Milk", icon: "milk", position: 4, archived: false, waterPct: 88 },
];
const volumes: Volume[] = [
  { id: 1, ml: 150, label: "Espresso cup", icon: "cup", position: 0 },
  { id: 2, ml: 250, label: "Glass", icon: "glass", position: 1 },
  { id: 3, ml: 330, label: "", icon: "glass-full", position: 2 },
  { id: 4, ml: 500, label: "Bottle", icon: "bottle", position: 3 },
  { id: 5, ml: 750, label: "", icon: "bucket-droplet", position: 4 },
];
const settings: Settings = {
  dailyGoalMl: 2000,
  reminders: { enabled: true, intervalMin: 60, quietAfterDrinkMin: 60, activeFrom: "08:00", activeTo: "22:00", pauseWhenGoalMet: true },
  lastVolumeId: null,
  lastTypeId: null,
};
const status: ReminderStatus = {
  notificationsAllowed: true,
  channelEnabled: true,
  exactAlarmsAllowed: true,
  batteryUnrestricted: false,
  nextReminderAtMs: Date.now() + 40 * MIN,
  missedReminderAtMs: null,
};
let permission: PermissionState = "granted";

const seedLogs = (t0: number): DrinkLog[] => [
  { id: 1, atMs: t0 - 205 * MIN, ml: 330, typeId: 1 },
  { id: 2, atMs: t0 - 160 * MIN, ml: 150, typeId: 2 },
  { id: 3, atMs: t0 - 95 * MIN, ml: 500, typeId: 1 },
  { id: 4, atMs: t0 - 25 * MIN, ml: 250, typeId: 1 },
];
const logs: DrinkLog[] = seedLogs(Date.now());
let nextId = 100;

const pristine = clone({ types, volumes, settings, status });
const replace = <T>(target: T[], items: T[]) => target.splice(0, target.length, ...items);

/** Puts every table back to the seed data, as of `now`, so tests start from the same state. */
const reset = (now = Date.now()) => {
  const p = clone(pristine);
  replace(types, p.types);
  replace(volumes, p.volumes);
  replace(logs, seedLogs(now));
  Object.assign(settings, p.settings);
  Object.assign(status, p.status, { nextReminderAtMs: now + 40 * MIN });
  permission = "granted";
  nextId = 100;
  listeners.clear();
};

/** The newest log of any day, ties broken by the highest id, as the host's query orders it. */
const newestLog = () => logs.reduce<DrinkLog | undefined>((a, b) => (!a || b.atMs > a.atMs || (b.atMs === a.atMs && b.id > a.id) ? b : a), undefined);

const preset = () => {
  const active = types.filter((t) => !t.archived).sort((a, b) => a.position - b.position);
  const ordered = [...volumes].sort((a, b) => a.position - b.position);
  const newest = newestLog();
  return {
    lastTypeId: (active.find((t) => t.id === newest?.typeId) ?? active[0])?.id ?? null,
    lastVolumeId: (ordered.find((v) => v.ml === newest?.ml) ?? ordered[0])?.id ?? null,
  };
};

const snapshot = (): Snapshot => {
  const today = logs.filter((l) => l.atMs >= midnight()).sort((a, b) => a.atMs - b.atMs || a.id - b.id);
  return clone({
    settings: { ...settings, ...preset() },
    types: [...types].sort((a, b) => a.position - b.position),
    volumes: [...volumes].sort((a, b) => a.position - b.position),
    todayLogs: today.map((l) => ({ ...l, waterMl: Math.round((l.ml * (types.find((t) => t.id === l.typeId)?.waterPct ?? 100)) / 100) })),
    dayStartMs: midnight(),
    lastDrinkAtMs: newestLog()?.atMs ?? null,
  });
};

const fail = (msg: string): never => {
  throw msg;
};
const label = (s: unknown) => {
  const v = String(s ?? "").trim();
  return v.length >= 1 && v.length <= 24 ? v : fail("Label must be 1 to 24 characters");
};
const range = (v: number, lo: number, hi: number, what: string) =>
  Number.isInteger(v) && v >= lo && v <= hi ? v : fail(`${what} must be ${lo} to ${hi}`);
const activeTypes = () => types.filter((t) => !t.archived);
const reorder = <T extends { id: number; position: number }>(list: T[], ids: number[]) => {
  if (ids.length !== list.length || !list.every((i) => ids.includes(i.id))) fail("Reorder needs every id");
  ids.forEach((id, position) => (list.find((i) => i.id === id)!.position = position));
};

type Args = Record<string, any>;
const commands: Record<string, (a: Args) => unknown> = {
  snapshot: () => snapshot(),
  log_drink: ({ volumeId, typeId }) => {
    const v = volumes.find((x) => x.id === volumeId) ?? fail("Unknown volume");
    logs.push({ id: nextId++, atMs: Date.now(), ml: v.ml, typeId });
    return snapshot();
  },
  add_log: ({ atMs, ml, typeId }) => {
    logs.push({ id: nextId++, atMs, ml, typeId });
    return snapshot();
  },
  update_log: ({ id, atMs, ml, typeId }) => {
    const l = logs.find((x) => x.id === id) ?? fail("Unknown log");
    if (atMs > Date.now() + MIN) fail("A drink can't be in the future");
    Object.assign(l, { atMs, ml: range(ml, 1, 5000, "Amount"), typeId });
    return snapshot();
  },
  delete_log: ({ id }) => {
    logs.splice(logs.findIndex((l) => l.id === id), 1);
    return snapshot();
  },
  save_volume: ({ id, ml, label: text, icon }) => {
    range(ml, 10, 3000, "Volume");
    if (String(text ?? "").length > 24) fail("Label must be 1 to 24 characters");
    const row = id === undefined ? undefined : (volumes.find((v) => v.id === id) ?? fail("Unknown volume"));
    if (row) Object.assign(row, { ml, label: text, icon });
    else volumes.push({ id: nextId++, ml, label: text, icon, position: volumes.length });
    return snapshot();
  },
  delete_volume: ({ id }) => {
    if (volumes.length <= 1) fail("Keep at least one volume");
    volumes.splice(volumes.findIndex((v) => v.id === id), 1);
    return snapshot();
  },
  reorder_volumes: ({ ids }) => {
    reorder(volumes, ids);
    return snapshot();
  },
  save_type: ({ id, label: text, icon, waterPct }) => {
    const name = label(text);
    if (!Number.isInteger(waterPct) || waterPct < 0 || waterPct > 100) fail("Water content must be between 0 and 100%");
    const row = id === undefined ? undefined : (types.find((t) => t.id === id) ?? fail("Unknown drink type"));
    if (row) Object.assign(row, { label: name, icon, waterPct });
    else types.push({ id: nextId++, label: name, icon, position: types.length, archived: false, waterPct });
    return snapshot();
  },
  delete_type: ({ id }) => {
    if (activeTypes().length <= 1) fail("Keep at least one drink type");
    (types.find((t) => t.id === id) ?? fail("Unknown drink type")).archived = true;
    return snapshot();
  },
  reorder_types: ({ ids }) => {
    reorder(types.filter((t) => !t.archived), ids.filter((i: number) => activeTypes().some((t) => t.id === i)));
    return snapshot();
  },
  save_settings: ({ dailyGoalMl, reminders }) => {
    const next = { ...settings.reminders, ...reminders };
    if (dailyGoalMl !== undefined) settings.dailyGoalMl = range(dailyGoalMl, 500, 6000, "Goal");
    range(next.intervalMin, 15, 240, "Interval");
    range(next.quietAfterDrinkMin, 0, 240, "Quiet time");
    if (next.activeFrom >= next.activeTo) fail("Active from must be before active until");
    settings.reminders = next;
    return snapshot();
  },
  reminder_status: () => clone(status),
  open_system_settings: ({ target }) => {
    console.info("[fake] open system settings", target);
    if (target === "notifications") Object.assign(status, { notificationsAllowed: true, channelEnabled: true });
    if (target === "exactAlarms") status.exactAlarmsAllowed = true;
    if (target === "battery") status.batteryUnrestricted = true;
  },
  send_test_reminder: () => undefined,
  haptic: () => undefined,
  fully_drawn: () => undefined,
  check_permissions: () => ({ notifications: permission }),
  request_permissions: () => {
    permission = "granted";
    return { notifications: permission };
  },
  register_listener: ({ handler }) => {
    listeners.add(handler.id);
  },
  remove_listener: ({ channelId }) => {
    listeners.delete(channelId);
  },
};

const listeners = new Set<number>();
let callbackId = 1;
let messageIndex = 0;

const emitChanged = () => {
  for (const id of listeners) (window as any)[`_${id}`]({ index: messageIndex++, message: snapshot() });
};

Object.assign(window, {
  __TAURI_INTERNALS__: {
    invoke: (cmd: string, args: Args = {}) =>
      new Promise((resolve, reject) =>
        setTimeout(() => {
          try {
            const handler = commands[cmd.replace(/^plugin:sip\|/, "")] ?? fail(`Unknown command ${cmd}`);
            resolve(handler(args));
          } catch (e) {
            reject(e);
          }
        }, LATENCY_MS),
      ),
    transformCallback: (cb: (v: unknown) => void) => {
      const id = callbackId++;
      (window as any)[`_${id}`] = cb;
      return id;
    },
    unregisterCallback: (id: number) => delete (window as any)[`_${id}`],
  },
  // Test hooks for the browser console: simulate what the phone does on its own.
  __sipFake: {
    emitChanged: () => {
      logs.push({ id: nextId++, atMs: Date.now(), ml: 250, typeId: 1 });
      emitChanged();
    },
    missedReminder: (at = Date.now() - 20 * MIN) => (status.missedReminderAtMs = at),
    denyNotifications: () => {
      permission = "denied";
      Object.assign(status, { notificationsAllowed: false });
    },
    reset,
    rollDay: () => logs.forEach((l) => (l.atMs -= DAY)),
  },
});
