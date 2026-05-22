import { describe, it, expect } from "vitest";
import { resolveDate } from "../src/utils/dates.js";

describe("resolveDate", () => {
  // Fixed date: Thursday, May 21, 2026 at noon UTC
  const fixedNow = new Date("2026-05-21T12:00:00Z");

  describe("ISO date passthrough", () => {
    it("should return ISO dates as-is", () => {
      const result = resolveDate("2026-05-24", fixedNow);
      expect(result).toEqual({
        date: "2026-05-24",
        ambiguous: false,
        interpretation: "2026-05-24",
      });
    });

    it("should handle different ISO dates", () => {
      const result = resolveDate("2025-12-25", fixedNow);
      expect(result).toEqual({
        date: "2025-12-25",
        ambiguous: false,
        interpretation: "2025-12-25",
      });
    });
  });

  describe("simple relative dates", () => {
    it("should handle today", () => {
      const result = resolveDate("today", fixedNow);
      expect(result.date).toBe("2026-05-21");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("today → 2026-05-21");
    });

    it("should handle tomorrow", () => {
      const result = resolveDate("tomorrow", fixedNow);
      expect(result.date).toBe("2026-05-22");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("tomorrow → 2026-05-22");
    });

    it("should handle yesterday", () => {
      const result = resolveDate("yesterday", fixedNow);
      expect(result.date).toBe("2026-05-20");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("yesterday → 2026-05-20");
    });
  });

  describe("this weekday", () => {
    it("should handle 'this Sunday' from Thursday (upcoming Sunday)", () => {
      const result = resolveDate("this Sunday", fixedNow);
      expect(result.date).toBe("2026-05-24"); // Sunday of current week
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this sunday → 2026-05-24");
    });

    it("should handle 'this Sunday' when now IS Sunday (returns today)", () => {
      const sunday = new Date("2026-05-24T12:00:00Z");
      const result = resolveDate("this Sunday", sunday);
      expect(result.date).toBe("2026-05-24");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this sunday → 2026-05-24");
    });

    it("should handle 'this Monday' from Thursday (current week Monday)", () => {
      const result = resolveDate("this Monday", fixedNow);
      expect(result.date).toBe("2026-05-25"); // Monday of current week (next Monday since Thursday is past this week's Monday)
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this monday → 2026-05-25");
    });

    it("should handle weekday abbreviations", () => {
      const result = resolveDate("this sun", fixedNow);
      expect(result.date).toBe("2026-05-24");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this sun → 2026-05-24");
    });
  });

  describe("next weekday", () => {
    it("should handle 'next Monday' returning 7+ days out", () => {
      const result = resolveDate("next Monday", fixedNow);
      expect(result.date).toBe("2026-06-01"); // Monday of following week
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("next monday → 2026-06-01");
    });

    it("should handle 'next Sunday' from Thursday", () => {
      const result = resolveDate("next Sunday", fixedNow);
      expect(result.date).toBe("2026-05-31"); // Sunday of following week
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("next sunday → 2026-05-31");
    });

    it("should handle 'next Sunday' even when now IS Sunday", () => {
      const sunday = new Date("2026-05-24T12:00:00Z"); // The actual Sunday
      const result = resolveDate("next Sunday", sunday);
      expect(result.date).toBe("2026-05-31"); // Following Sunday
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("next sunday → 2026-05-31");
    });
  });

  describe("week ranges", () => {
    it("should handle 'this week' range Monday-Sunday", () => {
      const result = resolveDate("this week", fixedNow);
      expect(result.date).toBeUndefined();
      expect(result.range).toEqual({
        start: "2026-05-18", // Monday of current week
        end: "2026-05-24", // Sunday of current week
      });
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this week → 2026-05-18 to 2026-05-24");
    });

    it("should handle 'next week' range", () => {
      const result = resolveDate("next week", fixedNow);
      expect(result.date).toBeUndefined();
      expect(result.range).toEqual({
        start: "2026-05-25", // Monday of next week
        end: "2026-05-31", // Sunday of next week
      });
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("next week → 2026-05-25 to 2026-05-31");
    });
  });

  describe("case insensitivity and whitespace", () => {
    it("should handle 'THIS SUNDAY'", () => {
      const result = resolveDate("THIS SUNDAY", fixedNow);
      expect(result.date).toBe("2026-05-24");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this sunday → 2026-05-24");
    });

    it("should handle whitespace around input", () => {
      const result = resolveDate("  this friday  ", fixedNow);
      expect(result.date).toBe("2026-05-22");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("this friday → 2026-05-22");
    });

    it("should handle mixed case", () => {
      const result = resolveDate("Next Wednesday", fixedNow);
      expect(result.date).toBe("2026-06-03");
      expect(result.ambiguous).toBe(false);
      expect(result.interpretation).toBe("next wednesday → 2026-06-03");
    });
  });

  describe("error handling", () => {
    it("should mark garbage input as ambiguous", () => {
      const result = resolveDate("foobar", fixedNow);
      expect(result.date).toBeUndefined();
      expect(result.range).toBeUndefined();
      expect(result.ambiguous).toBe(true);
      expect(result.interpretation).toBe(
        "Could not parse 'foobar'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.",
      );
    });

    it("should handle invalid weekday names", () => {
      const result = resolveDate("this blurday", fixedNow);
      expect(result.ambiguous).toBe(true);
      expect(result.interpretation).toBe(
        "Could not parse 'this blurday'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.",
      );
    });

    it("should handle malformed weekday syntax", () => {
      const result = resolveDate("this", fixedNow);
      expect(result.ambiguous).toBe(true);
      expect(result.interpretation).toBe(
        "Could not parse 'this'. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.",
      );
    });

    it("should handle empty string", () => {
      const result = resolveDate("", fixedNow);
      expect(result.ambiguous).toBe(true);
      expect(result.interpretation).toBe(
        "Could not parse ''. Try ISO format YYYY-MM-DD or phrases like 'this Sunday'.",
      );
    });
  });

  describe("edge cases", () => {
    it("should handle all weekday names", () => {
      const weekdays = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];
      for (const weekday of weekdays) {
        const result = resolveDate(`this ${weekday}`, fixedNow);
        expect(result.ambiguous).toBe(false);
        expect(result.date).toBeDefined();
      }
    });

    it("should handle all weekday abbreviations", () => {
      const abbrevs = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
      for (const abbrev of abbrevs) {
        const result = resolveDate(`next ${abbrev}`, fixedNow);
        expect(result.ambiguous).toBe(false);
        expect(result.date).toBeDefined();
      }
    });
  });
});
