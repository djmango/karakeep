import type { TRPCClient } from "@trpc/client";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import type { AppRouter } from "@karakeep/trpc/routers/_app";

import type { Settings } from "@/lib/settings";

import { hydrateBookmark } from "./bookmarkCodec";
import {
  mirrorBookmarkAssets,
  mirrorHtmlReferencedAssets,
} from "./assetMirror";
import { resolveOfflineReaderHtml } from "./readerHtml";
import {
  getBookmarkById,
  isBookmarkDownloaded,
  markBookmarkDownloaded,
  pinAssetsForBookmark,
  upsertBookmark,
} from "./repository";
import { useOfflineStore } from "./store";

type TrpcClient = TRPCClient<AppRouter>;

/**
 * Durably download a bookmark for offline reading:
 * full HTML + assets, pinned so eviction never removes them.
 */
export async function downloadBookmarkForOffline(
  client: TrpcClient,
  settings: Settings,
  bookmarkId: string,
): Promise<ZBookmark> {
  const withContent = await client.bookmarks.getBookmark.query({
    bookmarkId,
    includeContent: true,
  });
  const bookmark = hydrateBookmark(withContent);
  await upsertBookmark(bookmark);
  await mirrorBookmarkAssets(bookmark, settings, { durable: true });

  // Ensure HTML is inline in SQLite (survives even if asset rows are lost).
  const html = await resolveOfflineReaderHtml(bookmark);
  if (
    html &&
    bookmark.content.type === "link" &&
    !bookmark.content.htmlContent
  ) {
    await upsertBookmark({
      ...bookmark,
      content: { ...bookmark.content, htmlContent: html },
    });
  }

  // Article body images are rewritten to /api/assets/... — cache those too.
  if (html) {
    await mirrorHtmlReferencedAssets(html, bookmark.id, settings, {
      durable: true,
    });
  }

  await pinAssetsForBookmark(bookmark.id);
  await markBookmarkDownloaded(bookmark.id, true);
  useOfflineStore.getState().bumpCacheGeneration();

  const local = await getBookmarkById(bookmark.id);
  return local ?? bookmark;
}

export async function getBookmarkDownloadStatus(bookmarkId: string): Promise<{
  downloaded: boolean;
}> {
  if (await isBookmarkDownloaded(bookmarkId)) {
    return { downloaded: true };
  }
  // Legacy: treat existing local reader HTML as already downloaded, then pin it.
  const local = await getBookmarkById(bookmarkId);
  if (!local) {
    return { downloaded: false };
  }
  const html = await resolveOfflineReaderHtml(local);
  if (!html) {
    return { downloaded: false };
  }
  await pinAssetsForBookmark(bookmarkId);
  await markBookmarkDownloaded(bookmarkId, true);
  return { downloaded: true };
}
