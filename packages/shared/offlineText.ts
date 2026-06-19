export function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function bookmarkSearchBody(bookmark: {
  title?: string | null;
  note?: string | null;
  summary?: string | null;
  content: {
    type: string;
    url?: string;
    text?: string;
    htmlContent?: string | null;
  };
}): string {
  const parts = [
    bookmark.title ?? "",
    bookmark.note ?? "",
    bookmark.summary ?? "",
  ];
  if (bookmark.content.type === "link") {
    parts.push(bookmark.content.url ?? "");
    if (bookmark.content.htmlContent) {
      parts.push(stripHtmlToText(bookmark.content.htmlContent));
    }
  } else if (bookmark.content.type === "text") {
    parts.push(bookmark.content.text ?? "");
  }
  return parts.filter(Boolean).join("\n");
}
