import { getOfflineDb } from "./db";
import type { OfflineSearchResult } from "./types";

export async function searchOfflineBookmarks(
  query: string,
  limit = 50,
): Promise<OfflineSearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) {
    return [];
  }

  const db = await getOfflineDb();
  const like = `%${trimmed.replaceAll("%", "").replaceAll("_", "")}%`;

  const rows = await db.getAllAsync<{
    bookmark_id: string;
  }>(
    `SELECT bookmark_id
     FROM bookmark_search
     WHERE title LIKE ? ESCAPE '\\'
        OR url LIKE ? ESCAPE '\\'
        OR note LIKE ? ESCAPE '\\'
        OR summary LIKE ? ESCAPE '\\'
        OR tags LIKE ? ESCAPE '\\'
        OR body LIKE ? ESCAPE '\\'
     LIMIT ?`,
    [like, like, like, like, like, like, limit],
  );

  const results: OfflineSearchResult[] = [];
  for (const row of rows) {
    const bookmarkRow = await db.getFirstAsync<{ data_json: string }>(
      "SELECT data_json FROM bookmarks WHERE id = ? AND deleted = 0",
      [row.bookmark_id],
    );
    if (!bookmarkRow) {
      continue;
    }
    let bookmark;
    try {
      const { hydrateBookmark } = await import("./bookmarkCodec");
      bookmark = hydrateBookmark(JSON.parse(bookmarkRow.data_json));
    } catch {
      continue;
    }
    results.push({
      bookmark,
      score: 0,
      missingAssets: false,
    });
  }

  return results;
}
