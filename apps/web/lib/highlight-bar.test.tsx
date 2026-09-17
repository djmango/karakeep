// @vitest-environment jsdom
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import BookmarkHTMLHighlighter from "../../../packages/shared-react/components/BookmarkHtmlHighlighter";

// jsdom has no matchMedia, which the component reads to pick a menu style.
beforeAll(() => {
  const noop = () => undefined;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: noop,
      removeListener: noop,
      addEventListener: noop,
      removeEventListener: noop,
      dispatchEvent: () => false,
    }),
  });
});

/**
 * The mobile reader (variant="bar") must end a selection with a bar that stays
 * up until the reader closes it. The old popover was anchored at the selection,
 * which is where iOS draws its selection callout, and dismissed itself on the
 * first pointerdown outside: one tap that started by closing the callout read
 * as "outside" and threw the pending highlight away.
 */
describe("BookmarkHTMLHighlighter bottom bar", () => {
  const selectFirstTextNode = (content: HTMLElement) => {
    const text = content.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(text);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  it("opens on selection, drops the native selection, and saves the range", async () => {
    const onHighlight = vi.fn();
    const { container } = render(
      <BookmarkHTMLHighlighter
        htmlContent="<p>Hello world of highlighting</p>"
        variant="bar"
        onHighlight={onHighlight}
      />,
    );

    const content = container.querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    selectFirstTextNode(content);

    await act(async () => {
      fireEvent.pointerUp(content);
    });

    expect(screen.getByRole("toolbar")).toBeTruthy();
    // The selection is released so the iOS callout cannot cover the bar.
    expect(window.getSelection()?.rangeCount).toBe(0);

    // A tap that lands outside must not dismiss the bar.
    fireEvent.pointerDown(document.body);
    expect(screen.getByRole("toolbar")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));

    expect(onHighlight).toHaveBeenCalledTimes(1);
    const saved = onHighlight.mock.calls[0][0];
    expect(saved.startOffset).toBe(0);
    expect(saved.endOffset).toBe("Hello world of highlighting".length);
    expect(saved.text).toBe("Hello world of highlighting");
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("passes the chosen colour and note to the save callback", async () => {
    const onHighlight = vi.fn();
    const { container } = render(
      <BookmarkHTMLHighlighter
        htmlContent="<p>Hello world of highlighting</p>"
        variant="bar"
        onHighlight={onHighlight}
      />,
    );

    const content = container.querySelector(
      '[role="presentation"]',
    ) as HTMLElement;
    selectFirstTextNode(content);
    await act(async () => {
      fireEvent.pointerUp(content);
    });

    fireEvent.click(screen.getByRole("button", { name: "Blue" }));
    fireEvent.click(screen.getByRole("button", { name: "Note" }));
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "grounded in the DOM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Highlight" }));

    const saved = onHighlight.mock.calls[0][0];
    expect(saved.color).toBe("blue");
    expect(saved.note).toBe("grounded in the DOM");
  });
});
