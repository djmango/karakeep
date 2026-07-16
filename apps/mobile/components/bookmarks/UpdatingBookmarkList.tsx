import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import useAppSettings from "@/lib/settings";
import { useOfflineBookmarks } from "@/lib/offline/hooks";

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
  const offline = useOfflineBookmarks({
    archived: query.archived,
    favourited: query.favourited,
    tagId: query.tagId,
    sortOrder: settings.bookmarkSortOrder,
  });

  // When offline mode is on, SQLite is the source of truth for the list.
  // Background sync fills the cache; we never wait on the network query.
  const useOfflineFirst = settings.offlineEnabled;

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
      },
    ),
  );

  if (useOfflineFirst) {
    const waitingForFirstSyncRows =
      offline.bookmarks.length === 0 && offline.syncState === "syncing";
    if (
      (offline.isLoading && offline.bookmarks.length === 0) ||
      waitingForFirstSyncRows
    ) {
      return <FullPageSpinner />;
    }
    return (
      <BookmarkList
        bookmarks={offline.bookmarks.filter(
          (b) => b.content.type != BookmarkTypes.UNKNOWN,
        )}
        header={header}
        onRefresh={() => offline.refresh()}
        isRefreshing={offline.isLoading}
      />
    );
  }

  if (error) {
    return <FullPageError error={error.message} onRetry={() => refetch()} />;
  }

  if (isPending || !data) {
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
