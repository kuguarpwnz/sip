import * as t from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./dev/fake-host";
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
const pickerButton = () => button("Choose drink: Water, 250 ml");
const sheet = () => t.screen.queryByRole("dialog", { name: "Choose drink" });
const loggedRows = () => t.screen.queryAllByRole("listitem").filter((li) => /\d ml/.test(li.textContent ?? ""));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  t.cleanup();
  vi.useRealTimers();
});

describe("drink picker", () => {
  it("opens the sheet, and taps update the selection and the button", async () => {
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
    expect(button("Choose drink: Coffee, 330 ml")).toBeTruthy();
  });

  it("logs from the sheet with the toast, then closes it", async () => {
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
    await boot();
    const before = loggedRows().length;

    await click(pickerButton());
    expect(sheet()).toBeTruthy();
    history.back();
    await settle();

    expect(sheet()).toBeNull();
    expect(loggedRows()).toHaveLength(before);
  });
});
