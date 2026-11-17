import * as t from "@solidjs/testing-library";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import "./dev/fake-host";
import { fmtMl } from "./format";
import { dismissToast, setLayers, setNow, setPermission, setPick, setSnap, setStatus } from "./store";

const LATENCY_MS = 25;
const settle = (ms = LATENCY_MS * 4) => vi.advanceTimersByTimeAsync(ms);

const host = (cmd: string, args: Record<string, unknown>) =>
  (window as any).__TAURI_INTERNALS__.invoke(`plugin:sip|${cmd}`, args) as Promise<unknown>;

const seed = async (cmd: string, args: Record<string, unknown>) => {
  const p = host(cmd, args);
  await settle();
  await p;
};

const WATER = 1;
const COFFEE = 2;

/** Sunday 22 Nov 2026 at noon. The week of Mon 16 to Sun 22 November has six finished days and today. */
const NOW = new Date(2026, 10, 22, 12, 0);

const logAt = (day: number, hour: number, ml: number, typeId = WATER) =>
  seed("add_log", { atMs: new Date(2026, 10, day, hour, 0).getTime(), ml, typeId });

/**
 * The first log is on Tue 10. Water per day: 10: 2000, 11: 1800, 12: none, 13: 2300, 14 and 15: none,
 * 16: 2200, 17: 1500, 18: 2000, 19: none, 20: 2500, 21: 1000. Today's four seeded drinks hold 1229 ml of water.
 */
const twelveDays = async () => {
  await logAt(10, 8, 2000);
  await logAt(11, 9, 1800);
  await logAt(13, 9, 1300);
  await logAt(13, 19, 1000);
  await logAt(16, 9, 1000);
  await logAt(16, 18, 1200);
  await logAt(17, 10, 1500);
  await logAt(18, 8, 1000);
  await logAt(18, 20, 1000);
  await logAt(20, 9, 1500);
  await logAt(20, 17, 1010, COFFEE);
  await logAt(21, 10, 1000);
};

const boot = async (prepare: () => Promise<void> = twelveDays) => {
  vi.setSystemTime(NOW);
  setNow(NOW.getTime());
  (window as any).__sipFake.reset(NOW.getTime());
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

const click = async (el: HTMLElement) => {
  t.fireEvent.click(el);
  await settle();
};
const button = (name: RegExp | string) => t.screen.getByRole("button", { name });
const radio = (name: string) => t.screen.getByRole("radio", { name });
const back = async () => {
  history.back();
  await settle();
};

const openHistory = async () => click(button("History"));
const history_ = () => document.querySelector(".history");
const dialog = (name: string) => t.screen.queryByRole("dialog", { name });

const tiles = () => [...document.querySelectorAll(".tile")].map((el) => [el.querySelector("strong")!.textContent, el.querySelector("span")!.textContent]);
const period = () => document.querySelector(".period")!.textContent;
const ml = (n: number) => `${fmtMl(n)} ml`;

/** What a day's bar or cell says about itself, found by its date. */
const dayLabel = (title: string) => {
  const el = document.querySelector(`.history [aria-label^="${title},"]`);
  if (!el) throw new Error(`no day labelled ${title}`);
  return el.getAttribute("aria-label")!.slice(title.length + 2);
};
const dayEl = (title: string) => document.querySelector<HTMLElement>(`.history [aria-label^="${title},"]`)!;

const sheetRows = (sheet: HTMLElement) => [...sheet.querySelectorAll(".logs li")].map((li) => li.textContent);

beforeAll(async () => {
  await import("./History");
});

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  t.cleanup();
  vi.useRealTimers();
});

describe("opening and closing History", () => {
  it("opens from the chart button and closes with Back", async () => {
    await boot();
    expect(history_()).toBeNull();

    await openHistory();

    expect(t.screen.getByRole("heading", { name: "History" })).toBeTruthy();
    expect(history_()).not.toBeNull();

    await click(button("Back"));
    await back();

    expect(history_()).toBeNull();
    expect(t.screen.getByRole("heading", { name: "Today" })).toBeTruthy();
  });

  it("closes with the Android back button", async () => {
    await boot();
    await openHistory();

    await back();

    expect(history_()).toBeNull();
  });

  it("opens when the summary is tapped", async () => {
    await boot();

    await click(t.screen.getByText(/last drink/));

    expect(history_()).not.toBeNull();
  });

  it("opens when the ring is tapped", async () => {
    await boot();

    await click(t.screen.getByRole("img", { name: /of the daily goal/ }));

    expect(history_()).not.toBeNull();
  });

  it("opens once however often it is tapped", async () => {
    await boot();

    t.fireEvent.click(button("History"));
    t.fireEvent.click(t.screen.getByText(/last drink/));
    await settle();
    await back();

    expect(history_()).toBeNull();
  });
});

describe("the week view", () => {
  it("shows the week's tiles", async () => {
    await boot();
    await openHistory();

    expect(period()).toBe("Nov 16 to 22");
    expect(tiles()).toEqual([
      [ml(1533), "a day"],
      ["3 of 6", "goal met"],
      [ml(2500), "best, Fri"],
    ]);
  });

  it("draws seven bars, today in progress and the rest judged against the goal", async () => {
    await boot();
    await openHistory();

    expect(document.querySelectorAll(".history .slot")).toHaveLength(7);
    expect(dayLabel("Mon, Nov 16")).toBe(`${ml(2200)}, goal met`);
    expect(dayLabel("Tue, Nov 17")).toBe(`${ml(1500)}, goal missed`);
    expect(dayLabel("Wed, Nov 18")).toBe(`${ml(2000)}, goal met`);
    expect(dayLabel("Thu, Nov 19")).toBe("0 ml, goal missed");
    expect(dayLabel("Sun, Nov 22")).toBe(`${ml(1229)}, today`);
  });

  it("keeps today out of the numbers however much was drunk", async () => {
    await boot(async () => {
      await twelveDays();
      await logAt(22, 11, 3000);
    });
    await openHistory();

    expect(dayLabel("Sun, Nov 22")).toBe(`${ml(4229)}, today`);
    expect(tiles()).toEqual([
      [ml(1533), "a day"],
      ["3 of 6", "goal met"],
      [ml(2500), "best, Fri"],
    ]);
  });

  it("shows the days before the first log as no data in the week before", async () => {
    await boot();
    await openHistory();

    await click(button("Previous week"));

    expect(period()).toBe("Nov 9 to 15");
    expect(dayLabel("Mon, Nov 9")).toBe("no data");
    expect(dayLabel("Tue, Nov 10")).toBe(`${ml(2000)}, goal met`);
    expect(dayLabel("Sun, Nov 15")).toBe("0 ml, goal missed");
    expect(tiles()).toEqual([
      [ml(1017), "a day"],
      ["2 of 6", "goal met"],
      [ml(2300), "best, Fri"],
    ]);
  });

  it("steps back and forth, and › is disabled at the current week", async () => {
    await boot();
    await openHistory();
    const next = () => button("Next week") as HTMLButtonElement;
    expect(next().disabled).toBe(true);

    await click(button("Previous week"));
    expect(period()).toBe("Nov 9 to 15");
    expect(next().disabled).toBe(false);

    await click(button("Previous week"));
    expect(period()).toBe("Nov 2 to 8");
    expect(tiles()[0]).toEqual(["–", "a day"]);
    expect(tiles()[1]).toEqual(["0 of 0", "goal met"]);
    expect(tiles()[2]).toEqual(["–", "best day"]);

    await click(next());
    await click(next());
    expect(period()).toBe("Nov 16 to 22");
    expect(next().disabled).toBe(true);
  });

  it("lists when you drink and the drink mix", async () => {
    await boot();
    await openHistory();

    expect(t.screen.getByRole("heading", { name: "When you drink" })).toBeTruthy();
    expect(document.querySelectorAll(".hours i")).toHaveLength(24);
    expect([...document.querySelectorAll(".hours-axis span")].map((s) => s.textContent)).toEqual(["00", "06", "12", "18", "23"]);
    expect(document.querySelector(".hours i:nth-child(10)")!.classList.contains("zero")).toBe(false);
    expect(document.querySelector(".hours i:nth-child(4)")!.classList.contains("zero")).toBe(true);

    expect(t.screen.getByRole("heading", { name: "Drink mix" })).toBeTruthy();
    expect([...document.querySelectorAll(".mix li")].map((li) => li.textContent)).toEqual(["Water89%", "Coffee11%"]);
  });
});

describe("the day sheet", () => {
  it("opens from a bar with that day's drinks, newest first", async () => {
    await boot();
    await openHistory();

    await click(dayEl("Fri, Nov 20"));

    const sheet = dialog("Fri, Nov 20")!;
    expect(sheet).toBeTruthy();
    expect(sheet.querySelector(".day-total")!.textContent).toBe(`${ml(2500)}, 125%`);
    expect(sheetRows(sheet)).toEqual([`17:00Coffee${ml(1010)}${ml(1000)} water`, `09:00Water${ml(1500)}`]);
  });

  it("says so when the day has no drinks", async () => {
    await boot();
    await openHistory();

    await click(dayEl("Thu, Nov 19"));

    const sheet = dialog("Thu, Nov 19")!;
    expect(sheet.querySelector(".day-total")!.textContent).toBe("0 ml, 0%");
    expect(sheet.textContent).toContain("No drinks this day");
  });

  it("opens for today, and not for a day before the first log or one still to come", async () => {
    await boot();
    await openHistory();

    await click(dayEl("Sun, Nov 22"));
    expect(dialog("Sun, Nov 22")!.querySelector(".day-total")!.textContent).toBe(`${ml(1229)}, 61%`);
    await back();
    expect(dialog("Sun, Nov 22")).toBeNull();

    await click(radio("Month"));
    await click(dayEl("Mon, Nov 9"));
    await click(dayEl("Mon, Nov 23"));
    expect(t.screen.queryAllByRole("dialog")).toHaveLength(0);
  });

  it("closes on Back and leaves History open", async () => {
    await boot();
    await openHistory();
    await click(dayEl("Fri, Nov 20"));

    await back();

    expect(dialog("Fri, Nov 20")).toBeNull();
    expect(history_()).not.toBeNull();
  });

  it("edits a past drink, and the tiles and the sheet follow", async () => {
    await boot();
    await openHistory();
    await click(dayEl("Sat, Nov 21"));
    expect(dialog("Sat, Nov 21")!.querySelector(".day-total")!.textContent).toBe(`${ml(1000)}, 50%`);

    await click(t.within(dialog("Sat, Nov 21")!).getByRole("button", { name: /10:00/ }));
    const editor = dialog("Edit drink")!;
    t.fireEvent.input(t.within(editor).getByLabelText("Amount (ml)"), { target: { value: "2000" } });
    t.fireEvent.input(t.within(editor).getByLabelText("Time"), { target: { value: "11:30" } });
    await click(t.within(editor).getByRole("button", { name: "Save" }));

    expect(dialog("Edit drink")).toBeNull();
    const sheet = dialog("Sat, Nov 21")!;
    expect(sheet.querySelector(".day-total")!.textContent).toBe(`${ml(2000)}, 100%`);
    expect(sheetRows(sheet)).toEqual([`11:30Water${ml(2000)}`]);
    expect(dayLabel("Sat, Nov 21")).toBe(`${ml(2000)}, goal met`);
    expect(tiles()).toEqual([
      [ml(1700), "a day"],
      ["4 of 6", "goal met"],
      [ml(2500), "best, Fri"],
    ]);
  });

  it("deletes a drink from a past day and Undo brings it back", async () => {
    await boot();
    await openHistory();
    await click(dayEl("Sat, Nov 21"));
    await click(t.within(dialog("Sat, Nov 21")!).getByRole("button", { name: /10:00/ }));

    await click(t.within(dialog("Edit drink")!).getByRole("button", { name: "Delete" }));

    expect(dialog("Edit drink")).toBeNull();
    expect(dialog("Sat, Nov 21")!.textContent).toContain("No drinks this day");
    expect(dayLabel("Sat, Nov 21")).toBe("0 ml, goal missed");
    expect(t.screen.getByRole("status").textContent).toBe("Deleted 1000 ml WaterUndo");

    await click(t.screen.getByRole("button", { name: "Undo" }));

    expect(sheetRows(dialog("Sat, Nov 21")!)).toEqual([`10:00Water${ml(1000)}`]);
    expect(dayLabel("Sat, Nov 21")).toBe(`${ml(1000)}, goal missed`);
  });

  it("refetches when a drink is logged outside the screen", async () => {
    await boot();
    await openHistory();
    expect(dayLabel("Sun, Nov 22")).toBe(`${ml(1229)}, today`);

    (window as any).__sipFake.emitChanged();
    await settle();

    expect(dayLabel("Sun, Nov 22")).toBe(`${ml(1479)}, today`);
  });
});

describe("the month view", () => {
  it("shows the month's tiles with the current streak", async () => {
    await boot();
    await openHistory();

    await click(radio("Month"));

    expect(period()).toBe("November");
    expect(tiles()).toEqual([
      [ml(1275), "a day"],
      ["5 of 12", "goal met"],
      ["0 days", "in a row"],
    ]);
  });

  it("starts the grid on Monday, with a cell for each day", async () => {
    await boot();
    await openHistory();

    await click(radio("Month"));

    const cal = document.querySelector(".cal")!;
    expect([...cal.querySelectorAll(".dow")].map((e) => e.textContent).join("")).toBe("MTWTFSS");
    expect(cal.querySelectorAll(".cell")).toHaveLength(30);
    expect([...cal.children].slice(7, 13).some((c) => c.classList.contains("cell"))).toBe(false);
    expect(cal.children[13].textContent).toBe("1");
    expect(cal.children[13].getAttribute("aria-label")).toBe("Sun, Nov 1, no data");
  });

  it("marks met, missed, today, no data and future days", async () => {
    await boot();
    await openHistory();

    await click(radio("Month"));

    const state = (title: string) => dayEl(title).className.replace("cell ", "");
    expect(state("Sun, Nov 1")).toBe("nodata");
    expect(state("Mon, Nov 9")).toBe("nodata");
    expect(state("Tue, Nov 10")).toBe("met");
    expect(state("Wed, Nov 11")).toBe("missed");
    expect(state("Thu, Nov 12")).toBe("missed");
    expect(state("Fri, Nov 13")).toBe("met");
    expect(state("Sat, Nov 21")).toBe("missed");
    expect(state("Sun, Nov 22")).toBe("today");
    expect(state("Mon, Nov 23")).toBe("future");
    expect(dayLabel("Mon, Nov 9")).toBe("no data");
    expect(dayEl("Sun, Nov 22").textContent).toBe("22");
  });

  it("opens the day sheet from a cell", async () => {
    await boot();
    await openHistory();
    await click(radio("Month"));

    await click(dayEl("Fri, Nov 13"));

    expect(dialog("Fri, Nov 13")!.querySelector(".day-total")!.textContent).toBe(`${ml(2300)}, 115%`);
  });

  it("counts the run of met days ending yesterday", async () => {
    await boot(async () => {
      await twelveDays();
      await logAt(21, 12, 1000);
    });
    await openHistory();

    await click(radio("Month"));

    expect(tiles()[2]).toEqual(["2 days", "in a row"]);
  });

  it("adds today to the streak once it has reached the goal", async () => {
    await boot(async () => {
      await twelveDays();
      await logAt(21, 12, 1000);
      await logAt(22, 11, 800);
    });
    await openHistory();

    await click(radio("Month"));

    expect(tiles()[2]).toEqual(["3 days", "in a row"]);
  });

  it("steps by month, and › is disabled at the current month", async () => {
    await boot();
    await openHistory();
    await click(radio("Month"));
    const next = () => button("Next month") as HTMLButtonElement;
    expect(next().disabled).toBe(true);

    await click(button("Previous month"));

    expect(period()).toBe("October");
    expect(document.querySelectorAll(".cal .cell")).toHaveLength(31);
    expect(document.querySelectorAll(".cal .cell.nodata")).toHaveLength(31);
    expect(next().disabled).toBe(false);

    await click(next());
    expect(period()).toBe("November");
    expect(next().disabled).toBe(true);
  });

  it("returns to the current period when the view changes", async () => {
    await boot();
    await openHistory();
    await click(button("Previous week"));
    await click(button("Previous week"));

    await click(radio("Month"));

    expect(period()).toBe("November");
    expect(radio("Month").getAttribute("aria-checked")).toBe("true");
    expect(radio("Week").getAttribute("aria-checked")).toBe("false");
  });
});

describe("the year view", () => {
  it("shows twelve months with the best monthly average", async () => {
    await boot();
    await openHistory();

    await click(radio("Year"));

    expect(period()).toBe("2026");
    expect(tiles()).toEqual([
      [ml(1275), "a day"],
      ["5 of 12", "goal met"],
      [ml(1275), "best, November"],
    ]);
    expect(document.querySelectorAll(".history .slot")).toHaveLength(12);
    expect(dayLabel("November")).toBe(`${ml(1275)} a day, goal missed`);
    expect(dayLabel("October")).toBe("no data");
    expect(document.querySelectorAll(".history button.slot")).toHaveLength(0);
  });

  it("steps by year, and › is disabled at the current year", async () => {
    await boot();
    await openHistory();
    await click(radio("Year"));
    const next = () => button("Next year") as HTMLButtonElement;
    expect(next().disabled).toBe(true);

    await click(button("Previous year"));

    expect(period()).toBe("2025");
    expect(tiles()[2]).toEqual(["–", "best month"]);
    await click(next());
    expect(period()).toBe("2026");
  });
});
