import * as SQLite from "expo-sqlite";

const DB_NAME = "karakeep-offline.db";
const SEARCH_SCHEMA_VERSION = "2"; // regular table; v1 was FTS5 (crashes on close)

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const BASE_SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY NOT NULL,
  server_id TEXT,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  modified_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  favourited INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  pending_sync INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS bookmarks_created_at_idx ON bookmarks(created_at DESC);
CREATE INDEX IF NOT EXISTS bookmarks_server_id_idx ON bookmarks(server_id);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS cached_assets (
  asset_id TEXT PRIMARY KEY NOT NULL,
  bookmark_id TEXT,
  local_uri TEXT NOT NULL,
  content_type TEXT,
  byte_size INTEGER NOT NULL DEFAULT 0,
  last_access_at TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bookmark_lists (
  bookmark_id TEXT NOT NULL,
  list_id TEXT NOT NULL,
  PRIMARY KEY (bookmark_id, list_id)
);

CREATE INDEX IF NOT EXISTS bookmark_lists_list_id_idx ON bookmark_lists(list_id);
`;

const SEARCH_TABLE_SCHEMA = `
CREATE TABLE IF NOT EXISTS bookmark_search (
  bookmark_id TEXT PRIMARY KEY NOT NULL,
  title TEXT,
  url TEXT,
  note TEXT,
  summary TEXT,
  tags TEXT,
  lists TEXT,
  body TEXT
);
CREATE INDEX IF NOT EXISTS bookmark_search_title_idx ON bookmark_search(title);
`;

async function ensureSearchSchema(db: SQLite.SQLiteDatabase) {
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM meta WHERE key = ?",
    ["searchSchemaVersion"],
  );
  if (row?.value === SEARCH_SCHEMA_VERSION) {
    await db.execAsync(SEARCH_TABLE_SCHEMA);
    return;
  }

  // Drop legacy FTS5 virtual table (and any prior table) — FTS5 close segfaults
  // on iOS when expo-sqlite tears down the module (metro reload / app exit).
  await db.execAsync("DROP TABLE IF EXISTS bookmark_search;");
  await db.execAsync(SEARCH_TABLE_SCHEMA);
  await db.runAsync(
    "INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    ["searchSchemaVersion", SEARCH_SCHEMA_VERSION],
  );

  // Rebuild search rows from existing bookmarks (best-effort; sync will refresh).
  const rows = await db.getAllAsync<{ id: string; data_json: string }>(
    "SELECT id, data_json FROM bookmarks WHERE deleted = 0",
  );
  for (const row of rows) {
    try {
      const { hydrateBookmark } = await import("./bookmarkCodec");
      const { bookmarkSearchBody } =
        await import("@karakeep/shared/offlineText");
      const bookmark = hydrateBookmark(JSON.parse(row.data_json));
      const title = bookmark.title ?? "";
      const url =
        bookmark.content.type === "link" ? (bookmark.content.url ?? "") : "";
      await db.runAsync(
        `INSERT INTO bookmark_search(
          bookmark_id, title, url, note, summary, tags, lists, body
        ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(bookmark_id) DO UPDATE SET
          title = excluded.title,
          url = excluded.url,
          note = excluded.note,
          summary = excluded.summary,
          tags = excluded.tags,
          lists = excluded.lists,
          body = excluded.body`,
        [
          row.id,
          title,
          url,
          bookmark.note ?? "",
          bookmark.summary ?? "",
          bookmark.tags.map((t) => t.name).join(" "),
          "",
          bookmarkSearchBody(bookmark),
        ],
      );
    } catch {
      // Skip corrupt rows during migration.
    }
  }
}

export async function getOfflineDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(BASE_SCHEMA);
      await ensureSearchSchema(db);
      return db;
    })();
  }
  return dbPromise;
}

export async function resetOfflineDbForTests() {
  const db = await getOfflineDb();
  await db.execAsync(`
    DELETE FROM bookmark_lists;
    DELETE FROM bookmark_search;
    DELETE FROM cached_assets;
    DELETE FROM outbox;
    DELETE FROM bookmarks;
    DELETE FROM meta;
  `);
  dbPromise = null;
}
