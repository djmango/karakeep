import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";

function asDate(value: unknown): Date | unknown {
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return value;
}

/** Revive ISO date strings from JSON / tRPC into Date objects for zod. */
export function reviveBookmarkDates(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const obj = { ...(raw as Record<string, unknown>) };
  obj.createdAt = asDate(obj.createdAt);
  if (obj.modifiedAt != null) {
    obj.modifiedAt = asDate(obj.modifiedAt);
  }

  if (obj.content && typeof obj.content === "object") {
    const content = { ...(obj.content as Record<string, unknown>) };
    for (const key of ["crawledAt", "datePublished", "dateModified"] as const) {
      if (content[key] != null) {
        content[key] = asDate(content[key]);
      }
    }
    obj.content = content;
  }

  return obj;
}

export function hydrateBookmark(raw: unknown): ZBookmark {
  const parsed = zBookmarkSchema.parse(reviveBookmarkDates(raw));
  return parsed;
}
