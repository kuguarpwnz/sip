import * as t from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./dev/fake-host";
import { dayTitle } from "./format";
import { dismissToast, setLayers, setPermission, setPick, setSnap, setStatus } from "./store";

const HOLD_MS = 450;
const LATENCY_MS = 25;
const WATER = 1;
const COFFEE = 2;
const TEA = 3;
const JUICE = 4;
const MILK = 5;

const settle = (ms = LATENCY_MS * 4) => vi.advanceTimersByTimeAsync(ms);

const host = (cmd: string, args: Record<string, unknown>) =>
  (window as any).__TAURI_INTERNALS__.invoke(`plugin:sip|${cmd}`, args) as Promise<unknown>;

const seed = async (cmd: string, args: Record<string, unknown>) => {
  const p = host(cmd, args);
  await settle();
  await p;
};

const daysAgo = (n: number, hour = 12) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - n, hour).getTime();
};
const logAgo = (n: number, hour: number, ml: number, typeId: number) => seed("add_log", { atMs: daysAgo(n, hour), ml, typeId });
const titleOf = (n: number) => dayTitle(daysAgo(n, 0));

/** Logs 1, 2, 5 and 9 days ago. Days 3, 4, 6, 7 and 8 are empty. */
const earlierLogs = async () => {
  await logAgo(1, 9, 330, WATER);
  await logAgo(1, 10, 150, COFFEE);
  await logAgo(2, 8, 400, TEA);
  await logAgo(5, 9, 250, MILK);
  await logAgo(9, 7, 500, JUICE);
};

const boot = async (prepare: () => Promise<void> = earlierLogs) => {
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
  await prepare();
  t.render(() => <App />);
  await settle();
};

const button = (name: RegExp | string) => t.screen.getByRole("button", { name });
const maybe = (name: RegExp | string) => t.screen.queryByRole("button", { name });
const selected = () => {
  const label = button(/^Choose drink:/).getAttribute("aria-label")!;
  return label.replace("Choose drink: ", "").split(", ");
};
const dialogs = () => t.screen.queryAllByRole("dialog");
const toastText = () => t.screen.queryByRole("status")?.textContent;
const bar = () => t.screen.queryByRole("group", { name: "Earlier day" });
const shownDay = () => bar()?.querySelector("strong")?.textContent;
const rowCount = () => document.querySelectorAll(".logs li:not(.empty)").length;
const depth = () => (history.state as { depth: number }).depth;

const click = async (name: RegExp | string) => {
  t.fireEvent.click(button(name));
  await settle();
};
const back = async () => {
  history.back();
  await settle();
};
const hold = async (name: RegExp) => {
  t.fireEvent.pointerDown(button(name), { clientX: 10, clientY: 10, button: 0 });
  await vi.advanceTimersByTimeAsync(HOLD_MS);
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  t.cleanup();
  vi.useRealTimers();
});

describe("Earlier", () => {
  it("says so and stays on today when no earlier day has a log", async () => {
    await boot(async () => {});

    await click("Earlier");

    expect(toastText()).toBe("No earlier drinks yet");
    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
    expect(rowCount()).toBe(4);
  });

  it("fetches only when tapped", async () => {
    const spy = vi.spyOn((window as any).__TAURI_INTERNALS__, "invoke");
    await boot();
    const logsCalls = () => spy.mock.calls.filter(([cmd]) => String(cmd).endsWith("logs_between")).length;
    expect(logsCalls()).toBe(0);

    await click("Earlier");

    expect(logsCalls()).toBe(1);
    spy.mockRestore();
  });

  it("opens the most recent earlier day, labelled Yesterday, and leaves today's list", async () => {
    await boot();

    await click("Earlier");

    expect(shownDay()).toBe("Yesterday");
    expect(rowCount()).toBe(2);
    expect(t.screen.getByRole("button", { name: /Coffee\s*150 ml/ })).toBeTruthy();
    expect(maybe("Earlier")).toBeNull();
    expect(depth()).toBe(1);
  });

  it("labels a day that is not yesterday with its date", async () => {
    await boot(async () => {
      await logAgo(3, 9, 250, WATER);
    });

    await click("Earlier");

    expect(shownDay()).toBe(titleOf(3));
  });
});

describe("stepping between earlier days", () => {
  it("‹ skips empty days and is disabled at the oldest", async () => {
    await boot();
    await click("Earlier");

    await click("Older day");
    expect(shownDay()).toBe(titleOf(2));
    await click("Older day");
    expect(shownDay()).toBe(titleOf(5));
    await click("Older day");
    expect(shownDay()).toBe(titleOf(9));

    expect((button("Older day") as HTMLButtonElement).disabled).toBe(true);
    expect(depth()).toBe(1);
  });

  it("› steps forward, and from the newest earlier day returns to today", async () => {
    await boot();
    await click("Earlier");
    await click("Older day");
    await click("Older day");

    await click("Newer day");
    expect(shownDay()).toBe(titleOf(2));
    await click("Newer day");
    expect(shownDay()).toBe("Yesterday");
    expect((button("Older day") as HTMLButtonElement).disabled).toBe(false);
    await click("Newer day");

    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
    expect(rowCount()).toBe(4);
  });

  it("Today jumps back from several days ago in one tap", async () => {
    await boot();
    await click("Earlier");
    await click("Older day");
    await click("Older day");
    await click("Older day");

    await click("Today");

    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
    expect(rowCount()).toBe(4);
  });

  it("Android Back returns to today in one press", async () => {
    await boot();
    await click("Earlier");
    await click("Older day");

    await back();

    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
  });
});

describe("a row on an earlier day", () => {
  it("selects its drink on tap and logs nothing", async () => {
    await boot();
    await click("Earlier");
    expect(selected()).toEqual(["Water", "250 ml"]);

    await click(/Water\s*330 ml/);

    expect(selected()).toEqual(["Water", "330 ml"]);
    await click(/Coffee\s*150 ml/);
    expect(selected()).toEqual(["Coffee", "150 ml"]);
    expect(shownDay()).toBe("Yesterday");
    await click("Today");
    expect(rowCount()).toBe(4);
  });

  it("opens the editor on a long press, and saving keeps the day on screen", async () => {
    await boot();
    await click("Earlier");
    await click("Older day");

    await hold(/Tea\s*400 ml/);
    const editor = t.screen.getByRole("dialog", { name: "Edit drink" });
    const amount = t.within(editor).getByLabelText("Amount (ml)") as HTMLInputElement;
    t.fireEvent.input(amount, { target: { value: "200" } });
    t.fireEvent.click(t.within(editor).getByRole("button", { name: "Save" }));
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(shownDay()).toBe(titleOf(2));
    expect(t.screen.getByRole("button", { name: /Tea\s*200 ml/ })).toBeTruthy();
    expect(depth()).toBe(1);
  });

  it("moves to the nearest earlier day when the shown one is emptied", async () => {
    await boot();
    await click("Earlier");
    await click("Older day");

    await hold(/Tea\s*400 ml/);
    t.fireEvent.click(t.within(t.screen.getByRole("dialog", { name: "Edit drink" })).getByRole("button", { name: "Delete" }));
    await settle();

    expect(shownDay()).toBe("Yesterday");
    expect((button("Older day") as HTMLButtonElement).disabled).toBe(false);
  });

  it("closes the view when the last earlier log is deleted", async () => {
    await boot(async () => {
      await logAgo(2, 8, 400, TEA);
    });
    await click("Earlier");

    await hold(/Tea\s*400 ml/);
    t.fireEvent.click(t.within(t.screen.getByRole("dialog", { name: "Edit drink" })).getByRole("button", { name: "Delete" }));
    await settle();

    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
    expect(rowCount()).toBe(4);
  });
});

describe("logging from an earlier day", () => {
  it("+ DRINK logs for today and ends on today with no layers", async () => {
    await boot();
    await click("Earlier");
    await click(/Coffee\s*150 ml/);

    await click(/^\+ DRINK/);

    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
    expect(rowCount()).toBe(5);
    expect(toastText()).toMatch(/^Logged 150 ml Coffee/);
  });

  it("the picker sheet's + DRINK does the same with the view underneath", async () => {
    await boot();
    await click("Earlier");
    await click(/^Choose drink:/);
    expect(depth()).toBe(2);
    t.fireEvent.click(t.within(t.screen.getByRole("dialog")).getByRole("radio", { name: "Juice" }));

    t.fireEvent.click(t.within(t.screen.getByRole("dialog")).getByRole("button", { name: /^\+ DRINK/ }));
    await settle();

    expect(dialogs()).toHaveLength(0);
    expect(bar()).toBeNull();
    expect(depth()).toBe(0);
    expect(rowCount()).toBe(5);
    expect(toastText()).toMatch(/^Logged 250 ml Juice/);
  });
});
