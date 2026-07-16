import * as FileSystem from "expo-file-system/legacy";

import type { ZBookmark } from "@karakeep/shared/types/bookmarks";

import {
  getCachedAsset,
  getCachedAssetUri,
  upsertBookmark,
} from "./repository";

const READER_ASSET_URL_RE =
  /(?:https?:\/\/[^/"'\s]+)?\/api\/assets\/([A-Za-z0-9_-]+)/g;

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

/**
 * Inline locally cached /api/assets/... images as data URIs so the Expo DOM
 * reader can show them without auth cookies (relative /api/assets URLs are
 * otherwise broken / grey placeholders).
 */
export async function inlineCachedReaderAssets(html: string): Promise<string> {
  const ids = [
    ...new Set(
      [...html.matchAll(READER_ASSET_URL_RE)].map((match) => match[1]),
    ),
  ];
  if (ids.length === 0) {
    return html;
  }

  const replacements = new Map<string, string>();
  for (const assetId of ids) {
    const cached = await getCachedAsset(assetId);
    if (!cached) {
      continue;
    }
    try {
      const base64 = await FileSystem.readAsStringAsync(cached.localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const contentType =
        cached.contentType && cached.contentType.startsWith("image/")
          ? cached.contentType.split(";")[0]
          : "image/jpeg";
      replacements.set(assetId, `data:${contentType};base64,${base64}`);
    } catch {
      // Leave the original URL for the DOM auth hydrate path.
    }
  }

  if (replacements.size === 0) {
    return html;
  }

  return html.replace(READER_ASSET_URL_RE, (full, assetId: string) => {
    return replacements.get(assetId) ?? full;
  });
}
