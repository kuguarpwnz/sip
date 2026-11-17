import { addPluginListener, invoke } from "@tauri-apps/api/core";
import type { IconKey } from "./icons.gen";

export type { IconKey };

export interface DrinkType { id: number; label: string; icon: IconKey; position: number; archived: boolean; waterPct: number }
export interface Volume { id: number; ml: number; label: string; icon: IconKey; position: number }
/** `waterMl` is `ml` scaled by the type's current waterPct, so changing the percentage recalculates every log of that type. */
export interface DrinkLog { id: number; atMs: number; ml: number; typeId: number; waterMl: number }
export interface ReminderSettings {
  enabled: boolean; intervalMin: number; quietAfterDrinkMin: number;
  activeFrom: string; activeTo: string; // "HH:mm"
  pauseWhenGoalMet: boolean;
}
export interface Settings {
  dailyGoalMl: number; reminders: ReminderSettings;
  /** What the next drink repeats, derived from the newest log. Always an existing volume and an active type. */
  lastVolumeId: number | null; lastTypeId: number | null;
}
export interface Snapshot {
  settings: Settings; types: DrinkType[]; volumes: Volume[];
  todayLogs: DrinkLog[]; dayStartMs: number; lastDrinkAtMs: number | null;
}
export interface ReminderStatus {
  notificationsAllowed: boolean; channelEnabled: boolean; exactAlarmsAllowed: boolean;
  batteryUnrestricted: boolean; nextReminderAtMs: number | null; missedReminderAtMs: number | null;
}

export interface LogInput { atMs: number; ml: number; typeId: number }
export interface VolumeInput { id?: number; ml: number; label: string; icon: IconKey }
export interface TypeInput { id?: number; label: string; icon: IconKey; waterPct: number }
export interface SettingsPatch { dailyGoalMl?: number; reminders?: Partial<ReminderSettings> }

export type SettingsTarget = "notifications" | "exactAlarms" | "battery" | "app";
export type PermissionState = "granted" | "denied" | "prompt" | "prompt-with-rationale";

const call = async <T>(command: string, args?: Record<string, unknown>): Promise<T> => {
  try {
    return await invoke<T>(`plugin:sip|${command}`, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : ((e as { message?: string } | null)?.message ?? String(e)));
  }
};

export const snapshot = () => call<Snapshot>("snapshot");
export const logDrink = (volumeId: number, typeId: number) => call<Snapshot>("log_drink", { volumeId, typeId });
export const addLog = (input: LogInput) => call<Snapshot>("add_log", { ...input });
export const updateLog = (input: LogInput & { id: number }) => call<Snapshot>("update_log", { ...input });
export const deleteLog = (id: number) => call<Snapshot>("delete_log", { id });

export const saveVolume = (input: VolumeInput) => call<Snapshot>("save_volume", { ...input });
export const deleteVolume = (id: number) => call<Snapshot>("delete_volume", { id });
export const reorderVolumes = (ids: number[]) => call<Snapshot>("reorder_volumes", { ids });

export const saveType = (input: TypeInput) => call<Snapshot>("save_type", { ...input });
export const deleteType = (id: number) => call<Snapshot>("delete_type", { id });
export const reorderTypes = (ids: number[]) => call<Snapshot>("reorder_types", { ids });

export const saveSettings = (patch: SettingsPatch) => call<Snapshot>("save_settings", { ...patch });

export const reminderStatus = () => call<ReminderStatus>("reminder_status");
export const openSystemSettings = (target: SettingsTarget) => call<void>("open_system_settings", { target });
export const sendTestReminder = () => call<void>("send_test_reminder");
export const haptic = () => call<void>("haptic");
export const fullyDrawn = () => call<void>("fully_drawn");

export const checkNotificationPermission = async (): Promise<PermissionState> =>
  (await call<{ notifications: PermissionState }>("check_permissions")).notifications;

export const requestNotificationPermission = async (): Promise<PermissionState> =>
  (await call<{ notifications: PermissionState }>("request_permissions", { permissions: ["notifications"] })).notifications;

/** Fires for writes that did not come from the UI, such as the notification button. Returns the unsubscribe function. */
export const onChanged = async (cb: (snapshot: Snapshot) => void): Promise<() => Promise<void>> => {
  const listener = await addPluginListener<Snapshot>("sip", "changed", cb);
  return () => listener.unregister();
};
