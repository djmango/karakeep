import { describe, expect, test } from "vitest";

import { bookmarkSearchBody, stripHtmlToText } from "./offlineText";

describe("offlineText", () => {
  test("stripHtmlToText removes scripts and tags", () => {
    const html =
      "<html><head><script>alert(1)</script></head><body><p>Hello <b>world</b></p></body></html>";
    expect(stripHtmlToText(html)).toBe("Hello world");
  });

  test("bookmarkSearchBody includes reader text", () => {
    const body = bookmarkSearchBody({
      title: "Example",
      note: null,
      summary: "Summary",
      content: {
        type: "link",
        url: "https://example.com",
        htmlContent: "<p>Reader body</p>",
      },
    });
    expect(body).toContain("Example");
    expect(body).toContain("Reader body");
    expect(body).toContain("https://example.com");
  });
});
