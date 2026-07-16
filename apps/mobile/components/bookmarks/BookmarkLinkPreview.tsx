import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, TouchableOpacity, View } from "react-native";
import ImageView from "react-native-image-viewing";
import WebView from "react-native-webview";
import {
  ShouldStartLoadRequest,
  WebViewSourceUri,
} from "react-native-webview/lib/WebViewTypes";
import * as WebBrowser from "expo-web-browser";
import { Text } from "@/components/ui/Text";
import { useAssetUrl } from "@/lib/hooks";
import { resolveOfflineReaderHtml } from "@/lib/offline/readerHtml";
import { isOnline, seedBookmarkFromNetwork } from "@/lib/offline/syncEngine";
import useAppSettings from "@/lib/settings";
import { useReaderSettings, WEBVIEW_FONT_FAMILIES } from "@/lib/readerSettings";
import { useColorScheme } from "@/lib/useColorScheme";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, X } from "lucide-react-native";

import {
  useCreateHighlight,
  useDeleteHighlight,
  useUpdateHighlight,
} from "@karakeep/shared-react/hooks/highlights";
import { useReadingProgress } from "@karakeep/shared-react/hooks/reading-progress";
import { useTRPC, useTRPCClient } from "@karakeep/shared-react/trpc";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";

import FullPageError from "../FullPageError";
import FullPageSpinner from "../ui/FullPageSpinner";
import BookmarkAssetImage from "./BookmarkAssetImage";
import BookmarkHtmlHighlighterDom from "./BookmarkHtmlHighlighterDom";
import { PDFViewer } from "./PDFViewer";

function openUrlExternally(url: string) {
  if (url.startsWith("http://") || url.startsWith("https://")) {
    void WebBrowser.openBrowserAsync(url);
  } else if (
    url.startsWith("mailto:") ||
    url.startsWith("tel:") ||
    url.startsWith("sms:")
  ) {
    void Linking.openURL(url);
  }
  // Ignore javascript: and other schemes
}

export function BookmarkLinkBrowserPreview({
  bookmark,
}: {
  bookmark: ZBookmark;
}) {
  if (bookmark.content.type !== BookmarkTypes.LINK) {
    throw new Error("Wrong content type rendered");
  }

  const bookmarkUrl = bookmark.content.url;

  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      const bookmarkOrigin = new URL(bookmarkUrl).origin;
      if (request.url.startsWith(bookmarkOrigin)) {
        return true;
      }
      openUrlExternally(request.url);
      return false;
    },
    [bookmarkUrl],
  );

  return (
    <WebView
      startInLoadingState={true}
      mediaPlaybackRequiresUserAction={true}
      source={{ uri: bookmarkUrl }}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
    />
  );
}

export function BookmarkLinkPdfPreview({ bookmark }: { bookmark: ZBookmark }) {
  if (bookmark.content.type !== BookmarkTypes.LINK) {
    throw new Error("Wrong content type rendered");
  }

  const asset = bookmark.assets.find((r) => r.assetType == "pdf");

  const assetSource = useAssetUrl(asset?.id ?? "");

  if (!asset) {
    return (
      <View className="flex-1 bg-background">
        <Text>Asset has no PDF</Text>
      </View>
    );
  }

  return (
    <View className="flex flex-1">
      <PDFViewer source={assetSource.uri ?? ""} headers={assetSource.headers} />
    </View>
  );
}

export function BookmarkLinkReaderPreview({
  bookmark,
}: {
  bookmark: ZBookmark;
}) {
  const { isDarkColorScheme: isDark } = useColorScheme();
  const { settings: readerSettings } = useReaderSettings();
  const { settings } = useAppSettings();
  const api = useTRPC();
  const client = useTRPCClient();

  const [offlineHtml, setOfflineHtml] = useState<string | null>(null);
  const [offlineChecked, setOfflineChecked] = useState(false);
  const [offlineSeedError, setOfflineSeedError] = useState<string | null>(null);
  const [offlineRetry, setOfflineRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setOfflineChecked(false);
    setOfflineSeedError(null);
    void (async () => {
      // Prefer local HTML whenever it exists — even if Offline mode is off —
      // so airplane-mode opens don't hang on a dead includeContent fetch.
      let html = await resolveOfflineReaderHtml(bookmark);
      if (!cancelled) {
        setOfflineHtml(html);
        setOfflineChecked(true);
      }
      if (html || cancelled || !settings.offlineEnabled) {
        return;
      }

      if (!(await isOnline(settings))) {
        return;
      }
      try {
        const seeded = await seedBookmarkFromNetwork(
          client,
          settings,
          bookmark.id,
        );
        if (cancelled) {
          return;
        }
        html = await resolveOfflineReaderHtml(seeded);
        setOfflineHtml(html);
        if (!html) {
          setOfflineSeedError(
            "Article content is not available offline yet. Connect and sync, then try again.",
          );
        }
      } catch (err) {
        if (!cancelled) {
          setOfflineSeedError(
            err instanceof Error ? err.message : "Failed to download article",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookmark, client, settings, offlineRetry]);

  // Use local HTML if we have it, or when Offline mode is on (show empty/error).
  const useLocalReader =
    offlineChecked && (!!offlineHtml || settings.offlineEnabled);

  const {
    data: bookmarkWithContent,
    error,
    isLoading,
    refetch,
  } = useQuery(
    api.bookmarks.getBookmark.queryOptions(
      {
        bookmarkId: bookmark.id,
        includeContent: true,
      },
      {
        // Skip network when Offline mode is on or local HTML already resolved.
        enabled: !settings.offlineEnabled && offlineChecked && !offlineHtml,
        retry: false,
      },
    ),
  );

  const { data: highlights } = useQuery(
    api.highlights.getForBookmark.queryOptions(
      {
        bookmarkId: bookmark.id,
      },
      {
        enabled: !settings.offlineEnabled && offlineChecked && !offlineHtml,
        retry: false,
      },
    ),
  );

  const { mutate: createHighlight } = useCreateHighlight();
  const { mutate: updateHighlight } = useUpdateHighlight();
  const { mutate: deleteHighlight } = useDeleteHighlight();

  const {
    showBanner,
    bannerPercent,
    onContinue,
    onDismiss,
    restorePosition,
    readingProgressOffset,
    readingProgressAnchor,
    onSavePosition,
    onScrollPositionChange,
  } = useReadingProgress({
    bookmarkId: bookmark.id,
  });

  const [viewingImage, setViewingImage] = useState<string | null>(null);

  const handleLinkPress = useCallback((url: string) => {
    openUrlExternally(url);
  }, []);

  const handleImagePress = useCallback((src: string) => {
    setViewingImage(src);
  }, []);

  // Wait for the local-cache check whether Offline mode is on or off.
  // Previously we only waited when Offline was on, so the online path threw
  // "Wrong content type rendered" while bookmarkWithContent was still undefined.
  if (!offlineChecked) {
    return <FullPageSpinner />;
  }

  if (useLocalReader) {
    if (!offlineHtml) {
      return (
        <FullPageError
          error={
            offlineSeedError ??
            "Article content is not available offline yet. Connect and sync, then try again."
          }
          onRetry={() => {
            setOfflineRetry((n) => n + 1);
          }}
        />
      );
    }
  } else {
    if (error) {
      return (
        <FullPageError
          error={
            /network request failed|failed to fetch|network error/i.test(
              error.message,
            )
              ? "You're offline and this article isn't cached yet. Enable Offline mode while online, sync, then retry."
              : error.message
          }
          onRetry={refetch}
        />
      );
    }

    if (isLoading || !bookmarkWithContent) {
      return <FullPageSpinner />;
    }

    if (bookmarkWithContent.content.type !== BookmarkTypes.LINK) {
      return (
        <FullPageError
          error="This bookmark isn't a link article, so the reader can't open it."
          onRetry={refetch}
        />
      );
    }
  }

  const htmlContent = useLocalReader
    ? (offlineHtml ?? "")
    : bookmarkWithContent!.content.type === BookmarkTypes.LINK
      ? (bookmarkWithContent!.content.htmlContent ?? "")
      : "";

  const contentStyle: React.CSSProperties = {
    fontFamily: WEBVIEW_FONT_FAMILIES[readerSettings.fontFamily],
    fontSize: `${readerSettings.fontSize}px`,
    lineHeight: String(readerSettings.lineHeight),
    color: isDark ? "#e5e7eb" : "#374151",
    padding: "16px",
    background: isDark ? "#000000" : "#ffffff",
  };

  return (
    <View className="flex-1 bg-background">
      <ImageView
        visible={!!viewingImage}
        imageIndex={0}
        onRequestClose={() => setViewingImage(null)}
        doubleTapToZoomEnabled={true}
        images={viewingImage ? [{ uri: viewingImage }] : []}
      />
      {showBanner && (
        <View className="flex-row items-center gap-2 border-b border-border bg-background px-4 py-2">
          <BookOpen size={16} className="text-muted-foreground" />
          <Text className="flex-1 text-sm text-muted-foreground">
            {bannerPercent && bannerPercent > 0
              ? `Continue where you left off (${bannerPercent}%)`
              : "Continue where you left off"}
          </Text>
          <TouchableOpacity
            onPress={onContinue}
            className="rounded-md bg-primary px-3 py-1"
          >
            <Text className="text-xs font-medium text-primary-foreground">
              Continue
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onDismiss} className="p-1">
            <X size={14} className="text-muted-foreground" />
          </TouchableOpacity>
        </View>
      )}
      <BookmarkHtmlHighlighterDom
        htmlContent={htmlContent}
        contentStyle={contentStyle}
        highlights={highlights?.highlights ?? []}
        readingProgressOffset={readingProgressOffset}
        readingProgressAnchor={readingProgressAnchor}
        restoreReadingPosition={restorePosition}
        onSavePosition={onSavePosition}
        onScrollPositionChange={onScrollPositionChange}
        onLinkPress={handleLinkPress}
        onImagePress={handleImagePress}
        onHighlight={(h) =>
          createHighlight({
            startOffset: h.startOffset,
            endOffset: h.endOffset,
            color: h.color,
            bookmarkId: bookmark.id,
            text: h.text,
            note: h.note ?? null,
          })
        }
        onUpdateHighlight={(h) =>
          updateHighlight({
            highlightId: h.id,
            color: h.color,
            note: h.note,
          })
        }
        onDeleteHighlight={(h) =>
          deleteHighlight({
            highlightId: h.id,
          })
        }
        dom={{ scrollEnabled: true }}
      />
    </View>
  );
}

export function BookmarkLinkArchivePreview({
  bookmark,
}: {
  bookmark: ZBookmark;
}) {
  const asset =
    bookmark.assets.find((r) => r.assetType == "precrawledArchive") ??
    bookmark.assets.find((r) => r.assetType == "fullPageArchive");

  const assetSource = useAssetUrl(asset?.id ?? "");

  const originUri = assetSource.uri;
  const onShouldStartLoadWithRequest = useCallback(
    (request: ShouldStartLoadRequest) => {
      // Allow loading the archive asset itself
      if (
        originUri &&
        (request.url === originUri || request.url.startsWith(originUri))
      ) {
        return true;
      }
      openUrlExternally(request.url);
      return false;
    },
    [originUri],
  );

  if (!asset) {
    return (
      <View className="flex-1 bg-background">
        <Text>Asset has no offline archive</Text>
      </View>
    );
  }

  const webViewUri: WebViewSourceUri = {
    uri: assetSource.uri!,
    headers: assetSource.headers,
  };

  return (
    <WebView
      startInLoadingState={true}
      mediaPlaybackRequiresUserAction={true}
      source={webViewUri}
      decelerationRate={0.998}
      setSupportMultipleWindows={false}
      onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
    />
  );
}

export function BookmarkLinkScreenshotPreview({
  bookmark,
}: {
  bookmark: ZBookmark;
}) {
  const asset = bookmark.assets.find((r) => r.assetType == "screenshot");

  const assetSource = useAssetUrl(asset?.id ?? "");
  const [imageZoom, setImageZoom] = useState(false);

  if (!asset) {
    return (
      <View className="flex-1 bg-background">
        <Text>Asset has no screenshot</Text>
      </View>
    );
  }

  return (
    <View className="flex flex-1 gap-2">
      <ImageView
        visible={imageZoom}
        imageIndex={0}
        onRequestClose={() => setImageZoom(false)}
        doubleTapToZoomEnabled={true}
        images={[assetSource]}
      />
      <Pressable onPress={() => setImageZoom(true)}>
        <BookmarkAssetImage
          assetId={asset.id}
          className="h-full w-full"
          contentFit="contain"
        />
      </Pressable>
    </View>
  );
}
