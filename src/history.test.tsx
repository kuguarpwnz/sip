import * as t from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./dev/fake-host";
import { dismissToast, setLayers, setPermission, setPick, setSnap, setStatus } from "./store";

const MIN = 60_000;
const HOLD_MS = 450;
const TOAST_MS = 4000;
const LATENCY_MS = 25;

const settle = (ms = LATENCY_MS * 4) => vi.advanceTimersByTimeAsync(ms);

const host = (cmd: string, args: Record<string, unknown>) =>
  (window as any).__TAURI_INTERNALS__.invoke(`plugin:sip|${cmd}`, args) as Promise<unknown>;

const seed = async (cmd: string, args: Record<string, unknown>) => {
  const p = host(cmd, args);
  await settle();
  await p;
};

/** The app keeps its state in module scope, so each test clears the store and the fake host before it renders. */
const boot = async (prepare?: () => Promise<void>) => {
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
  await prepare?.();
  t.render(() => <App />);
  await settle();
};

const row = (name: RegExp) => t.screen.getByRole("button", { name });
const radio = (name: RegExp | string) => t.screen.getByRole("radio", { name });
const selected = () =>
  t.screen.getAllByRole("radio").filter((r) => r.getAttribute("aria-checked") === "true").map((r) => r.textContent?.trim());
const dialogs = () => t.screen.queryAllByRole("dialog");
const toastText = () => t.screen.queryByRole("status")?.textContent;

const tap = async (name: RegExp) => {
  t.fireEvent.pointerDown(row(name), { clientX: 10, clientY: 10, button: 0 });
  t.fireEvent.pointerUp(row(name));
  t.fireEvent.click(row(name));
  await settle();
};

const back = async () => {
  history.back();
  await settle();
};

const addTea400 = () => seed("add_log", { atMs: Date.now() - 5 * MIN, ml: 400, typeId: 3 });
const TEA_400 = /Tea\s*400 ml/;

beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  t.cleanup();
  vi.useRealTimers();
});

describe("tapping a history row", () => {
  it("selects its type and volume", async () => {
    await boot();
    expect(selected()).toEqual(["Water", "250 ml"]);

    await tap(/Coffee\s*150 ml/);

    expect(radio("Coffee").getAttribute("aria-checked")).toBe("true");
    expect(radio(/^150 ml$/).getAttribute("aria-checked")).toBe("true");
    expect(t.screen.getByRole("button", { name: "+ DRINK 150 ml" })).toBeTruthy();
    expect(toastText()).toBeUndefined();
  });

  it("selects the type and keeps the volume when no volume matches", async () => {
    await boot(addTea400);

    await tap(TEA_400);

    expect(selected()).toEqual(["Tea", "250 ml"]);
    expect(toastText()).toBe("No 400 ml volume to select");
  });

  it("selects the volume and keeps the type when the type is archived", async () => {
    await boot(async () => {
      await seed("add_log", { atMs: Date.now() - 5 * MIN, ml: 330, typeId: 5 });
      await seed("delete_type", { id: 5 });
    });

    await tap(/Milk\s*330 ml/);

    expect(selected()).toEqual(["Water", "330 ml"]);
    expect(toastText()).toBe("Milk is no longer a drink type");
  });
});

describe("holding a history row", () => {
  it("opens the menu after 450 ms, and the click after release does not select", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.pointerDown(r, { clientX: 10, clientY: 10, button: 0 });
    await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
    expect(dialogs()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.screen.getByRole("dialog", { name: /^\d\d:\d\d Tea 400 ml$/ })).toBeTruthy();

    t.fireEvent.pointerUp(r);
    t.fireEvent.click(r);
    await settle();

    expect(selected()).toEqual(["Water", "250 ml"]);
    expect(toastText()).toBeUndefined();
  });

  it("opens no menu when the pointer moves more than 10 px first", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.pointerDown(r, { clientX: 10, clientY: 10, button: 0 });
    await vi.advanceTimersByTimeAsync(200);
    t.fireEvent.pointerMove(r, { clientX: 10, clientY: 21 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);

    expect(dialogs()).toHaveLength(0);
  });

  it("opens no menu when the gesture is cancelled", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.pointerDown(r, { clientX: 10, clientY: 10, button: 0 });
    await vi.advanceTimersByTimeAsync(200);
    t.fireEvent.pointerCancel(r);
    await vi.advanceTimersByTimeAsync(HOLD_MS);

    expect(dialogs()).toHaveLength(0);
  });

  it("opens the menu on contextmenu, once however many times it fires", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.contextMenu(r);
    await settle();
    expect(t.screen.getByRole("dialog", { name: /Tea 400 ml$/ })).toBeTruthy();

    t.fireEvent.contextMenu(r);
    await settle();
    expect(dialogs()).toHaveLength(1);
  });
});

describe("the log menu", () => {
  it("closes on Back", async () => {
    await boot(addTea400);
    t.fireEvent.contextMenu(row(TEA_400));
    await settle();
    expect(dialogs()).toHaveLength(1);

    await back();

    expect(dialogs()).toHaveLength(0);
  });

  it("Edit swaps in the editor for that drink, and Back returns to the main screen", async () => {
    await boot(addTea400);
    t.fireEvent.contextMenu(row(TEA_400));
    await settle();

    t.fireEvent.click(t.screen.getByRole("button", { name: "Edit" }));
    await settle();

    expect(dialogs()).toHaveLength(1);
    const editor = t.screen.getByRole("dialog", { name: "Edit drink" });
    expect((t.within(editor).getByLabelText("Amount (ml)") as HTMLInputElement).value).toBe("400");
    expect(t.within(editor).getByRole("radio", { name: "Tea" }).getAttribute("aria-checked")).toBe("true");

    await back();

    expect(dialogs()).toHaveLength(0);
    expect(t.screen.getByRole("heading", { name: "Today" })).toBeTruthy();
  });

  it("Delete removes the drink, and Undo brings back the same one", async () => {
    await boot(addTea400);
    const name = row(TEA_400).textContent!;
    t.fireEvent.contextMenu(row(TEA_400));
    await settle();

    t.fireEvent.click(t.screen.getByRole("button", { name: "Delete" }));
    await settle();

    expect(t.screen.queryByRole("button", { name: TEA_400 })).toBeNull();
    expect(dialogs()).toHaveLength(0);
    expect(toastText()).toBe("Deleted 400 ml TeaUndo");

    t.fireEvent.click(t.screen.getByRole("button", { name: "Undo" }));
    await settle();

    expect(row(TEA_400).textContent).toBe(name);
  });

  it("drops the Undo offer after 4 s", async () => {
    await boot(addTea400);
    t.fireEvent.contextMenu(row(TEA_400));
    await settle();
    t.fireEvent.click(t.screen.getByRole("button", { name: "Delete" }));
    await settle();
    expect(t.screen.queryByRole("button", { name: "Undo" })).not.toBeNull();

    await vi.advanceTimersByTimeAsync(TOAST_MS);

    expect(t.screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });
});

describe("+ DRINK", () => {
  it("logs the selected drink, and Undo removes it", async () => {
    await boot();
    const rows = () => t.within(t.screen.getByRole("list")).getAllByRole("button");
    expect(rows()).toHaveLength(4);

    t.fireEvent.click(t.screen.getByRole("button", { name: "+ DRINK 250 ml" }));
    await settle();

    expect(toastText()).toBe("Logged 250 ml WaterUndo");
    expect(rows()).toHaveLength(5);
    expect(rows()[0].textContent).toMatch(/Water\s*250 ml/);

    t.fireEvent.click(t.screen.getByRole("button", { name: "Undo" }));
    await settle();

    expect(rows()).toHaveLength(4);
  });
});
