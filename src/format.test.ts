import { describe, expect, it } from "vitest";
import { dayTitle } from "./format";

describe("dayTitle", () => {
  it("titles a day with its weekday and date", () => {
    expect(dayTitle(new Date(2026, 10, 13).getTime())).toBe("Fri, Nov 13");
    expect(dayTitle(new Date(2026, 10, 15).getTime())).toBe("Sun, Nov 15");
  });
});
