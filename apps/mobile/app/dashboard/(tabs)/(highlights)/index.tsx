import FullPageError from "@/components/FullPageError";
import HighlightList from "@/components/highlights/HighlightList";
import EmptyState from "@/components/ui/EmptyState";
import FullPageSpinner from "@/components/ui/FullPageSpinner";
import useAppSettings from "@/lib/settings";
import { useIsAppOnline } from "@/lib/offline/useIsAppOnline";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Highlighter } from "lucide-react-native";

import { useTRPC } from "@karakeep/shared-react/trpc";

export default function Highlights() {
  const api = useTRPC();
  const queryClient = useQueryClient();
  const { settings } = useAppSettings();
  const online = useIsAppOnline();
  const highlightsEnabled = !settings.offlineEnabled || online === true;
  const {
    data,
    isPending,
    isPlaceholderData,
    error,
    fetchNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteQuery(
    api.highlights.getAll.infiniteQueryOptions(
      {},
      {
        initialCursor: null,
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        enabled: highlightsEnabled,
      },
    ),
  );

  if (settings.offlineEnabled && online !== true && !data) {
    return (
      <EmptyState
        icon={Highlighter}
        title="Highlights unavailable offline"
        subtitle="Connect to the internet to browse highlights"
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
    queryClient.invalidateQueries(api.highlights.getAll.pathFilter());
  };

  return (
    <HighlightList
      highlights={data.pages.flatMap((p) => p.highlights)}
      onRefresh={onRefresh}
      fetchNextPage={fetchNextPage}
      isFetchingNextPage={isFetchingNextPage}
      isRefreshing={isPending || isPlaceholderData}
    />
  );
}
