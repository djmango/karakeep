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
  deleteCachedAssetsForBookmark,
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
  // Only the explicit downloaded flag — don't infer from cached HTML, or the
  // green button can never be turned off (sync/open would re-mark it).
  return { downloaded: await isBookmarkDownloaded(bookmarkId) };
}

/**
 * Remove the durable offline pack for a bookmark (HTML + pinned assets).
 * Does not delete the bookmark itself. Opening it again while online may
 * re-download automatically.
 */
export async function removeBookmarkOfflineDownload(
  bookmarkId: string,
): Promise<void> {
  const local = await getBookmarkById(bookmarkId);
  if (local?.content.type === "link" && local.content.htmlContent) {
    await upsertBookmark({
      ...local,
      content: {
        ...local.content,
        htmlContent: null,
      },
    });
  }

  await deleteCachedAssetsForBookmark(bookmarkId);
  await markBookmarkDownloaded(bookmarkId, false);
  useOfflineStore.getState().bumpCacheGeneration();
}
