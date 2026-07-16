import NetInfo from "@react-native-community/netinfo";
import type { TRPCClient } from "@trpc/client";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { AppRouter } from "@karakeep/trpc/routers/_app";

import type { Settings } from "@/lib/settings";
import { buildApiHeaders } from "@/lib/utils";

import { mirrorBookmarkAssets, mirrorBookmarksAssets } from "./assetMirror";
import { hydrateBookmark } from "./bookmarkCodec";
import {
  listOutboxOperations,
  markOutboxAttempt,
  outboxToSyncOperations,
  removeOutboxOperation,
} from "./outbox";
import { resolveOfflineReaderHtml } from "./readerHtml";
import {
  addBookmarkToListLocal,
  getMeta,
  markBookmarkDeleted,
  markBookmarkDownloaded,
  pinAssetsForBookmark,
  reconcileLocalBookmark,
  removeBookmarkFromListLocal,
  setMeta,
  upsertBookmark,
} from "./repository";
import { useOfflineStore } from "./store";
import type { OfflineSyncState } from "./types";

type TrpcClient = TRPCClient<AppRouter>;

let syncInFlight: Promise<OfflineSyncState> | null = null;

function bumpCache() {
  useOfflineStore.getState().bumpCacheGeneration();
}

const ONLINE_PROBE_MS = 3000;
const SYNC_HARD_TIMEOUT_MS = 60_000;
const SEED_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string) {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

export async function isOnline(settings: Settings): Promise<boolean> {
  if (__DEV__) {
    try {
      const FileSystem = await import("expo-file-system/legacy");
      if (FileSystem.documentDirectory) {
        const flag = `${FileSystem.documentDirectory}force-offline`;
        const info = await FileSystem.getInfoAsync(flag);
        if (info.exists) {
          return false;
        }
      }
    } catch {
      // ignore
    }
  }

  const state = await NetInfo.fetch();
  // iOS can report isConnected=true while unreachable; treat explicit false as offline.
  if (state.isConnected === false || state.isInternetReachable === false) {
    return false;
  }
  if (
    state.type === "cellular" &&
    settings.offlineEnabled &&
    settings.offlineSyncOnCellular === false
  ) {
    return false;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ONLINE_PROBE_MS);
    const response = await Promise.race([
      fetch(`${settings.address}/api/version`, {
        headers: buildApiHeaders(settings.apiKey, settings.customHeaders),
        signal: controller.signal,
      }),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), ONLINE_PROBE_MS + 250),
      ),
    ]);
    clearTimeout(timeout);
    return response != null && response.ok;
  } catch {
    return false;
  }
}

async function runOfflineSyncInner(
  client: TrpcClient,
  settings: Settings,
): Promise<OfflineSyncState> {
  if (!(await isOnline(settings))) {
    return "offline";
  }

  const outbox = await listOutboxOperations();
  if (outbox.length > 0) {
    const pushResult = await client.sync.push.mutate({
      operations: outboxToSyncOperations(outbox),
    });
    for (const result of pushResult.results) {
      if (result.status === "applied" || result.status === "duplicate") {
        const operation = outbox.find((op) => op.id === result.operationId);
        if (operation?.type === "bookmark.create" && result.bookmark) {
          const payload = JSON.parse(operation.payloadJson) as {
            clientBookmarkId?: string;
          };
          if (payload.clientBookmarkId) {
            await reconcileLocalBookmark(
              payload.clientBookmarkId,
              hydrateBookmark(result.bookmark),
            );
          } else {
            await upsertBookmark(hydrateBookmark(result.bookmark));
          }
        }
        await removeOutboxOperation(result.operationId);
      } else {
        await markOutboxAttempt(result.operationId, `Sync ${result.status}`);
      }
    }
    bumpCache();
  }

  const bookmarksToMirror: ZBookmark[] = [];
  let cursor = Number((await getMeta("syncCursor")) ?? "0");
  let hasMore = true;
  while (hasMore) {
    const page = await client.sync.pull.query({ cursor, limit: 100 });
    for (const event of page.events) {
      if (event.entityType === "bookmark") {
        if (event.operation === "delete") {
          await markBookmarkDeleted(event.entityId);
        } else if (event.data) {
          // Persist metadata only in the pull loop. Asset downloads happen after
          // the list is usable so the home screen can render from SQLite.
          try {
            const bookmark = hydrateBookmark(event.data);
            await upsertBookmark(bookmark);
            bookmarksToMirror.push(bookmark);
          } catch (err) {
            console.warn(
              "[offline-sync] skipped bookmark event",
              event.entityId,
              err,
            );
          }
        }
      } else if (event.entityType === "bookmarkList" && event.data) {
        const payload = event.data as { bookmarkId: string; listId: string };
        if (event.operation === "delete") {
          await removeBookmarkFromListLocal(payload.bookmarkId, payload.listId);
        } else {
          await addBookmarkToListLocal(payload.bookmarkId, payload.listId);
        }
      }
      cursor = event.sequence;
    }
    hasMore = page.nextCursor !== null;
    if (page.nextCursor !== null) {
      cursor = page.nextCursor;
    }
    // Let the UI pick up newly upserted rows while sync continues.
    bumpCache();
  }

  await setMeta("syncCursor", String(cursor));

  let listCursor: { id: string; createdAt: Date } | null = null;
  do {
    const page = await client.bookmarks.getBookmarks.query({
      limit: 100,
      useCursorV2: true,
      includeContent: false,
      sortOrder: settings.bookmarkSortOrder,
      ...(listCursor ? { cursor: listCursor } : {}),
    });
    for (const bookmark of page.bookmarks) {
      try {
        // Client may already have Date objects; revive is idempotent for those.
        const hydrated = hydrateBookmark(bookmark);
        await upsertBookmark(hydrated);
        bookmarksToMirror.push(hydrated);
      } catch (err) {
        console.warn(
          "[offline-sync] skipped bookmark page row",
          bookmark.id,
          err,
        );
      }
    }
    listCursor = page.nextCursor;
    bumpCache();
  } while (listCursor);

  // Mirror assets + fetch missing reader HTML in the background after the list
  // is usable. This restores the original offline article download behavior
  // without blocking the home screen.
  if (bookmarksToMirror.length > 0) {
    void (async () => {
      try {
        // Pin reader HTML assets so auto-synced articles stay durable.
        await mirrorBookmarksAssets(bookmarksToMirror, settings, {
          durable: settings.offlineCacheReaderHtml,
        });
      } catch (err) {
        console.warn("[offline-sync] background asset mirror failed", err);
      }
      try {
        await enrichBookmarksWithReaderHtml(
          client,
          settings,
          bookmarksToMirror,
        );
      } catch (err) {
        console.warn("[offline-sync] background content enrich failed", err);
      }
      // Mark bookmarks with durable local HTML as downloaded.
      if (settings.offlineCacheReaderHtml) {
        for (const bookmark of bookmarksToMirror) {
          try {
            const html = await resolveOfflineReaderHtml(bookmark);
            if (html) {
              await pinAssetsForBookmark(bookmark.id);
              await markBookmarkDownloaded(bookmark.id, true);
            }
          } catch {
            // best effort
          }
        }
        bumpCache();
      }
    })();
  }

  return "idle";
}

const CONTENT_ENRICH_CONCURRENCY = 3;

/** Fetch full HTML for bookmarks that have neither inline content nor a content asset. */
async function enrichBookmarksWithReaderHtml(
  client: TrpcClient,
  settings: Settings,
  bookmarks: ZBookmark[],
) {
  if (!settings.offlineCacheReaderHtml) {
    return;
  }

  const needing = bookmarks.filter((bookmark) => {
    if (bookmark.content.type !== "link") {
      return false;
    }
    if (bookmark.content.htmlContent) {
      return false;
    }
    // contentAssetId is downloaded by asset mirroring; no getBookmark needed.
    if (bookmark.content.contentAssetId) {
      return false;
    }
    return true;
  });

  for (let i = 0; i < needing.length; i += CONTENT_ENRICH_CONCURRENCY) {
    const batch = needing.slice(i, i + CONTENT_ENRICH_CONCURRENCY);
    await Promise.all(
      batch.map(async (bookmark) => {
        try {
          const withContent = await client.bookmarks.getBookmark.query({
            bookmarkId: bookmark.id,
            includeContent: true,
          });
          await upsertBookmark(hydrateBookmark(withContent));
          await mirrorBookmarkAssets(withContent, settings);
          bumpCache();
        } catch (err) {
          console.warn(
            "[offline-sync] content enrich failed for",
            bookmark.id,
            err,
          );
        }
      }),
    );
  }
}

export async function runOfflineSync(
  client: TrpcClient,
  settings: Settings,
): Promise<OfflineSyncState> {
  if (syncInFlight) {
    return syncInFlight;
  }
  syncInFlight = Promise.race([
    runOfflineSyncInner(client, settings),
    new Promise<OfflineSyncState>((resolve) =>
      setTimeout(() => resolve("error"), SYNC_HARD_TIMEOUT_MS),
    ),
  ]).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function seedBookmarkFromNetwork(
  client: TrpcClient,
  settings: Settings,
  bookmarkId: string,
) {
  const bookmark = await withTimeout(
    client.bookmarks.getBookmark.query({
      bookmarkId,
      includeContent: true,
    }),
    SEED_TIMEOUT_MS,
    "seedBookmarkFromNetwork",
  );
  await upsertBookmark(bookmark);
  bumpCache();
  // Don't block bookmark open on asset downloads — pin so they stay durable.
  void (async () => {
    try {
      await mirrorBookmarkAssets(bookmark, settings, { durable: true });
      await pinAssetsForBookmark(bookmark.id);
      if (await resolveOfflineReaderHtml(bookmark)) {
        await markBookmarkDownloaded(bookmark.id, true);
        bumpCache();
      }
    } catch (err) {
      console.warn("[offline-sync] asset mirror failed for", bookmarkId, err);
    }
  })();
  return bookmark;
}
