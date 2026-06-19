import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { ZSyncPushOperation } from "@karakeep/shared/types/sync";

export type OfflineSyncState =
  | "idle"
  | "syncing"
  | "offline"
  | "error"
  | "pending";

export interface OfflineBookmarkRecord {
  id: string;
  serverId: string | null;
  dataJson: string;
  createdAt: string;
  modifiedAt: string | null;
  archived: number;
  favourited: number;
  deleted: number;
  pendingSync: number;
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
  offlineEnabled: true,
  maxCacheSizeMb: 1024,
  syncOnCellular: false,
  cacheReaderHtml: true,
  cacheImages: true,
  cachePdfs: true,
  cacheArchives: false,
} as const;
