"use dom";

import "@/globals.css";

import { useEffect } from "react";

import type { Highlight } from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import BookmarkHTMLHighlighter from "@karakeep/shared-react/components/BookmarkHtmlHighlighter";
import ScrollProgressTracker from "@karakeep/shared-react/components/ScrollProgressTracker";

function assetIdFromSrc(src: string | null | undefined): string | null {
  if (!src) {
    return null;
  }
  const match = src.match(/\/api\/assets\/([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

export default function BookmarkHtmlHighlighterDom({
  htmlContent,
  contentStyle,
  highlights,
  readOnly,
  onHighlight,
  onUpdateHighlight,
  onDeleteHighlight,
  onLinkPress,
  onImagePress,
  readingProgressOffset,
  readingProgressAnchor,
  restoreReadingPosition,
  onSavePosition,
  onScrollPositionChange,
  assetAuth,
}: {
  htmlContent: string;
  contentStyle?: React.CSSProperties;
  highlights?: Highlight[];
  readOnly?: boolean;
  onHighlight?: (highlight: Highlight) => void;
  onUpdateHighlight?: (highlight: Highlight) => void;
  onDeleteHighlight?: (highlight: Highlight) => void;
  onLinkPress?: (url: string) => void;
  onImagePress?: (src: string) => void;
  readingProgressOffset?: number | null;
  readingProgressAnchor?: string | null;
  restoreReadingPosition?: boolean;
  onSavePosition?: (position: {
    offset: number;
    anchor: string;
    percent: number;
  }) => void;
  onScrollPositionChange?: (position: {
    offset: number;
    anchor: string;
    percent: number;
  }) => void;
  /**
   * Reader HTML rewrites images to `/api/assets/...`, which cannot send a
   * Bearer token from an <img>. Hydrate those with authenticated fetch.
   */
  assetAuth?: {
    serverAddress: string;
    headers: Record<string, string>;
  };
  dom?: import("expo/dom").DOMProps;
}) {
  // Strip href from links so the browser treats them as regular selectable text
  // instead of activating native link gestures (iOS preview, Android drag).
  // The URL is preserved in data-href for our click handler.
  useEffect(() => {
    const stripHrefs = () => {
      document.querySelectorAll("a[href]").forEach((a) => {
        const anchor = a as HTMLAnchorElement;
        if (!anchor.dataset.href) {
          anchor.dataset.href = anchor.getAttribute("href")!;
          anchor.removeAttribute("href");
        }
      });
    };

    stripHrefs();

    // Re-strip if the DOM changes (e.g. highlight effects re-render content)
    const observer = new MutationObserver(stripHrefs);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, []);

  // Intercept link and image clicks to open them externally
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Don't intercept if the user is selecting text (for highlighting)
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }

      // Check for link clicks (href is stored in data-href)
      const anchor = target.closest("a");
      const href = anchor?.dataset.href;
      if (href) {
        // Allow in-page anchor links
        if (href.startsWith("#")) {
          const targetEl = document.querySelector(href);
          if (targetEl) {
            targetEl.scrollIntoView();
          }
          return;
        }
        // Ignore javascript: URLs
        if (href.startsWith("javascript:")) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        onLinkPress?.(href);
        return;
      }

      // Check for image clicks
      const img = target.closest("img");
      if (img?.src) {
        e.preventDefault();
        onImagePress?.(img.src);
        return;
      }
    };

    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, [onLinkPress, onImagePress]);

  // Hydrate /api/assets/... images with authenticated fetches (Bearer token).
  // Plain <img src="/api/assets/..."> cannot attach Authorization headers, so
  // they render as grey broken placeholders in the Expo DOM reader.
  useEffect(() => {
    if (!assetAuth?.serverAddress) {
      return;
    }

    const objectUrls: string[] = [];
    let cancelled = false;
    const inFlight = new WeakSet<HTMLImageElement>();

    const hydrateImg = async (img: HTMLImageElement) => {
      const src = img.getAttribute("src") ?? "";
      if (
        src.startsWith("blob:") ||
        src.startsWith("data:") ||
        inFlight.has(img)
      ) {
        return;
      }
      const assetId = assetIdFromSrc(src);
      if (!assetId) {
        return;
      }
      inFlight.add(img);
      try {
        const response = await fetch(
          `${assetAuth.serverAddress}/api/assets/${assetId}`,
          { headers: assetAuth.headers },
        );
        if (!response.ok || cancelled) {
          inFlight.delete(img);
          return;
        }
        const blob = await response.blob();
        if (cancelled) {
          return;
        }
        const objectUrl = URL.createObjectURL(blob);
        objectUrls.push(objectUrl);
        img.src = objectUrl;
      } catch {
        inFlight.delete(img);
        // Best effort; leave the broken image if fetch fails (offline).
      }
    };

    const hydrate = () => {
      document.querySelectorAll("img").forEach((img) => {
        void hydrateImg(img);
      });
    };

    void hydrate();

    // Re-run when highlight/DOM mutations reinsert original HTML.
    const observer = new MutationObserver(() => {
      hydrate();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      cancelled = true;
      observer.disconnect();
      for (const url of objectUrls) {
        URL.revokeObjectURL(url);
      }
    };
  }, [assetAuth, htmlContent]);

  return (
    <div style={{ maxWidth: "100vw", overflowX: "hidden" }}>
      <ScrollProgressTracker
        onSavePosition={onSavePosition}
        onScrollPositionChange={onScrollPositionChange}
        restorePosition={restoreReadingPosition}
        readingProgressOffset={readingProgressOffset}
        readingProgressAnchor={readingProgressAnchor}
        showProgressBar
        progressBarStyle={{ position: "fixed" }}
      >
        <BookmarkHTMLHighlighter
          htmlContent={htmlContent}
          highlights={highlights}
          readOnly={readOnly}
          onHighlight={onHighlight}
          onUpdateHighlight={onUpdateHighlight}
          onDeleteHighlight={onDeleteHighlight}
          style={contentStyle}
        />
      </ScrollProgressTracker>
    </div>
  );
}
