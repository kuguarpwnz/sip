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

const addTea400 = () => seed("add_log", { atMs: Date.now() - 30 * MIN, ml: 400, typeId: 3 });
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
      await seed("add_log", { atMs: Date.now() - 30 * MIN, ml: 330, typeId: 5 });
      await seed("delete_type", { id: 5 });
    });

    await tap(/Milk\s*330 ml/);

    expect(selected()).toEqual(["Water", "330 ml"]);
    expect(toastText()).toBe("Milk is no longer a drink type");
  });
});

describe("holding a history row", () => {
  it("opens the editor after 450 ms, and the click after release does not select", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.pointerDown(r, { clientX: 10, clientY: 10, button: 0 });
    await vi.advanceTimersByTimeAsync(HOLD_MS - 1);
    expect(dialogs()).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const editor = t.screen.getByRole("dialog", { name: "Edit drink" });
    expect((t.within(editor).getByLabelText("Amount (ml)") as HTMLInputElement).value).toBe("400");
    expect(t.within(editor).getByRole("radio", { name: "Tea" }).getAttribute("aria-checked")).toBe("true");

    t.fireEvent.pointerUp(r);
    t.fireEvent.click(r);
    await settle();
    await back();

    expect(selected()).toEqual(["Water", "250 ml"]);
    expect(toastText()).toBeUndefined();
  });

  it("opens no dialog when the pointer moves more than 10 px first", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.pointerDown(r, { clientX: 10, clientY: 10, button: 0 });
    await vi.advanceTimersByTimeAsync(200);
    t.fireEvent.pointerMove(r, { clientX: 10, clientY: 21 });
    await vi.advanceTimersByTimeAsync(HOLD_MS);

    expect(dialogs()).toHaveLength(0);
  });

  it("opens no dialog when the gesture is cancelled", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.pointerDown(r, { clientX: 10, clientY: 10, button: 0 });
    await vi.advanceTimersByTimeAsync(200);
    t.fireEvent.pointerCancel(r);
    await vi.advanceTimersByTimeAsync(HOLD_MS);

    expect(dialogs()).toHaveLength(0);
  });

  it("opens the editor on contextmenu, once however many times it fires", async () => {
    await boot(addTea400);
    const r = row(TEA_400);

    t.fireEvent.contextMenu(r);
    await settle();
    expect(t.screen.getByRole("dialog", { name: "Edit drink" })).toBeTruthy();

    t.fireEvent.contextMenu(r);
    await settle();
    expect(dialogs()).toHaveLength(1);
  });
});

describe("the editor opened by a long press", () => {
  it("closes on Back", async () => {
    await boot(addTea400);
    t.fireEvent.contextMenu(row(TEA_400));
    await settle();
    expect(dialogs()).toHaveLength(1);

    await back();

    expect(dialogs()).toHaveLength(0);
  });

  it("Delete removes the drink, and Undo brings back the same one", async () => {
    await boot(addTea400);
    const name = row(TEA_400).textContent!;
    t.fireEvent.contextMenu(row(TEA_400));
    await settle();

    t.fireEvent.click(t.within(t.screen.getByRole("dialog", { name: "Edit drink" })).getByRole("button", { name: "Delete" }));
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
    t.fireEvent.click(t.within(t.screen.getByRole("dialog", { name: "Edit drink" })).getByRole("button", { name: "Delete" }));
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

describe("the default chips", () => {
  it("follow the newest log, so editing it changes the next drink", async () => {
    await boot();
    expect(selected()).toEqual(["Water", "250 ml"]);

    t.fireEvent.contextMenu(row(/Water\s*250 ml/));
    await settle();
    const editor = t.screen.getByRole("dialog", { name: "Edit drink" });
    t.fireEvent.click(t.within(editor).getByRole("radio", { name: "Coffee" }));
    t.fireEvent.input(t.within(editor).getByLabelText("Amount (ml)"), { target: { value: "150" } });
    t.fireEvent.click(t.within(editor).getByRole("button", { name: "Save" }));
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(selected()).toEqual(["Coffee", "150 ml"]);
    expect(t.screen.getByRole("button", { name: "+ DRINK 150 ml" })).toBeTruthy();
  });

  it("keep the first volume when the newest log's amount has no volume", async () => {
    await boot(() => seed("add_log", { atMs: Date.now() - 5 * MIN, ml: 400, typeId: 3 }));

    expect(selected()).toEqual(["Tea", "150 ml"]);
  });

  it("start from the first volume and type with no logs at all", async () => {
    await boot(async () => {
      for (const id of [1, 2, 3, 4]) await seed("delete_log", { id });
    });

    expect(selected()).toEqual(["Water", "150 ml"]);
  });
});

describe("water content", () => {
  const addJuice500 = () => seed("add_log", { atMs: Date.now() - 40 * MIN, ml: 500, typeId: 4 });
  const ringLabel = () => t.screen.getByRole("img").getAttribute("aria-label");
  const total = () => t.screen.getByText(/ \/ 2\s000 ml/).textContent;
  const openSettings = async () => {
    t.fireEvent.click(t.screen.getByRole("button", { name: "Settings" }));
    await vi.dynamicImportSettled();
    await settle();
  };

  it("counts the ring and the total in water, not in ml drunk", async () => {
    await boot(addJuice500);

    expect(total()).toMatch(/^1\s669 \/ 2\s000 ml$/);
    expect(ringLabel()).toBe("83 percent of the daily goal");
  });

  it("shows the water line only on rows where it differs from the amount", async () => {
    await boot(addJuice500);
    const lines = () => t.screen.queryAllByText(/ml water$/).map((e) => e.textContent);

    expect(lines()).toEqual(["440 ml water", "149 ml water"]);
    expect(row(/Juice\s*500 ml/).textContent).toMatch(/440 ml water/);
    expect(row(/Water\s*250 ml/).textContent).not.toMatch(/water$/);
  });

  it("is edited in the drink type sheet, and recalculates the logs of that type", async () => {
    await boot(addJuice500);

    await openSettings();
    expect(t.screen.getAllByText("88% water", { selector: ".s" })).toHaveLength(2);
    expect(t.screen.queryAllByText("100% water")).toHaveLength(0);

    t.fireEvent.click(t.screen.getByRole("button", { name: "Edit Juice" }));
    await settle();
    const sheet = t.screen.getByRole("dialog", { name: "Edit drink type" });
    const pct = t.within(sheet).getByLabelText("Water content (%)") as HTMLInputElement;
    expect(pct.value).toBe("88");
    t.fireEvent.input(pct, { target: { value: "50" } });
    t.fireEvent.click(t.within(sheet).getByRole("button", { name: "Save" }));
    await settle();

    expect(t.screen.getByText("50% water", { selector: ".s" })).toBeTruthy();
    await back();
    expect(row(/Juice\s*500 ml/).textContent).toMatch(/250 ml water/);
    expect(total()).toMatch(/^1\s479 \/ 2\s000 ml$/);
  });

  it("starts a new drink type at 100%, and rejects a value above 100", async () => {
    await boot();
    await openSettings();

    t.fireEvent.click(t.screen.getByRole("button", { name: "Add drink type" }));
    await settle();
    const sheet = t.screen.getByRole("dialog", { name: "Add drink type" });
    expect((t.within(sheet).getByLabelText("Water content (%)") as HTMLInputElement).value).toBe("100");

    t.fireEvent.input(t.within(sheet).getByLabelText("Label"), { target: { value: "Smoothie" } });
    t.fireEvent.input(t.within(sheet).getByLabelText("Water content (%)"), { target: { value: "101" } });
    t.fireEvent.click(t.within(sheet).getByRole("button", { name: "Save" }));
    await settle();
    expect(toastText()).toBe("Water content must be 0 to 100%");
    expect(dialogs().length).toBeGreaterThan(0);

    t.fireEvent.input(t.within(sheet).getByLabelText("Water content (%)"), { target: { value: "70" } });
    t.fireEvent.click(t.within(sheet).getByRole("button", { name: "Save" }));
    await settle();
    expect(t.screen.getByText("70% water", { selector: ".s" })).toBeTruthy();
  });
});
