import * as FileSystem from "expo-file-system/legacy";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import type { Settings } from "@/lib/settings";
import { buildApiHeaders } from "@/lib/utils";

import { hydrateBookmark } from "./bookmarkCodec";
import {
  evictCachedAssets,
  getCachedAssetUri,
  pinCachedAsset,
  upsertCachedAsset,
} from "./repository";

export { hydrateBookmark };

type InferredAssetType =
  | "bannerImage"
  | "screenshot"
  | "assetScreenshot"
  | "pdf"
  | "fullPageArchive"
  | "precrawledArchive"
  | "video"
  | "contentImage"
  | string;

function resolveAssetType(
  bookmark: ZBookmark,
  assetId: string,
): InferredAssetType | undefined {
  const listed = bookmark.assets.find((a) => a.id === assetId)?.assetType;
  if (listed) {
    return listed;
  }
  if (bookmark.content.type === "link") {
    const content = bookmark.content;
    if (content.imageAssetId === assetId) {
      return "bannerImage";
    }
    if (content.screenshotAssetId === assetId) {
      return "screenshot";
    }
    if (content.pdfAssetId === assetId) {
      return "pdf";
    }
    if (content.fullPageArchiveAssetId === assetId) {
      return "fullPageArchive";
    }
    if (content.precrawledArchiveAssetId === assetId) {
      return "precrawledArchive";
    }
    if (content.videoAssetId === assetId) {
      return "video";
    }
    if (content.contentAssetId === assetId) {
      // Server stores large reader HTML as a content asset (not an image).
      return "readerHtml";
    }
  }
  if (
    bookmark.content.type === "asset" &&
    bookmark.content.assetId === assetId
  ) {
    return bookmark.content.assetType;
  }
  return undefined;
}

function assetIdsForBookmark(bookmark: ZBookmark): string[] {
  const ids = bookmark.assets.map((a) => a.id);
  if (bookmark.content.type === "asset") {
    ids.push(bookmark.content.assetId);
  }
  if (bookmark.content.type === "link") {
    const content = bookmark.content;
    for (const key of [
      "imageAssetId",
      "screenshotAssetId",
      "pdfAssetId",
      "fullPageArchiveAssetId",
      "precrawledArchiveAssetId",
      "videoAssetId",
      "contentAssetId",
    ] as const) {
      const value = content[key];
      if (value) {
        ids.push(value);
      }
    }
  }
  return [...new Set(ids)];
}

function shouldCacheAssetType(
  assetType: InferredAssetType | undefined,
  settings: Settings,
): boolean {
  if (!assetType) {
    return false;
  }
  if (assetType === "video") {
    return false;
  }
  if (assetType === "pdf") {
    return settings.offlineCachePdfs;
  }
  if (assetType === "fullPageArchive" || assetType === "precrawledArchive") {
    return settings.offlineCacheArchives;
  }
  if (assetType === "readerHtml" || assetType === "contentImage") {
    // contentImage is the legacy label we used for contentAssetId.
    return settings.offlineCacheReaderHtml;
  }
  if (
    assetType === "bannerImage" ||
    assetType === "screenshot" ||
    assetType === "assetScreenshot" ||
    assetType === "image"
  ) {
    return settings.offlineCacheImages;
  }
  // Unknown typed assets from bookmark.assets: only keep images when enabled.
  return settings.offlineCacheImages;
}

export async function mirrorBookmarkAssets(
  bookmark: ZBookmark,
  settings: Settings,
  opts?: { durable?: boolean },
) {
  const durable = opts?.durable ?? false;
  const maxBytes = settings.offlineMaxCacheSizeMb * 1024 * 1024;
  const headers = buildApiHeaders(settings.apiKey, settings.customHeaders);

  for (const assetId of assetIdsForBookmark(bookmark)) {
    const existingUri = await getCachedAssetUri(assetId);
    if (existingUri) {
      if (durable) {
        await pinCachedAsset(assetId);
      }
      continue;
    }

    const assetType = resolveAssetType(bookmark, assetId);
    if (!shouldCacheAssetType(assetType, settings)) {
      continue;
    }

    const targetDir = `${FileSystem.documentDirectory}offline-assets/`;
    await FileSystem.makeDirectoryAsync(targetDir, { intermediates: true });
    const targetUri = `${targetDir}${assetId}`;

    try {
      const result = await FileSystem.downloadAsync(
        `${settings.address}/api/assets/${assetId}`,
        targetUri,
        { headers },
      );
      if (result.status !== 200) {
        continue;
      }
      const info = await FileSystem.getInfoAsync(result.uri);
      await upsertCachedAsset({
        assetId,
        bookmarkId: bookmark.id,
        localUri: result.uri,
        contentType: result.headers["Content-Type"] ?? null,
        byteSize: info.exists && "size" in info ? (info.size ?? 0) : 0,
        // Reader HTML and explicit downloads are durable — never evicted.
        pinned:
          durable || assetType === "readerHtml" || assetType === "contentImage",
      });
    } catch {
      // Best effort mirroring; failed assets can retry on next sync.
    }
  }

  // Never evict pinned/durable assets; only trim unpinned overflow.
  if (!durable) {
    await evictCachedAssets(maxBytes);
  }
}

export async function mirrorBookmarksAssets(
  bookmarks: ZBookmark[],
  settings: Settings,
  opts?: { durable?: boolean },
) {
  for (const bookmark of bookmarks) {
    await mirrorBookmarkAssets(bookmark, settings, opts);
  }
}

/** Ensure reader HTML for a bookmark is available locally (inline or file). */
export async function mirrorReaderHtmlBookmark(
  bookmark: ZBookmark,
  settings: Settings,
): Promise<ZBookmark> {
  if (bookmark.content.type !== "link") {
    return bookmark;
  }
  if (!settings.offlineCacheReaderHtml) {
    return bookmark;
  }
  if (bookmark.content.htmlContent) {
    return bookmark;
  }

  // Prefer downloading the content asset (already used for large HTML on server).
  if (bookmark.content.contentAssetId) {
    await mirrorBookmarkAssets(bookmark, settings);
    return bookmark;
  }

  return bookmark;
}
