import NetInfo from "@react-native-community/netinfo";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";

import type { Settings } from "@/lib/settings";
import { buildApiHeaders } from "@/lib/utils";

import { mirrorBookmarkAssets, hydrateBookmark } from "./assetMirror";
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
import type { OfflineSyncState } from "./types";

type TrpcClient = {
  sync: {
    pull: {
      query: (input: { cursor: number; limit: number }) => Promise<{
        events: Array<{
          sequence: number;
          entityType: string;
          entityId: string;
          operation: "create" | "update" | "delete";
          data?: unknown;
        }>;
        nextCursor: number | null;
      }>;
    };
    push: {
      mutate: (input: {
        operations: ReturnType<typeof outboxToSyncOperations>;
      }) => Promise<{
        results: Array<{
          operationId: string;
          status: "applied" | "duplicate" | "conflict" | "error";
          bookmark?: ZBookmark;
        }>;
      }>;
    };
  };
  bookmarks: {
    getBookmarks: {
      query: (input: {
        limit: number;
        useCursorV2: boolean;
        includeContent: boolean;
        sortOrder: "asc" | "desc";
      }) => Promise<{
        bookmarks: ZBookmark[];
        nextCursor: { id: string; createdAt: Date } | null;
      }>;
    };
    getBookmark: {
      query: (input: {
        bookmarkId: string;
        includeContent: boolean;
      }) => Promise<ZBookmark>;
    };
  };
};

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
    const response = await fetch(`${settings.address}/api/version`, {
      headers: buildApiHeaders(settings.apiKey, settings.customHeaders),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function runOfflineSync(
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
        await markOutboxAttempt(
          result.operationId,
          `Sync ${result.status}`,
        );
      }
    }
  }

  let cursor = Number((await getMeta("syncCursor")) ?? "0");
  let hasMore = true;
  while (hasMore) {
    const page = await client.sync.pull.query({ cursor, limit: 100 });
    for (const event of page.events) {
      if (event.entityType === "bookmark") {
        if (event.operation === "delete") {
          await markBookmarkDeleted(event.entityId);
        } else if (event.data) {
          const bookmark = hydrateBookmark(event.data);
          await upsertBookmark(bookmark);
          if (settings.offlineCacheReaderHtml ?? true) {
            try {
              const withContent = await client.bookmarks.getBookmark.query({
                bookmarkId: bookmark.id,
                includeContent: true,
              });
              await upsertBookmark(withContent);
              await mirrorBookmarkAssets(withContent, settings);
            } catch {
              await mirrorBookmarkAssets(bookmark, settings);
            }
          } else {
            await mirrorBookmarkAssets(bookmark, settings);
          }
        }
      } else if (event.entityType === "bookmarkList" && event.data) {
        const payload = event.data as { bookmarkId: string; listId: string };
        if (event.operation === "delete") {
          await removeBookmarkFromListLocal(
            payload.bookmarkId,
            payload.listId,
          );
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
      await upsertBookmark(bookmark);
    }
    listCursor = page.nextCursor;
  } while (listCursor);

  return "idle";
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
  await mirrorBookmarkAssets(bookmark, settings);
  return bookmark;
}
