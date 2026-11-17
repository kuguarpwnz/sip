import { batch, createSignal } from "solid-js";
import * as api from "./api";

export type Layer =
  | { kind: "settings"; focus?: "reliability" }
  | { kind: "logEditor"; logId: number }
  | { kind: "volumeEditor"; id: number | null }
  | { kind: "typeEditor"; id: number | null }
  | { kind: "picker" };

export interface Toast {
  text: string;
  undo?: () => void;
}

/** The only copy of app data. Every command result and every `changed` event replaces it whole. */
export const [snap, setSnap] = createSignal<api.Snapshot>();
export const [status, setStatus] = createSignal<api.ReminderStatus>();
export const [permission, setPermission] = createSignal<api.PermissionState>();

export const [layers, setLayers] = createSignal<Layer[]>([]);
export const [toast, setToast] = createSignal<Toast>();
export const [now, setNow] = createSignal(Date.now());
export const [pick, setPick] = createSignal<{ typeId?: number; volumeId?: number }>({});

export const layerOf = <K extends Layer["kind"]>(kind: K) =>
  layers().find((l): l is Extract<Layer, { kind: K }> => l.kind === kind);

const TOAST_MS = 4000;
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const showToast = (text: string, undo?: () => void) => {
  clearTimeout(toastTimer);
  setToast({ text, undo });
  toastTimer = setTimeout(() => setToast(undefined), TOAST_MS);
};

export const dismissToast = () => {
  clearTimeout(toastTimer);
  setToast(undefined);
};

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// Commands run one at a time so a slow reply can never overwrite a newer snapshot.
let queue: Promise<unknown> = Promise.resolve();

export const run = (cmd: () => Promise<api.Snapshot>): Promise<api.Snapshot | undefined> => {
  const result = queue.then(cmd).then(
    (s) => {
      setSnap(s);
      return s;
    },
    (e) => {
      showToast(message(e));
      return undefined;
    },
  );
  queue = result;
  return result;
};

export const refresh = () => run(api.snapshot);

export const tell = async (cmd: () => Promise<unknown>) => {
  try {
    await cmd();
    return true;
  } catch (e) {
    showToast(message(e));
    return false;
  }
};

export const refreshReminderInfo = async () => {
  try {
    const [s, p] = await Promise.all([api.reminderStatus(), api.checkNotificationPermission()]);
    batch(() => {
      setStatus(s);
      setPermission(p);
    });
  } catch (e) {
    showToast(message(e));
  }
};

export const selectedTypeId = () => {
  const s = snap();
  if (!s) return undefined;
  const active = s.types.filter((t) => !t.archived);
  const want = pick().typeId ?? s.settings.lastTypeId;
  return (active.find((t) => t.id === want) ?? active[0])?.id;
};

export const selectedVolumeId = () => {
  const s = snap();
  if (!s) return undefined;
  const want = pick().volumeId ?? s.settings.lastVolumeId;
  return (s.volumes.find((v) => v.id === want) ?? s.volumes[0])?.id;
};

// Each layer owns one history entry, so the Android back button pops a layer instead of leaving the app.
export const openLayer = (layer: Layer) => {
  history.pushState({ depth: layers().length + 1 }, "");
  setLayers((l) => [...l, layer]);
};

export const closeLayer = () => history.back();

export const drink = async () => {
  const s = snap();
  const v = s?.volumes.find((x) => x.id === selectedVolumeId());
  const t = s?.types.find((x) => x.id === selectedTypeId());
  if (!v || !t) return false;
  const next = await run(() => api.logDrink(v.id, t.id));
  if (!next) return false;
  void api.haptic().catch(() => {});
  const newest = next.todayLogs.reduce((a, b) => (b.id > a.id ? b : a));
  showToast(`Logged ${v.ml} ml ${t.label}`, () => void run(() => api.deleteLog(newest.id)));
  return true;
};

export const deleteLogWithUndo = async (gone: api.DrinkLog) => {
  if (!(await run(() => api.deleteLog(gone.id)))) return;
  closeLayer();
  const label = snap()?.types.find((t) => t.id === gone.typeId)?.label ?? "";
  showToast(`Deleted ${gone.ml} ml ${label}`, () => void run(() => api.addLog({ atMs: gone.atMs, ml: gone.ml, typeId: gone.typeId })));
};

history.replaceState({ depth: 0 }, "");
addEventListener("popstate", (e) => {
  const depth = (e.state as { depth?: number } | null)?.depth ?? 0;
  setLayers((l) => (l.length > depth ? l.slice(0, depth) : l));
});
