import * as FileSystem from "expo-file-system/legacy";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import { getCachedAssetUri, upsertBookmark } from "./repository";

/**
 * Resolve reader HTML from the local offline cache.
 * Prefer inline htmlContent; otherwise read the mirrored contentAssetId file.
 */
export async function resolveOfflineReaderHtml(
  bookmark: ZBookmark,
): Promise<string | null> {
  if (bookmark.content.type !== "link") {
    return null;
  }

  if (bookmark.content.htmlContent) {
    return bookmark.content.htmlContent;
  }

  const assetId = bookmark.content.contentAssetId;
  if (!assetId) {
    return null;
  }

  const uri = await getCachedAssetUri(assetId);
  if (!uri) {
    return null;
  }

  try {
    const html = await FileSystem.readAsStringAsync(uri);
    if (!html) {
      return null;
    }
    // Backfill inline HTML so later opens skip the file read.
    try {
      await upsertBookmark({
        ...bookmark,
        content: {
          ...bookmark.content,
          htmlContent: html,
        },
      });
    } catch {
      // Best effort; still return the HTML we read.
    }
    return html;
  } catch {
    return null;
  }
}
