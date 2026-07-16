import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";

import { getOfflineDb } from "./db";
import { bookmarkSearchBody } from "@karakeep/shared/offlineText";
import type { OfflineBookmarkRecord } from "./types";

function serializeBookmark(bookmark: ZBookmark) {
  return JSON.stringify(bookmark);
}

function parseBookmark(record: OfflineBookmarkRecord): ZBookmark {
  return zBookmarkSchema.parse(JSON.parse(record.dataJson));
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    [key],
  );
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string) {
  const db = await getOfflineDb();
  await db.runAsync(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

export async function reconcileLocalBookmark(
  localId: string,
  bookmark: ZBookmark,
) {
  const db = await getOfflineDb();
  await db.runAsync("DELETE FROM bookmarks WHERE id = ?", [localId]);
  await db.runAsync("DELETE FROM bookmark_search WHERE bookmark_id = ?", [
    localId,
  ]);
  await upsertBookmark(bookmark);
}

export async function upsertBookmark(
  bookmark: ZBookmark,
  opts?: { pendingSync?: boolean; localId?: string },
) {
  const db = await getOfflineDb();
  const id = opts?.localId ?? bookmark.id;
  await db.runAsync(
    `INSERT INTO bookmarks(
      id, server_id, data_json, created_at, modified_at, archived, favourited, deleted, pending_sync
    ) VALUES(?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(id) DO UPDATE SET
      server_id = excluded.server_id,
      data_json = excluded.data_json,
      modified_at = excluded.modified_at,
      archived = excluded.archived,
      favourited = excluded.favourited,
      pending_sync = excluded.pending_sync`,
    [
      id,
      bookmark.id,
      serializeBookmark({ ...bookmark, id: bookmark.id }),
      bookmark.createdAt.toISOString(),
      bookmark.modifiedAt?.toISOString() ?? null,
      bookmark.archived ? 1 : 0,
      bookmark.favourited ? 1 : 0,
      opts?.pendingSync ? 1 : 0,
    ],
  );
  await indexBookmark(id, bookmark);
}

export async function markBookmarkDeleted(id: string) {
  const db = await getOfflineDb();
  await db.runAsync(
    "UPDATE bookmarks SET deleted = 1, pending_sync = 1 WHERE id = ? OR server_id = ?",
    [id, id],
  );
  await db.runAsync("DELETE FROM bookmark_search WHERE bookmark_id = ?", [id]);
}

export async function getBookmarkById(id: string): Promise<ZBookmark | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<OfflineBookmarkRecord>(
    "SELECT * FROM bookmarks WHERE (id = ? OR server_id = ?) AND deleted = 0",
    [id, id],
  );
  return row ? parseBookmark(row) : null;
}

export interface BookmarkListQuery {
  archived?: boolean;
  favourited?: boolean;
  tagId?: string;
  listId?: string;
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export async function listBookmarks(
  query: BookmarkListQuery = {},
): Promise<ZBookmark[]> {
  const db = await getOfflineDb();
  const clauses = ["deleted = 0"];
  const params: (string | number)[] = [];

  if (query.archived !== undefined) {
    clauses.push("archived = ?");
    params.push(query.archived ? 1 : 0);
  }
  if (query.favourited !== undefined) {
    clauses.push("favourited = ?");
    params.push(query.favourited ? 1 : 0);
  }

  const sortOrder = query.sortOrder === "asc" ? "ASC" : "DESC";
  const limit = query.limit ?? 100;
  const offset = query.offset ?? 0;

  const rows = await db.getAllAsync<OfflineBookmarkRecord>(
    `SELECT * FROM bookmarks WHERE ${clauses.join(" AND ")} ORDER BY created_at ${sortOrder} LIMIT ? OFFSET ?`,
    [...params, limit, offset],
  );

  let bookmarks = rows.map(parseBookmark);

  if (query.tagId) {
    bookmarks = bookmarks.filter((b) =>
      b.tags.some((t) => t.id === query.tagId),
    );
  }

  if (query.listId) {
    const db = await getOfflineDb();
    const rows = await db.getAllAsync<{ bookmark_id: string }>(
      "SELECT bookmark_id FROM bookmark_lists WHERE list_id = ?",
      [query.listId],
    );
    const allowed = new Set(rows.map((row) => row.bookmark_id));
    bookmarks = bookmarks.filter((b) => allowed.has(b.id));
  }

  return bookmarks;
}

async function indexBookmark(localId: string, bookmark: ZBookmark) {
  const db = await getOfflineDb();
  const title = bookmark.title ?? "";
  const url =
    bookmark.content.type === "link" ? (bookmark.content.url ?? "") : "";
  const note = bookmark.note ?? "";
  const summary = bookmark.summary ?? "";
  const tags = bookmark.tags.map((t) => t.name).join(" ");
  const body = bookmarkSearchBody(bookmark);

  await db.runAsync("DELETE FROM bookmark_search WHERE bookmark_id = ?", [
    localId,
  ]);
  await db.runAsync(
    `INSERT INTO bookmark_search(
      bookmark_id, title, url, note, summary, tags, lists, body
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
    [localId, title, url, note, summary, tags, "", body],
  );
}

export async function getPendingSyncCount(): Promise<number> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM outbox",
  );
  return row?.count ?? 0;
}

export async function getCachedAssetUri(
  assetId: string,
): Promise<string | null> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ local_uri: string }>(
    "SELECT local_uri FROM cached_assets WHERE asset_id = ?",
    [assetId],
  );
  if (row?.local_uri) {
    await db.runAsync(
      "UPDATE cached_assets SET last_access_at = ? WHERE asset_id = ?",
      [new Date().toISOString(), assetId],
    );
  }
  return row?.local_uri ?? null;
}

export async function upsertCachedAsset(input: {
  assetId: string;
  bookmarkId?: string;
  localUri: string;
  contentType?: string;
  byteSize: number;
  pinned?: boolean;
}) {
  const db = await getOfflineDb();
  await db.runAsync(
    `INSERT INTO cached_assets(
      asset_id, bookmark_id, local_uri, content_type, byte_size, last_access_at, pinned
    ) VALUES(?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_id) DO UPDATE SET
      bookmark_id = excluded.bookmark_id,
      local_uri = excluded.local_uri,
      content_type = excluded.content_type,
      byte_size = excluded.byte_size,
      last_access_at = excluded.last_access_at,
      pinned = excluded.pinned`,
    [
      input.assetId,
      input.bookmarkId ?? null,
      input.localUri,
      input.contentType ?? null,
      input.byteSize,
      new Date().toISOString(),
      input.pinned ? 1 : 0,
    ],
  );
}

export async function getCachedAssetBytes(): Promise<number> {
  const db = await getOfflineDb();
  const row = await db.getFirstAsync<{ total: number }>(
    "SELECT COALESCE(SUM(byte_size), 0) as total FROM cached_assets",
  );
  return row?.total ?? 0;
}

export async function evictCachedAssets(maxBytes: number) {
  const db = await getOfflineDb();
  const total = await getCachedAssetBytes();
  if (total <= maxBytes) {
    return;
  }
  const rows = await db.getAllAsync<{ asset_id: string; byte_size: number }>(
    "SELECT asset_id, byte_size FROM cached_assets WHERE pinned = 0 ORDER BY last_access_at ASC",
  );
  let current = total;
  for (const row of rows) {
    if (current <= maxBytes) {
      break;
    }
    await db.runAsync("DELETE FROM cached_assets WHERE asset_id = ?", [
      row.asset_id,
    ]);
    current -= row.byte_size;
  }
}

export async function getBookmarkListIds(
  bookmarkId: string,
): Promise<string[]> {
  const db = await getOfflineDb();
  const rows = await db.getAllAsync<{ list_id: string }>(
    "SELECT list_id FROM bookmark_lists WHERE bookmark_id = ?",
    [bookmarkId],
  );
  return rows.map((row) => row.list_id);
}

export async function addBookmarkToListLocal(
  bookmarkId: string,
  listId: string,
) {
  const db = await getOfflineDb();
  await db.runAsync(
    "INSERT OR IGNORE INTO bookmark_lists(bookmark_id, list_id) VALUES(?, ?)",
    [bookmarkId, listId],
  );
}

export async function removeBookmarkFromListLocal(
  bookmarkId: string,
  listId: string,
) {
  const db = await getOfflineDb();
  await db.runAsync(
    "DELETE FROM bookmark_lists WHERE bookmark_id = ? AND list_id = ?",
    [bookmarkId, listId],
  );
}

export async function setBookmarkListIds(
  bookmarkId: string,
  listIds: string[],
) {
  const db = await getOfflineDb();
  await db.runAsync("DELETE FROM bookmark_lists WHERE bookmark_id = ?", [
    bookmarkId,
  ]);
  for (const listId of listIds) {
    await db.runAsync(
      "INSERT INTO bookmark_lists(bookmark_id, list_id) VALUES(?, ?)",
      [bookmarkId, listId],
    );
  }
}
