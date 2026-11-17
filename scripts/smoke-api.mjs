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
    check("seed: water content", show(s.types.map((t) => t.waterPct)) === show([100, 99, 99, 88, 88]), show(s.types));
    check("seed: types are active and ordered", s.types.every((t, i) => !t.archived && t.position === i));
    check("seed: volumes", show(s.volumes.map((v) => v.ml)) === show([150, 250, 330, 500, 750]), show(s.volumes));
    check("seed: goal", s.settings.dailyGoalMl === 2000);
    check(
      "seed: reminder settings",
      sameFields(s.settings.reminders, { enabled: true, intervalMin: 60, quietAfterDrinkMin: 60, activeFrom: "08:00", activeTo: "22:00", pauseWhenGoalMet: true }),
      show(s.settings.reminders),
    );
    check("seed: with no logs the preset is the first volume and the first type", s.settings.lastVolumeId === volumeId(s, 150) && s.settings.lastTypeId === typeId(s, "Water"), show(s.settings));
    check("seed: no logs yet", s.todayLogs.length === 0 && s.lastDrinkAtMs === null);
    const empty = await ok("logs_between", { fromMs: 0, toMs: Date.now() + 86400_000 });
    check("logsBetween with no logs is empty and has no firstAtMs", empty.logs.length === 0 && empty.firstAtMs === null, show(empty));
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
  check("logDrink moves the preset to the new log", s.settings.lastVolumeId === v330 && s.settings.lastTypeId === coffee);
  check("a log's waterMl is its ml scaled by the type's waterPct", logged.waterMl === Math.round((330 * 99) / 100), show(logged));
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
  check("addLog of an older drink leaves the preset alone", s.settings.lastVolumeId === v330 && s.settings.lastTypeId === coffee);
  const lastDrink = s.lastDrinkAtMs;
  s = await ok("add_log", { atMs: midnight - 3600_000, ml: 100, typeId: water });
  check("a log from yesterday is not in todayLogs", !s.todayLogs.some((l) => l.ml === 100));
  check("lastDrinkAtMs spans days", s.lastDrinkAtMs === lastDrink);
  const DAY = 86400_000;
  const base = midnight - 40 * DAY;
  for (const [atMs, ml, type] of [[base + 2000, 112, water], [base + 2000, 113, water], [base + 3000, 200, coffee], [base + 1000, 111, water]]) {
    await ok("add_log", { atMs, ml, typeId: type });
  }
  const mls = (r) => r.logs.map((l) => l.ml);
  let range = await ok("logs_between", { fromMs: base, toMs: base + 3000 });
  check("logsBetween orders by time, then id, whatever the insert order", show(mls(range)) === show([111, 112, 113]), show(range));
  check("logsBetween leaves out a log exactly at toMs", !mls(range).includes(200));
  check("logsBetween has firstAtMs of the first log ever", range.firstAtMs === base + 1000, show(range.firstAtMs));
  range = await ok("logs_between", { fromMs: base + 1000, toMs: base + 3001 });
  check("logsBetween includes a log exactly at fromMs and at toMs - 1", show(mls(range)) === show([111, 112, 113, 200]), show(range));
  range = await ok("logs_between", { fromMs: base + 1001, toMs: base + 3001 });
  check("logsBetween excludes a log just before fromMs, yet firstAtMs still names it", show(mls(range)) === show([112, 113, 200]) && range.firstAtMs === base + 1000, show(range));
  check("logsBetween returns the DrinkLog shape with waterMl", sameFields(Object.keys(range.logs[2]).sort(), ["atMs", "id", "ml", "typeId", "waterMl"]) && range.logs[2].waterMl === 198 && range.logs[2].typeId === coffee, show(range.logs[2]));
  range = await ok("logs_between", { fromMs: base + 4000, toMs: base + 5000 });
  check("logsBetween of an empty range has no logs but a firstAtMs", range.logs.length === 0 && range.firstAtMs === base + 1000, show(range));
  range = await ok("logs_between", { fromMs: 0, toMs: midnight + DAY });
  check("logsBetween from 0 to the end of today holds every log, today's too", mls(range).slice(0, 4).join() === "111,112,113,200" && range.logs.some((l) => l.id === logged.id) && range.logs.every((l, i, a) => i === 0 || a[i - 1].atMs <= l.atMs), show(mls(range)));
  await rejects("logsBetween rejects fromMs equal to toMs", "logs_between", { fromMs: 5, toMs: 5 }, "before");
  await rejects("logsBetween rejects fromMs after toMs", "logs_between", { fromMs: 6, toMs: 5 }, "before");
  await rejects("logsBetween rejects a missing toMs", "logs_between", { fromMs: 5 }, "toMs");
  await rejects("logsBetween rejects a string bound", "logs_between", { fromMs: "0", toMs: 5 }, "whole number");
  for (const l of range.logs.filter((x) => x.atMs < midnight - DAY)) await ok("delete_log", { id: l.id });
  range = await ok("logs_between", { fromMs: base, toMs: base + 5000 });
  check("the history logs are cleaned up", range.logs.length === 0);
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

  s = await ok("update_log", { id: logged.id, atMs: logged.atMs, ml: 400, typeId: tea });
  check("editing the newest log moves the preset to its type", s.settings.lastTypeId === tea, show(s.settings));
  check("an amount with no volume presets the first volume", s.settings.lastVolumeId === s.volumes[0].id, show(s.settings));
  s = await ok("update_log", { id: logged.id, atMs: logged.atMs, ml: 330, typeId: coffee });
  check("editing it back moves the preset back", s.settings.lastTypeId === coffee && s.settings.lastVolumeId === v330, show(s.settings));
  s = await ok("add_log", { atMs: logged.atMs + 1000, ml: 500, typeId: water });
  const tieFirst = s.todayLogs.find((l) => l.ml === 500 && l.atMs === logged.atMs + 1000);
  s = await ok("add_log", { atMs: logged.atMs + 1000, ml: 750, typeId: tea });
  const tieSecond = s.todayLogs.find((l) => l.ml === 750 && l.atMs === logged.atMs + 1000);
  check("at the same time the highest id is the newest", tieSecond.id > tieFirst.id && s.settings.lastTypeId === tea && s.settings.lastVolumeId === volumeId(s, 750), show(s.settings));
  s = await ok("delete_log", { id: tieSecond.id });
  check("deleting the newest log moves the preset to the one before", s.settings.lastTypeId === water && s.settings.lastVolumeId === volumeId(s, 500), show(s.settings));
  s = await ok("delete_log", { id: tieFirst.id });
  check("the preset returns to the first log once the newer ones are gone", s.settings.lastTypeId === coffee && s.settings.lastVolumeId === v330, show(s.settings));

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

  const logWater = (snap, id) => snap.todayLogs.find((l) => l.id === id).waterMl;
  const coffeeAt = (waterPct) => ok("save_type", { id: coffee, label: "Coffee", icon: "coffee", waterPct });
  const total = (snap) => snap.todayLogs.reduce((n, l) => n + l.waterMl, 0);
  const totalBefore = total(s);
  s = await coffeeAt(50);
  check("changing a type's waterPct leaves existing logs unchanged", logWater(s, logged.id) === 327 && s.todayLogs.find((l) => l.id === logged.id).ml === 330, show(s.todayLogs));
  check("changing a type's waterPct leaves the total unchanged", total(s) === totalBefore, `${total(s)} vs ${totalBefore}`);
  s = await ok("log_drink", { volumeId: volumeId(s, 330), typeId: coffee });
  const stamped = s.todayLogs.find((l) => l.id !== logged.id && l.typeId === coffee && l.ml === 330 && l.atMs >= logged.atMs);
  check("a new log uses the type's new waterPct", stamped?.waterMl === 165, show(stamped));
  s = await coffeeAt(20);
  s = await ok("update_log", { id: stamped.id, atMs: stamped.atMs, ml: 200, typeId: coffee });
  check("editing the amount keeps the log's own waterPct", logWater(s, stamped.id) === 100, show(s.todayLogs.find((l) => l.id === stamped.id)));
  s = await ok("update_log", { id: stamped.id, atMs: stamped.atMs - 1000, ml: 200, typeId: coffee });
  check("editing the time keeps the log's own waterPct", logWater(s, stamped.id) === 100);
  s = await ok("update_log", { id: stamped.id, atMs: stamped.atMs, ml: 200, typeId: tea });
  check("changing a log's type takes the new type's waterPct", logWater(s, stamped.id) === 198, show(s.todayLogs.find((l) => l.id === stamped.id)));
  s = await ok("update_log", { id: stamped.id, atMs: stamped.atMs, ml: 200, typeId: coffee });
  check("changing it back takes that type's current waterPct", logWater(s, stamped.id) === 40);
  s = await ok("delete_log", { id: stamped.id });
  s = await ok("add_log", { atMs: logged.atMs + 500, ml: 200, typeId: coffee });
  const undone = s.todayLogs.find((l) => l.ml === 200 && l.typeId === coffee && l.atMs === logged.atMs + 500);
  check("addLog takes the type's current waterPct", undone.waterMl === 40, show(undone));
  s = await ok("delete_log", { id: undone.id });
  s = await coffeeAt(0);
  s = await ok("log_drink", { volumeId: volumeId(s, 330), typeId: coffee });
  const dry = s.todayLogs.find((l) => l.id !== logged.id && l.typeId === coffee && l.ml === 330 && l.atMs >= logged.atMs);
  check("0% water is allowed and counts nothing", dry.waterMl === 0 && logWater(s, logged.id) === 327, show(s.todayLogs));
  s = await ok("delete_log", { id: dry.id });
  s = await coffeeAt(99);
  check("the cleanup leaves the first log and the total as they were", logWater(s, logged.id) === 327 && total(s) === totalBefore);
  s = await ok("save_type", { label: "Smoothie", icon: "apple", waterPct: 70 });
  const smoothie = s.types.at(-1);
  check("a new type goes last", smoothie.label === "Smoothie" && !smoothie.archived && smoothie.position === s.types.length - 1, show(smoothie));
  check("a new type keeps its waterPct", smoothie.waterPct === 70, show(smoothie));
  s = await ok("save_type", { id: smoothie.id, label: "Shake", icon: "milk", waterPct: 85 });
  check("saveType edits label, icon and waterPct", s.types.find((t) => t.id === smoothie.id)?.label === "Shake" && s.types.find((t) => t.id === smoothie.id)?.waterPct === 85);
  await rejects("saveType rejects 101% water", "save_type", { id: smoothie.id, label: "Shake", icon: "milk", waterPct: 101 }, "between 0 and 100");
  await rejects("saveType rejects -1% water", "save_type", { id: smoothie.id, label: "Shake", icon: "milk", waterPct: -1 }, "between 0 and 100");
  await rejects("saveType rejects a fractional percentage", "save_type", { id: smoothie.id, label: "Shake", icon: "milk", waterPct: 50.5 }, "whole number");
  await rejects("saveType rejects a missing percentage", "save_type", { id: smoothie.id, label: "Shake", icon: "milk" }, "waterPct");
  await rejects("saveType rejects an empty label", "save_type", { label: "  ", icon: "milk", waterPct: 100 }, "label");
  await rejects("saveType rejects a 25 character label", "save_type", { label: "x".repeat(25), icon: "milk", waterPct: 100 }, "label");
  await rejects("saveType rejects an unknown icon key", "save_type", { label: "Odd", icon: "nope", waterPct: 100 }, "icon");
  await rejects("saveType rejects an unknown id", "save_type", { id: 9999, label: "Odd", icon: "milk", waterPct: 100 }, "not found");
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
