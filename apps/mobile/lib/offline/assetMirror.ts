import * as FileSystem from "expo-file-system/legacy";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import type { Settings } from "@/lib/settings";
import { buildApiHeaders } from "@/lib/utils";

import { hydrateBookmark } from "./bookmarkCodec";
import {
  evictCachedAssets,
  getCachedAssetUri,
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
      return "contentImage";
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
  if (
    assetType === "bannerImage" ||
    assetType === "screenshot" ||
    assetType === "assetScreenshot" ||
    assetType === "contentImage" ||
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
) {
  const maxBytes = settings.offlineMaxCacheSizeMb * 1024 * 1024;
  const headers = buildApiHeaders(settings.apiKey, settings.customHeaders);

  for (const assetId of assetIdsForBookmark(bookmark)) {
    if (await getCachedAssetUri(assetId)) {
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
      });
    } catch {
      // Best effort mirroring; failed assets can retry on next sync.
    }
  }

  await evictCachedAssets(maxBytes);
}

export async function mirrorBookmarksAssets(
  bookmarks: ZBookmark[],
  settings: Settings,
) {
  for (const bookmark of bookmarks) {
    await mirrorBookmarkAssets(bookmark, settings);
  }
}

export async function mirrorReaderHtmlBookmark(
  bookmark: ZBookmark,
  _settings: Settings,
) {
  if (bookmark.content.type !== "link") {
    return bookmark;
  }
  if (bookmark.content.htmlContent) {
    return bookmark;
  }
  return bookmark;
}
