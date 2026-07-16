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
import {
  addBookmarkToListLocal,
  getMeta,
  markBookmarkDeleted,
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

export async function isOnline(settings: Settings): Promise<boolean> {
  const state = await NetInfo.fetch();
  if (!state.isConnected) {
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
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${settings.address}/api/version`, {
      headers: buildApiHeaders(settings.apiKey, settings.customHeaders),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
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

  // Mirror assets in the background after metadata sync returns idle.
  if (bookmarksToMirror.length > 0) {
    void mirrorBookmarksAssets(bookmarksToMirror, settings).catch((err) => {
      console.warn("[offline-sync] background asset mirror failed", err);
    });
  }

  return "idle";
}

export async function runOfflineSync(
  client: TrpcClient,
  settings: Settings,
): Promise<OfflineSyncState> {
  if (syncInFlight) {
    return syncInFlight;
  }
  syncInFlight = runOfflineSyncInner(client, settings).finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export async function seedBookmarkFromNetwork(
  client: TrpcClient,
  settings: Settings,
  bookmarkId: string,
) {
  const bookmark = await client.bookmarks.getBookmark.query({
    bookmarkId,
    includeContent: true,
  });
  await upsertBookmark(bookmark);
  bumpCache();
  // Don't block bookmark open on asset downloads.
  void mirrorBookmarkAssets(bookmark, settings).catch((err) => {
    console.warn("[offline-sync] asset mirror failed for", bookmarkId, err);
  });
  return bookmark;
}
