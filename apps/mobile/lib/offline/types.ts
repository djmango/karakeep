import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { ZSyncPushOperation } from "@karakeep/shared/types/sync";

export type OfflineSyncState =
  | "idle"
  | "syncing"
  | "offline"
  | "error"
  | "pending";

/** Matches expo-sqlite row shape (snake_case column names). */
export interface OfflineBookmarkRecord {
  id: string;
  server_id: string | null;
  data_json: string;
  created_at: string;
  modified_at: string | null;
  archived: number;
  favourited: number;
  deleted: number;
  pending_sync: number;
}

export interface OutboxOperation {
  id: string;
  type: ZSyncPushOperation["type"];
  payloadJson: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
}

export interface CachedAssetRecord {
  assetId: string;
  bookmarkId: string | null;
  localUri: string;
  contentType: string | null;
  byteSize: number;
  lastAccessAt: string;
  pinned: number;
}

export interface OfflineSearchResult {
  bookmark: ZBookmark;
  score: number;
  missingAssets: boolean;
}

export const DEFAULT_OFFLINE_SETTINGS = {
  offlineEnabled: false,
  maxCacheSizeMb: 1024,
  syncOnCellular: false,
  cacheReaderHtml: true,
  cacheImages: true,
  cachePdfs: true,
  cacheArchives: false,
} as const;
