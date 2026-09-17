// @vitest-environment jsdom
import React from "react";
import { act, render } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import ScrollProgressTracker from "../../../packages/shared-react/components/ScrollProgressTracker";

/**
 * Reopening a bookmark used to jump to the top of the article. The restore ran
 * once, before the article's HTML, fonts and images had made the document tall
 * enough to hold the saved offset, so the scroll either landed nowhere or far
 * short of the saved paragraph, and nothing tried again. These tests pin the
 * replacement behaviour: keep trying while the document fills in, then report
 * the outcome so the caller can offer "continue reading" when it never lands.
 */
const ANCHOR =
  "The paragraph the reader stopped at, long enough to be used as an anchor";

/** jsdom reports zero rects for everything, so the tests supply the geometry. */
const rect = (top: number) =>
  ({
    top,
    left: 0,
    right: 0,
    bottom: top,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }) as DOMRect;

/** How far the restored paragraph sits below the top of the viewport. */
let paragraphTop = 0;

beforeAll(() => {
  // jsdom implements neither of these.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.getBoundingClientRect = function (this: Element) {
    return rect(
      (this.textContent ?? "").includes(ANCHOR.slice(0, 20)) ? paragraphTop : 0,
    );
  };

  // Run the first attempt on the timer queue so fake timers control it.
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    setTimeout(() => cb(0), 0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => undefined);
});

beforeEach(() => {
  paragraphTop = 0;
  vi.clearAllMocks();
  // Keep the stubbed requestAnimationFrame (a 0ms timeout) deterministic
  // instead of letting fake timers replace it with a 16ms frame clock.
  vi.useFakeTimers({
    toFake: [
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
      "Date",
    ],
  });
  return () => vi.useRealTimers();
});

const renderTracker = (props: {
  offset: number;
  anchor?: string | null;
  percent?: number | null;
  body?: React.ReactNode;
  onRestoreResult: (restored: boolean) => void;
}) =>
  render(
    <ScrollProgressTracker
      restorePosition
      readingProgressOffset={props.offset}
      readingProgressAnchor={props.anchor ?? null}
      readingProgressPercent={props.percent ?? null}
      onRestoreResult={props.onRestoreResult}
    >
      {props.body ?? <p>{ANCHOR}</p>}
    </ScrollProgressTracker>,
  );

describe("restoring the reading position", () => {
  it("retries until the paragraph can actually reach the top", async () => {
    // The document is still short: scrolling to the paragraph leaves it 400px
    // down the page, which is not where the reader left off.
    paragraphTop = 400;
    const onRestoreResult = vi.fn();
    renderTracker({
      offset: 5000,
      anchor: ANCHOR,
      percent: 42,
      onRestoreResult,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(onRestoreResult).not.toHaveBeenCalled();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    // The rest of the article arrives and the document grows.
    paragraphTop = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });

    expect(onRestoreResult).toHaveBeenCalledWith(true);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("reports failure when the saved paragraph is no longer in the article", async () => {
    const onRestoreResult = vi.fn();
    renderTracker({
      offset: 5000,
      anchor: "A paragraph that this article no longer contains",
      percent: 42,
      body: <p>A completely different article</p>,
      onRestoreResult,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });

    expect(onRestoreResult).toHaveBeenCalledTimes(1);
    expect(onRestoreResult).toHaveBeenCalledWith(false);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it("stops moving the page once the reader starts scrolling", async () => {
    paragraphTop = 400;
    const onRestoreResult = vi.fn();
    renderTracker({
      offset: 5000,
      anchor: ANCHOR,
      percent: 42,
      onRestoreResult,
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new Event("touchstart"));
      await vi.advanceTimersByTimeAsync(30_000);
    });

    // No further attempts, and no failure report either: the reader took over.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(onRestoreResult).not.toHaveBeenCalled();
  });
});
