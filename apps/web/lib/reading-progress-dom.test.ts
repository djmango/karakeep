// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  scrollToReadingPosition,
  shouldResumeReading,
} from "../../../packages/shared/utils/reading-progress-dom";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * A restore can only be trusted once the paragraph it aimed at is actually at
 * the top of the page, so the caller needs the element back, not a bare "done".
 */
describe("scrollToReadingPosition", () => {
  const content = () => {
    const container = document.createElement("div");
    container.innerHTML =
      "<p>one two three</p><p>four five six</p><p>seven eight nine</p>";
    return container;
  };

  it("returns the paragraph it scrolled to by anchor", () => {
    const container = content();
    const target = scrollToReadingPosition(
      container,
      20,
      "auto",
      "four five six",
    );

    expect(target?.textContent).toBe("four five six");
    expect(container.children[1]).toBe(target);
  });

  it("returns the paragraph it scrolled to by offset", () => {
    const container = content();
    const target = scrollToReadingPosition(container, 20, "auto", null);

    expect(target?.textContent).toBe("four five six");
  });

  it("returns null when no position matches, so the caller can retry", () => {
    const container = content();

    expect(scrollToReadingPosition(container, 0, "auto", null)).toBeNull();
    expect(scrollToReadingPosition(container, 9999, "auto", null)).toBeNull();
    expect(
      scrollToReadingPosition(container, 9999, "auto", "not in this article"),
    ).toBeNull();
  });

  it("falls back to the offset when the anchor is gone", () => {
    // The anchor is only a hint: an article that was edited keeps its position.
    const container = content();
    const target = scrollToReadingPosition(
      container,
      20,
      "auto",
      "a paragraph that was reworded",
    );

    expect(target?.textContent).toBe("four five six");
  });
});

describe("shouldResumeReading", () => {
  it("resumes a position away from the start and the end", () => {
    expect(shouldResumeReading(1200, 42)).toBe(true);
    expect(shouldResumeReading(50, 4)).toBe(true);
  });

  it("stays at the top for a finished or barely started article", () => {
    expect(shouldResumeReading(50_000, 97)).toBe(false);
    expect(shouldResumeReading(20, 1)).toBe(false);
    expect(shouldResumeReading(0, 20)).toBe(false);
  });

  it("stays at the top when nothing is saved", () => {
    expect(shouldResumeReading(null, null)).toBe(false);
    expect(shouldResumeReading(null, 42)).toBe(false);
    expect(shouldResumeReading(1200, null)).toBe(false);
  });
});
