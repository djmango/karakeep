import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import useAppSettings from "@/lib/settings";
import { useOfflineBookmarks } from "@/lib/offline/hooks";
import { useIsAppOnline } from "@/lib/offline/useIsAppOnline";

import type { ZGetBookmarksRequest } from "@karakeep/shared/types/bookmarks";
import { useTRPC } from "@karakeep/shared-react/trpc";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import FullPageError from "../FullPageError";
import FullPageSpinner from "../ui/FullPageSpinner";
import BookmarkList from "./BookmarkList";

export default function UpdatingBookmarkList({
  query,
  header,
}: {
  query: Omit<ZGetBookmarksRequest, "sortOrder" | "includeContent">;
  header?: React.ReactElement;
}) {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const online = useIsAppOnline();
  const offline = useOfflineBookmarks({
    archived: query.archived,
    favourited: query.favourited,
    tagId: query.tagId,
    sortOrder: settings.bookmarkSortOrder,
  });

  // Offline mode: SQLite is source of truth. Also fall back to cache when the
  // device is offline even if the toggle was left off / settings were lost.
  const useOfflineFirst =
    settings.offlineEnabled ||
    (online === false && !offline.isLoading && offline.bookmarks.length > 0);

  const {
    data,
    isPending,
    isPlaceholderData,
    error,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery(
    api.bookmarks.getBookmarks.infiniteQueryOptions(
      {
        ...query,
        sortOrder: settings.bookmarkSortOrder,
        useCursorV2: true,
        includeContent: false,
      },
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: !useOfflineFirst,
        retry: online === false ? false : undefined,
      },
    ),
  );

  const offlineList = (
    <BookmarkList
      bookmarks={offline.bookmarks.filter(
        (b) => b.content.type != BookmarkTypes.UNKNOWN,
      )}
      header={header}
      onRefresh={() => offline.refresh()}
      isRefreshing={offline.isLoading}
    />
  );

  if (useOfflineFirst) {
    // Never block the home list on sync/network. SQLite is the source of truth;
    // show an empty state once the first local read finishes.
    if (offline.isLoading && offline.bookmarks.length === 0) {
      return <FullPageSpinner />;
    }
    return offlineList;
  }

  // Network failed but we have a local cache — serve it instead of a dead end.
  // Also treat generic RN offline errors as offline even if NetInfo is still
  // "unknown" / optimistic, so we don't strand the user on "Network request failed".
  if (error && offline.bookmarks.length > 0) {
    return offlineList;
  }

  if (error) {
    const msg = error.message || "";
    const looksOffline =
      online === false ||
      /network request failed|failed to fetch|network error|timeout/i.test(msg);
    if (looksOffline) {
      return (
        <FullPageError
          error={
            offline.bookmarks.length === 0
              ? "You're offline and no bookmarks are cached yet. Go online, enable Offline mode, and sync once."
              : msg
          }
          onRetry={() => refetch()}
        />
      );
    }
    return <FullPageError error={error.message} onRetry={() => refetch()} />;
  }

  if (isPending || !data) {
    // Avoid an infinite spinner when unreachable: wait briefly then show cache/error.
    if (
      online === false &&
      !offline.isLoading &&
      offline.bookmarks.length === 0
    ) {
      return (
        <FullPageError
          error="You're offline and no bookmarks are cached yet. Enable Offline mode while online to sync."
          onRetry={() => refetch()}
        />
      );
    }
    // Local cache available while connectivity is still unknown / network pending.
    if (!offline.isLoading && offline.bookmarks.length > 0) {
      return offlineList;
    }
    return <FullPageSpinner />;
  }

  const onRefresh = () => {
    queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter());
    queryClient.invalidateQueries(api.bookmarks.getBookmark.pathFilter());
  };

  return (
    <BookmarkList
      bookmarks={data.pages
        .flatMap((p) => p.bookmarks)
        .filter((b) => b.content.type != BookmarkTypes.UNKNOWN)}
      header={header}
      onRefresh={onRefresh}
      fetchNextPage={fetchNextPage}
      isFetchingNextPage={isFetchingNextPage}
      isRefreshing={isPending || isPlaceholderData}
    />
  );
}
