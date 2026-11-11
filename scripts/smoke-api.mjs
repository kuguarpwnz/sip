#!/usr/bin/env node
// Runs every plugin command against the debug build on the phone, through the WebView's own
// invoke, and asserts the results. Wipes the debug app's data first (app.sip.debug only).
//
// Usage: node scripts/smoke-api.mjs [--keep-data] [--with-effects]
//   --keep-data    skip the data wipe and the seed assertions
//   --with-effects also run the commands that open system screens or send a test reminder
import { execFileSync } from "node:child_process";
import { ICON_KEYS } from "../src/icons.gen.ts";

const PKG = "app.sip.debug";
const ACTIVITY = `${PKG}/app.sip.MainActivity`;
const args = new Set(process.argv.slice(2));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...a) => execFileSync("adb", a, { encoding: "utf8" }).trim();

let passed = 0;
let failed = 0;
const check = (name, ok, detail = "") => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  (${detail})`}`);
};
const show = (v) => JSON.stringify(v);
const sortKeys = (v) =>
  Array.isArray(v) ? v.map(sortKeys) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;
const sameFields = (a, b) => show(sortKeys(a)) === show(sortKeys(b));

const waitFor = async (what, fn, timeoutMs = 20000) => {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(250);
  }
};

const connect = async () => {
  if (!args.has("--keep-data")) adb("shell", "pm", "clear", PKG);
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "am", "start", "-n", ACTIVITY);
  const pid = await waitFor("the app process", () => adb("shell", "pidof", PKG).split(/\s+/)[0]);
  const port = adb("forward", "tcp:0", `localabstract:webview_devtools_remote_${pid}`);
  const target = await waitFor("a WebView debug target", async () => {
    const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
    return list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
  });
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("devtools websocket failed"));
  });
  let nextId = 1;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  };
  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, (msg) => {
        if (msg.error) return reject(new Error(msg.error.message));
        const r = msg.result;
        if (r.exceptionDetails) return reject(new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text));
        resolve(r.result.value);
      });
      ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
    });
  await waitFor("the Tauri bridge", () => evaluate("typeof window.__TAURI_INTERNALS__?.invoke === 'function'"));
  await evaluate(`window.__sip = async (cmd, args) => {
    try {
      return { ok: true, value: await window.__TAURI_INTERNALS__.invoke('plugin:sip|' + cmd, args) };
    } catch (e) {
      return { ok: false, error: typeof e === 'string' ? e : (e && e.message) || String(e) };
    }
  }`);
  const call = (cmd, a) => evaluate(`window.__sip(${show(cmd)}, ${show(a ?? {})})`);
  const close = () => {
    ws.close();
    try { adb("forward", "--remove", `tcp:${port}`); } catch {}
  };
  return { evaluate, call, close };
};

const { evaluate, call, close } = await connect();

const ok = async (cmd, a) => {
  const r = await call(cmd, a);
  if (!r.ok) throw new Error(`${cmd} ${show(a)} was rejected: ${r.error}`);
  return r.value;
};
const rejects = async (name, cmd, a, messagePart) => {
  const r = await call(cmd, a);
  check(name, !r.ok && (!messagePart || r.error.toLowerCase().includes(messagePart.toLowerCase())), show(r));
};
const typeId = (s, label) => s.types.find((t) => t.label === label)?.id;
const volumeId = (s, ml) => s.volumes.find((v) => v.ml === ml)?.id;

try {
  let s = await ok("snapshot");

  if (!args.has("--keep-data")) {
    check("seed: drink types", show(s.types.map((t) => t.label)) === show(["Water", "Coffee", "Tea", "Juice", "Milk"]), show(s.types));
    check("seed: types are active and ordered", s.types.every((t, i) => !t.archived && t.position === i));
    check("seed: volumes", show(s.volumes.map((v) => v.ml)) === show([150, 250, 330, 500, 750]), show(s.volumes));
    check("seed: goal", s.settings.dailyGoalMl === 2000);
    check(
      "seed: reminder settings",
      sameFields(s.settings.reminders, { enabled: true, intervalMin: 60, quietAfterDrinkMin: 60, activeFrom: "08:00", activeTo: "22:00", pauseWhenGoalMet: true }),
      show(s.settings.reminders),
    );
    check("seed: preselects 250 ml and Water", s.settings.lastVolumeId === volumeId(s, 250) && s.settings.lastTypeId === typeId(s, "Water"));
    check("seed: no logs yet", s.todayLogs.length === 0 && s.lastDrinkAtMs === null);
  }
  const midnight = await evaluate("(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })()");
  check("dayStartMs is local midnight", s.dayStartMs === midnight, `${s.dayStartMs} vs ${midnight}`);
  check("every icon key is a known key", [...s.types, ...s.volumes].every((x) => ICON_KEYS.includes(x.icon)));

  const water = typeId(s, "Water");
  const coffee = typeId(s, "Coffee");
  const tea = typeId(s, "Tea");
  const v250 = volumeId(s, 250);
  const v330 = volumeId(s, 330);

  const before = await evaluate("Date.now()");
  s = await ok("log_drink", { volumeId: v330, typeId: coffee });
  const after = await evaluate("Date.now()");
  const logged = s.todayLogs[0];
  check("logDrink copies ml from the volume", logged?.ml === 330 && logged.typeId === coffee, show(logged));
  check("logDrink stamps the current time", logged.atMs >= before - 1000 && logged.atMs <= after + 1000);
  check("logDrink updates the last-used ids", s.settings.lastVolumeId === v330 && s.settings.lastTypeId === coffee);
  check("logDrink sets lastDrinkAtMs", s.lastDrinkAtMs === logged.atMs);
  await rejects("logDrink rejects an unknown volume", "log_drink", { volumeId: 9999, typeId: water }, "volume");
  await rejects("logDrink rejects an unknown type", "log_drink", { volumeId: v250, typeId: 9999 }, "type");
  await rejects("logDrink rejects a missing argument", "log_drink", { volumeId: v250 }, "typeId");
  await rejects("logDrink rejects a string id", "log_drink", { volumeId: "2", typeId: water }, "whole number");

  s = await ok("save_volume", { id: v330, ml: 333, label: "Bottle", icon: "bottle" });
  check("editing a volume leaves old logs alone", s.todayLogs.find((l) => l.id === logged.id).ml === 330);
  check("editing a volume updates the volume", s.volumes.find((v) => v.id === v330)?.ml === 333);
  s = await ok("save_volume", { id: v330, ml: 330, label: "", icon: "glass" });

  const noon = Math.floor((midnight + Date.now()) / 2);
  s = await ok("add_log", { atMs: noon, ml: 200, typeId: tea });
  const added = s.todayLogs.find((l) => l.atMs === noon);
  check("addLog adds a log at the given time", added?.ml === 200 && added.typeId === tea, show(s.todayLogs));
  check("todayLogs are newest first", s.todayLogs.every((l, i, a) => i === 0 || a[i - 1].atMs >= l.atMs));
  check("addLog leaves the last-used ids alone", s.settings.lastVolumeId === v330 && s.settings.lastTypeId === coffee);
  const lastDrink = s.lastDrinkAtMs;
  s = await ok("add_log", { atMs: midnight - 3600_000, ml: 100, typeId: water });
  check("a log from yesterday is not in todayLogs", !s.todayLogs.some((l) => l.ml === 100));
  check("lastDrinkAtMs spans days", s.lastDrinkAtMs === lastDrink);
  await rejects("addLog rejects 9 ml", "add_log", { atMs: noon, ml: 9, typeId: water }, "ml");
  await rejects("addLog rejects 3001 ml", "add_log", { atMs: noon, ml: 3001, typeId: water }, "ml");
  await rejects("addLog rejects an unknown type", "add_log", { atMs: noon, ml: 200, typeId: 9999 }, "type");

  s = await ok("update_log", { id: added.id, atMs: noon + 1000, ml: 220, typeId: water });
  const updated = s.todayLogs.find((l) => l.id === added.id);
  check("updateLog changes time, ml and type", updated?.atMs === noon + 1000 && updated.ml === 220 && updated.typeId === water, show(updated));
  await rejects("updateLog rejects an unknown log", "update_log", { id: 99999, atMs: noon, ml: 200, typeId: water }, "not found");
  await rejects("updateLog rejects 5000 ml", "update_log", { id: added.id, atMs: noon, ml: 5000, typeId: water }, "ml");

  s = await ok("delete_log", { id: added.id });
  check("deleteLog removes the log", !s.todayLogs.some((l) => l.id === added.id));
  s = await ok("delete_log", { id: added.id });
  check("deleteLog twice is harmless", !s.todayLogs.some((l) => l.id === added.id));

  s = await ok("save_volume", { ml: 1000, label: "Big", icon: "bucket-droplet" });
  const v1000 = s.volumes.at(-1);
  check("a new volume goes last", v1000.ml === 1000 && v1000.label === "Big" && v1000.position === s.volumes.length - 1, show(v1000));
  await rejects("saveVolume rejects 9 ml", "save_volume", { ml: 9, label: "", icon: "glass" }, "ml");
  await rejects("saveVolume rejects 3001 ml", "save_volume", { ml: 3001, label: "", icon: "glass" }, "ml");
  await rejects("saveVolume rejects a 25 character label", "save_volume", { ml: 100, label: "x".repeat(25), icon: "glass" }, "label");
  await rejects("saveVolume rejects an unknown id", "save_volume", { id: 9999, ml: 100, label: "", icon: "glass" }, "not found");
  await rejects("saveVolume rejects an unknown icon key", "save_volume", { ml: 100, label: "", icon: "no-such-icon" }, "icon");
  const reversed = s.volumes.map((v) => v.id).reverse();
  s = await ok("reorder_volumes", { ids: reversed });
  check("reorderVolumes applies the order", show(s.volumes.map((v) => v.id)) === show(reversed) && s.volumes.every((v, i) => v.position === i));
  await rejects("reorderVolumes rejects a partial list", "reorder_volumes", { ids: reversed.slice(1) }, "every volume");
  await rejects("reorderVolumes rejects repeats", "reorder_volumes", { ids: [...reversed.slice(1), reversed[1]] }, "");
  s = await ok("delete_volume", { id: v1000.id });
  check("deleteVolume removes the volume", !s.volumes.some((v) => v.id === v1000.id));
  await rejects("deleteVolume rejects an unknown id", "delete_volume", { id: 99999 }, "not found");
  const keep = s.volumes[0].id;
  for (const v of s.volumes.slice(1)) s = await ok("delete_volume", { id: v.id });
  check("volumes can shrink to one", s.volumes.length === 1 && s.volumes[0].id === keep);
  check("preselected volume falls back when its volume is gone", s.settings.lastVolumeId === keep, show(s.settings));
  await rejects("deleteVolume rejects the last volume", "delete_volume", { id: keep }, "at least one");
  for (const ml of [150, 250, 330, 500, 750]) s = await ok("save_volume", { ml, label: "", icon: "glass" });
  s = await ok("delete_volume", { id: keep });

  s = await ok("save_type", { label: "Smoothie", icon: "apple" });
  const smoothie = s.types.at(-1);
  check("a new type goes last", smoothie.label === "Smoothie" && !smoothie.archived && smoothie.position === s.types.length - 1, show(smoothie));
  s = await ok("save_type", { id: smoothie.id, label: "Shake", icon: "milk" });
  check("saveType edits label and icon", s.types.find((t) => t.id === smoothie.id)?.label === "Shake");
  await rejects("saveType rejects an empty label", "save_type", { label: "  ", icon: "milk" }, "label");
  await rejects("saveType rejects a 25 character label", "save_type", { label: "x".repeat(25), icon: "milk" }, "label");
  await rejects("saveType rejects an unknown icon key", "save_type", { label: "Odd", icon: "nope" }, "icon");
  await rejects("saveType rejects an unknown id", "save_type", { id: 9999, label: "Odd", icon: "milk" }, "not found");
  const activeIds = s.types.filter((t) => !t.archived).map((t) => t.id);
  s = await ok("reorder_types", { ids: [...activeIds].reverse() });
  check("reorderTypes applies the order", show(s.types.map((t) => t.id)) === show([...activeIds].reverse()));
  await rejects("reorderTypes rejects a partial list", "reorder_types", { ids: activeIds.slice(1) }, "every drink type");

  s = await ok("delete_type", { id: coffee });
  const archivedCoffee = s.types.find((t) => t.id === coffee);
  check("deleteType archives a type that has logs", archivedCoffee?.archived === true, show(archivedCoffee));
  check("old logs keep pointing at the archived type", s.todayLogs.some((l) => l.typeId === coffee));
  check("preselected type falls back when its type is archived", s.settings.lastTypeId !== coffee && s.types.find((t) => t.id === s.settings.lastTypeId)?.archived === false);
  await rejects("logDrink rejects an archived type", "log_drink", { volumeId: s.volumes[0].id, typeId: coffee }, "type");
  s = await ok("add_log", { atMs: noon, ml: 150, typeId: coffee });
  check("addLog still accepts an archived type, so undo works", s.todayLogs.some((l) => l.typeId === coffee && l.atMs === noon));
  s = await ok("delete_type", { id: coffee });
  check("archiving twice is harmless", s.types.find((t) => t.id === coffee)?.archived === true);
  const remaining = s.types.filter((t) => !t.archived);
  for (const t of remaining.slice(1)) s = await ok("delete_type", { id: t.id });
  check("types can shrink to one active type", s.types.filter((t) => !t.archived).length === 1);
  await rejects("deleteType rejects the last active type", "delete_type", { id: remaining[0].id }, "at least one");
  await rejects("deleteType rejects an unknown id", "delete_type", { id: 99999 }, "not found");
  s = await ok("reorder_types", { ids: [remaining[0].id] });
  check("reorderTypes may leave archived types out", s.types[0].id === remaining[0].id && s.types.length > 1);

  const settingsBefore = (await ok("snapshot")).settings;
  await rejects("saveSettings rejects a goal of 100", "save_settings", { dailyGoalMl: 100 }, "goal");
  await rejects("saveSettings rejects a goal of 7000", "save_settings", { dailyGoalMl: 7000 }, "goal");
  await rejects("saveSettings rejects an interval of 14", "save_settings", { reminders: { intervalMin: 14 } }, "interval");
  await rejects("saveSettings rejects an interval of 241", "save_settings", { reminders: { intervalMin: 241 } }, "interval");
  await rejects("saveSettings rejects a negative quiet time", "save_settings", { reminders: { quietAfterDrinkMin: -1 } }, "quiet");
  await rejects("saveSettings rejects a quiet time of 241", "save_settings", { reminders: { quietAfterDrinkMin: 241 } }, "quiet");
  await rejects("saveSettings rejects activeFrom after activeTo", "save_settings", { reminders: { activeFrom: "23:00", activeTo: "22:00" } }, "active hours");
  await rejects("saveSettings rejects activeFrom equal to activeTo", "save_settings", { reminders: { activeFrom: "10:00", activeTo: "10:00" } }, "active hours");
  await rejects("saveSettings checks a lone activeTo against the stored activeFrom", "save_settings", { reminders: { activeTo: "07:00" } }, "active hours");
  await rejects("saveSettings rejects a malformed time", "save_settings", { reminders: { activeFrom: "8:00" } }, "08:00");
  await rejects("saveSettings rejects a non-boolean flag", "save_settings", { reminders: { enabled: "yes" } }, "true or false");
  s = await ok("snapshot");
  check("rejected saveSettings calls change nothing", show(s.settings) === show(settingsBefore), show(s.settings));

  s = await ok("save_settings", { dailyGoalMl: 2500 });
  check("saveSettings saves the goal alone", s.settings.dailyGoalMl === 2500);
  s = await ok("save_settings", { reminders: { intervalMin: 90, quietAfterDrinkMin: 30, activeFrom: "07:30", activeTo: "23:00", pauseWhenGoalMet: false } });
  check(
    "saveSettings saves reminders and keeps the goal",
    s.settings.dailyGoalMl === 2500 &&
      sameFields(s.settings.reminders, { enabled: true, intervalMin: 90, quietAfterDrinkMin: 30, activeFrom: "07:30", activeTo: "23:00", pauseWhenGoalMet: false }),
    show(s.settings.reminders),
  );
  s = await ok("save_settings", { reminders: { enabled: false } });
  check("saveSettings merges a partial reminders object", s.settings.reminders.enabled === false && s.settings.reminders.intervalMin === 90);
  s = await ok("save_settings", {});
  check("saveSettings with nothing changes nothing", s.settings.dailyGoalMl === 2500 && s.settings.reminders.intervalMin === 90);

  let status = await ok("reminder_status");
  const booleans = ["notificationsAllowed", "channelEnabled", "exactAlarmsAllowed", "batteryUnrestricted"];
  check("reminderStatus has the four checks", booleans.every((k) => typeof status[k] === "boolean"), show(status));
  check("reminderStatus: no next reminder while disabled", status.nextReminderAtMs === null && status.missedReminderAtMs === null, show(status));
  await ok("save_settings", { reminders: { enabled: true, intervalMin: 60, quietAfterDrinkMin: 60, activeFrom: "00:00", activeTo: "23:59", pauseWhenGoalMet: false } });
  status = await ok("reminder_status");
  check("reminderStatus: next reminder is in the future when enabled", typeof status.nextReminderAtMs === "number" && status.nextReminderAtMs > Date.now(), show(status));

  await rejects("openSystemSettings rejects an unknown target", "open_system_settings", { target: "wifi" }, "target");
  await rejects("openSystemSettings rejects a missing target", "open_system_settings", {}, "target");
  check("haptic resolves", (await call("haptic")).ok);
  check("fullyDrawn resolves", (await call("fully_drawn")).ok);

  const perms = await call("check_permissions");
  check("checkPermissions reports the notifications alias", perms.ok && ["granted", "denied", "prompt", "prompt-with-rationale"].includes(perms.value?.notifications), show(perms));
  const bridge = await evaluate(`(async () => {
    const id = window.__TAURI_INTERNALS__.transformCallback(() => {});
    const added = await window.__sip('register_listener', { event: 'changed', handler: '__CHANNEL__:' + id });
    const removed = await window.__sip('remove_listener', { event: 'changed', channelId: id });
    return { added: added.ok, removed: removed.ok, error: added.error ?? removed.error };
  })()`);
  check("the changed listener can be registered and removed", bridge.added && bridge.removed, show(bridge));

  if (args.has("--with-effects")) {
    check("sendTestReminder resolves", (await call("send_test_reminder")).ok);
    check("openSystemSettings resolves for 'app'", (await call("open_system_settings", { target: "app" })).ok);
    adb("shell", "am", "start", "-n", ACTIVITY);
  }
} catch (e) {
  failed++;
  console.log(`FAIL  smoke run aborted: ${e.message}`);
} finally {
  close();
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
