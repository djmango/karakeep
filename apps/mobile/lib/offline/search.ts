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
  const ftsQuery = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', "")}"*`)
    .join(" ");

  const rows = await db.getAllAsync<{
    bookmark_id: string;
    rank: number;
  }>(
    `SELECT bookmark_id, rank
     FROM bookmark_search
     WHERE bookmark_search MATCH ?
     ORDER BY rank
     LIMIT ?`,
    [ftsQuery, limit],
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
      score: row.rank,
      missingAssets: false,
    });
  }

  return results;
}
