import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

import type { ReadingPosition } from "@karakeep/shared/utils/reading-progress-dom";
import {
  findScrollableParent,
  getReadingPosition,
  SCROLL_THROTTLE_MS,
  scrollToReadingPosition,
} from "@karakeep/shared/utils/reading-progress-dom";

/** Delay after the last scroll event before reporting position (milliseconds) */
const IDLE_SAVE_DELAY_MS = 5000;

/** Delay after the last scroll event before hiding the progress bar (milliseconds) */
const PROGRESS_BAR_HIDE_DELAY_MS = 2000;

interface ScrollProgressTrackerProps {
  /** Called lazily on intent signals (idle, visibility change, beforeunload, unmount) — use for persisting position */
  onSavePosition?: (position: ReadingPosition) => void;
  /** Called on every throttled scroll — use for responsive UI (banner dismissal, etc.) */
  onScrollPositionChange?: (position: ReadingPosition) => void;
  /** When set to true, scrolls to the saved reading position */
  restorePosition?: boolean;
  readingProgressOffset?: number | null;
  readingProgressAnchor?: string | null;
  /** Progress through the article, used to verify a restore near the end. */
  readingProgressPercent?: number | null;
  /**
   * Reports whether the restore landed. The content (and its images) can still
   * be loading when a restore is asked for, so the caller needs to know when it
   * could not be applied and has to fall back to asking the reader.
   */
  onRestoreResult?: (restored: boolean) => void;
  /** Show a Medium-style reading progress bar at the top */
  showProgressBar?: boolean;
  /** Custom styles for the progress bar container (e.g. positioning overrides) */
  progressBarStyle?: React.CSSProperties;
  children: React.ReactNode;
}

/**
 * Backoff for restore attempts. The first attempt is immediate; the rest cover
 * an article whose HTML, fonts and images are still arriving, because scrolling
 * a document that is shorter than the saved position only lands part way.
 */
const RESTORE_ATTEMPT_DELAYS_MS = [0, 150, 400, 900, 1800, 3000, 5000, 8000];

/** How close to the top of the viewport a restored paragraph has to land. */
const RESTORE_TOP_TOLERANCE_PX = 8;

/** Above this percentage the page may be unable to scroll the target to the top. */
const RESTORE_BOTTOM_PERCENT = 90;

/**
 * Whether a restored paragraph actually landed. A document that is still
 * loading cannot scroll the target all the way up, which is exactly the case
 * that used to leave readers at the top; near the end of an article the page
 * cannot reach the top at all, so being at the maximum offset counts.
 */
function isAtRestoredPosition(
  container: HTMLElement,
  target: HTMLElement,
  percent: number | null | undefined,
): boolean {
  const scroller = findScrollableParent(container);
  const isWindowScroll = scroller === document.documentElement;
  const viewportTop = isWindowScroll ? 0 : scroller.getBoundingClientRect().top;

  if (
    Math.abs(target.getBoundingClientRect().top - viewportTop) <=
    RESTORE_TOP_TOLERANCE_PX
  ) {
    return true;
  }

  if (percent == null || percent < RESTORE_BOTTOM_PERCENT) {
    return false;
  }

  const scrollTop = isWindowScroll ? window.scrollY : scroller.scrollTop;
  const scrollHeight = isWindowScroll
    ? document.body.scrollHeight
    : scroller.scrollHeight;
  const clientHeight = isWindowScroll
    ? window.innerHeight
    : scroller.clientHeight;
  return scrollTop + clientHeight >= scrollHeight - 1;
}

/**
 * Wraps content and tracks scroll progress, reporting position changes
 * lazily (idle after scrolling, visibility change, beforeunload, unmount).
 * Can also restore a previously saved reading position.
 */
const ScrollProgressTracker = forwardRef<
  HTMLDivElement,
  ScrollProgressTrackerProps
>(function ScrollProgressTracker(
  {
    onSavePosition,
    onScrollPositionChange,
    restorePosition,
    readingProgressOffset,
    readingProgressAnchor,
    readingProgressPercent,
    onRestoreResult,
    showProgressBar,
    progressBarStyle,
    children,
  },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => containerRef.current!, []);
  const [scrollPercent, setScrollPercent] = useState(0);
  const [progressBarVisible, setProgressBarVisible] = useState(false);
  const latestPositionRef = useRef<ReadingPosition | null>(null);

  const onSavePositionRef = useRef(onSavePosition);
  const onScrollPositionChangeRef = useRef(onScrollPositionChange);
  const onRestoreResultRef = useRef(onRestoreResult);
  useEffect(() => {
    onSavePositionRef.current = onSavePosition;
    onScrollPositionChangeRef.current = onScrollPositionChange;
    onRestoreResultRef.current = onRestoreResult;
  });

  // Restore reading position when triggered. The article's HTML, fonts and
  // images arrive after mount, so one attempt can scroll a document that is
  // still shorter than the saved position and leave the reader near the top.
  // Keep trying on a backoff until the paragraph actually lands, and let the
  // caller know when it never did.
  const hasRestoredRef = useRef(false);
  useEffect(() => {
    if (
      !restorePosition ||
      hasRestoredRef.current ||
      !readingProgressOffset ||
      readingProgressOffset <= 0
    ) {
      return;
    }

    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;

    const attemptRestore = () => {
      if (cancelled) return;
      const container = containerRef.current;
      if (!container) return;

      const target = scrollToReadingPosition(
        container,
        readingProgressOffset,
        attempt === 0 ? "smooth" : "auto",
        readingProgressAnchor,
      );

      if (
        target &&
        isAtRestoredPosition(container, target, readingProgressPercent)
      ) {
        hasRestoredRef.current = true;
        onRestoreResultRef.current?.(true);
        return;
      }

      attempt += 1;
      if (attempt < RESTORE_ATTEMPT_DELAYS_MS.length) {
        timerId = setTimeout(
          attemptRestore,
          RESTORE_ATTEMPT_DELAYS_MS[attempt],
        );
      } else {
        // Leave hasRestoredRef false so an explicit "continue reading" can try
        // again once more of the article has loaded.
        onRestoreResultRef.current?.(false);
      }
    };

    // A reader who starts scrolling has taken over; stop moving the page.
    const cancel = () => {
      cancelled = true;
      if (timerId) clearTimeout(timerId);
    };
    const cancelEvents = ["touchstart", "wheel", "keydown"] as const;
    cancelEvents.forEach((event) =>
      window.addEventListener(event, cancel, { passive: true, once: true }),
    );
    const rafId = requestAnimationFrame(attemptRestore);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      if (timerId) clearTimeout(timerId);
      cancelEvents.forEach((event) =>
        window.removeEventListener(event, cancel),
      );
    };
  }, [
    restorePosition,
    readingProgressOffset,
    readingProgressAnchor,
    readingProgressPercent,
  ]);

  // Scroll tracking — updates the progress bar on every scroll,
  // but only reports position lazily via an idle timer.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let lastScrollTime = 0;
    let idleTimerId: ReturnType<typeof setTimeout> | null = null;
    let hideBarTimerId: ReturnType<typeof setTimeout> | null = null;
    let trailingTimerId: ReturnType<typeof setTimeout> | null = null;

    const reportLatestPosition = () => {
      const pos = latestPositionRef.current;
      if (pos && pos.offset > 0 && onSavePositionRef.current) {
        onSavePositionRef.current(pos);
      }
    };

    const processScroll = () => {
      lastScrollTime = Date.now();

      const position = getReadingPosition(container);
      if (position) {
        setScrollPercent(position.percent);
        latestPositionRef.current = position;
        if (onScrollPositionChangeRef.current) {
          onScrollPositionChangeRef.current(position);
        }
      }

      // Show progress bar on scroll, hide after idle
      setProgressBarVisible(true);
      if (hideBarTimerId) clearTimeout(hideBarTimerId);
      hideBarTimerId = setTimeout(
        () => setProgressBarVisible(false),
        PROGRESS_BAR_HIDE_DELAY_MS,
      );

      // Reset idle timer — report position after scrolling stops
      if (idleTimerId) clearTimeout(idleTimerId);
      idleTimerId = setTimeout(reportLatestPosition, IDLE_SAVE_DELAY_MS);
    };

    const handleScroll = () => {
      const now = Date.now();
      if (now - lastScrollTime < SCROLL_THROTTLE_MS) {
        // Schedule a trailing call so the last scroll event is never lost
        if (!trailingTimerId) {
          trailingTimerId = setTimeout(() => {
            trailingTimerId = null;
            processScroll();
          }, SCROLL_THROTTLE_MS);
        }
        return;
      }
      processScroll();
    };

    const scrollParent = findScrollableParent(container);
    const isWindowScroll = scrollParent === document.documentElement;
    const target: HTMLElement | Window = isWindowScroll ? window : scrollParent;

    target.addEventListener("scroll", handleScroll, { passive: true });

    return () => {
      target.removeEventListener("scroll", handleScroll);
      if (idleTimerId) clearTimeout(idleTimerId);
      if (hideBarTimerId) clearTimeout(hideBarTimerId);
      if (trailingTimerId) clearTimeout(trailingTimerId);
    };
  }, []);

  // Report position on visibility change, beforeunload, and unmount
  useEffect(() => {
    const reportPosition = () => {
      const pos = latestPositionRef.current;
      if (pos && pos.offset > 0 && onSavePositionRef.current) {
        onSavePositionRef.current(pos);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        reportPosition();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("beforeunload", reportPosition);

    return () => {
      reportPosition();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("beforeunload", reportPosition);
    };
  }, []);

  return (
    <div ref={containerRef}>
      {showProgressBar && (
        <div
          style={{
            position: "sticky",
            top: 0,
            left: 0,
            right: 0,
            height: 3,
            zIndex: 50,
            backgroundColor: "transparent",
            opacity: progressBarVisible ? 1 : 0,
            transition: "opacity 300ms ease-out",
            ...progressBarStyle,
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${scrollPercent}%`,
              backgroundColor: "rgb(249, 115, 22)",
              transition: "width 150ms ease-out",
            }}
          />
        </div>
      )}
      {children}
    </div>
  );
});

export default ScrollProgressTracker;
