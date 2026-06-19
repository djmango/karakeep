import * as FileSystem from "expo-file-system/legacy";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";
import { zBookmarkSchema } from "@karakeep/shared/types/bookmarks";

import type { Settings } from "@/lib/settings";
import { buildApiHeaders } from "@/lib/utils";

import {
  evictCachedAssets,
  getCachedAssetUri,
  upsertCachedAsset,
} from "./repository";

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

    const asset = bookmark.assets.find((a) => a.id === assetId);
    const assetType = asset?.assetType;
    if (assetType === "pdf" && !settings.offlineCachePdfs) {
      continue;
    }
    if (
      (assetType === "fullPageArchive" || assetType === "precrawledArchive") &&
      !settings.offlineCacheArchives
    ) {
      continue;
    }
    if (
      (assetType === "bannerImage" ||
        assetType === "screenshot" ||
        assetType === "image" ||
        assetType === "contentImage") &&
      !settings.offlineCacheImages
    ) {
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

export async function mirrorReaderHtmlBookmark(
  bookmark: ZBookmark,
  settings: Settings,
) {
  if (bookmark.content.type !== "link") {
    return bookmark;
  }
  if (bookmark.content.htmlContent) {
    return bookmark;
  }
  return bookmark;
}

export function hydrateBookmark(raw: unknown): ZBookmark {
  const parsed = zBookmarkSchema.parse(raw);
  parsed.createdAt = new Date(parsed.createdAt);
  if (parsed.modifiedAt) {
    parsed.modifiedAt = new Date(parsed.modifiedAt);
  }
  return parsed;
}
