import * as t from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./dev/fake-host";
import { setPickFromList } from "./PickerList";
import { dismissToast, setLayers, setPermission, setPick, setSnap, setStatus } from "./store";

const LATENCY_MS = 25;
const settle = (ms = LATENCY_MS * 4) => vi.advanceTimersByTimeAsync(ms);

const boot = async () => {
  const noon = new Date();
  noon.setHours(12, 0, 0, 0);
  vi.setSystemTime(noon);
  (window as any).__sipFake.reset(noon.getTime());
  history.replaceState({ depth: 0 }, "");
  dismissToast();
  setLayers([]);
  setPick({});
  setSnap(undefined);
  setStatus(undefined);
  setPermission(undefined);
  t.render(() => <App />);
  await settle();
};

const click = async (el: HTMLElement) => {
  t.fireEvent.click(el);
  await settle();
};
const button = (name: RegExp | string) => t.screen.getByRole("button", { name });
const radio = (name: RegExp | string) => t.screen.getByRole("radio", { name });
const checked = (name: RegExp | string) => radio(name).getAttribute("aria-checked");
const pickerButton = () => button(/Water\s*250 ml/);
const sheet = () => t.screen.queryByRole("dialog", { name: "Choose drink" });
const loggedRows = () => t.screen.queryAllByRole("listitem").filter((li) => /\d ml/.test(li.textContent ?? ""));

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
  localStorage.clear();
  setPickFromList(false);
});

afterEach(() => {
  t.cleanup();
  vi.useRealTimers();
});

describe("drink picker experiment", () => {
  it("shows the chip rows by default", async () => {
    await boot();

    expect(t.screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(t.screen.queryByRole("button", { name: /Water\s*250 ml/ })).toBeNull();
  });

  it("replaces the chip rows with one button once the setting is on", async () => {
    await boot();

    await click(button("Settings"));
    await vi.dynamicImportSettled();
    await settle();
    await click(t.screen.getByRole("switch", { name: "Pick drinks from a list" }));
    expect(localStorage.getItem("sip.picker")).toBe("list");
    await click(button("Back"));

    expect(t.screen.queryAllByRole("radiogroup")).toHaveLength(0);
    expect(pickerButton()).toBeTruthy();
    expect(button("+ DRINK 250 ml")).toBeTruthy();
  });

  it("opens the sheet, and taps update the selection and the button", async () => {
    setPickFromList(true);
    await boot();

    await click(pickerButton());
    expect(sheet()).toBeTruthy();
    expect(checked("Water")).toBe("true");
    expect(checked(/^330 ml$/)).toBe("false");

    await click(radio("Coffee"));
    await click(radio(/^330 ml$/));

    expect(sheet()).toBeTruthy();
    expect(checked("Coffee")).toBe("true");
    expect(checked("Water")).toBe("false");
    expect(checked(/^330 ml$/)).toBe("true");
    expect(t.screen.getAllByRole("button", { name: "+ DRINK 330 ml" })).toHaveLength(2);
    expect(t.screen.getByRole("button", { name: /Coffee\s*330 ml/ })).toBeTruthy();
  });

  it("logs from the sheet with the toast, then closes it", async () => {
    setPickFromList(true);
    await boot();
    const before = loggedRows().length;

    await click(pickerButton());
    await click(radio("Tea"));
    await click(t.within(sheet()!).getByRole("button", { name: "+ DRINK 250 ml" }));

    expect(sheet()).toBeNull();
    expect(loggedRows()).toHaveLength(before + 1);
    expect(t.screen.getByRole("status").textContent).toContain("Logged 250 ml Tea");
    expect(t.screen.getByRole("button", { name: "Undo" })).toBeTruthy();
  });

  it("closes on Back without logging", async () => {
    setPickFromList(true);
    await boot();
    const before = loggedRows().length;

    await click(pickerButton());
    expect(sheet()).toBeTruthy();
    history.back();
    await settle();

    expect(sheet()).toBeNull();
    expect(loggedRows()).toHaveLength(before);
  });

  it("keeps the preference after a fresh module load", async () => {
    setPickFromList(true);
    vi.resetModules();
    const picker = await import("./PickerList");
    expect(picker.pickFromList()).toBe(true);

    picker.setPickFromList(false);
    vi.resetModules();
    expect((await import("./PickerList")).pickFromList()).toBe(false);
  });
});
