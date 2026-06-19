import * as SQLite from "expo-sqlite";

const DB_NAME = "karakeep-offline.db";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const SCHEMA = `
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

CREATE VIRTUAL TABLE IF NOT EXISTS bookmark_search USING fts5(
  bookmark_id UNINDEXED,
  title,
  url,
  note,
  summary,
  tags,
  lists,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);
`;

export async function getOfflineDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(SCHEMA);
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
}
