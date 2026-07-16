import React from "react";
import { useQuery } from "@tanstack/react-query";

import { useTRPC } from "@karakeep/shared-react/trpc";

import useAppSettings from "./settings";
import { buildApiHeaders } from "./utils";
import { getCachedAssetUri } from "./offline/repository";

interface AssetSource {
  uri: string;
  headers: Record<string, string>;
}

export function useAssetUrl(assetId: string): AssetSource {
  const { settings } = useAppSettings();
  const [localUri, setLocalUri] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!settings.offlineEnabled || !assetId) {
      setLocalUri(null);
      return;
    }
    void getCachedAssetUri(assetId).then(setLocalUri);
  }, [assetId, settings.offlineEnabled]);

  const remoteUri = `${settings.address}/api/assets/${assetId}`;
  return {
    uri: localUri ?? remoteUri,
    headers: localUri
      ? {}
      : buildApiHeaders(settings.apiKey, settings.customHeaders),
  };
}

export function useServerVersion() {
  const { settings } = useAppSettings();

  return useQuery({
    queryKey: ["serverVersion", settings.address],
    queryFn: async () => {
      const response = await fetch(`${settings.address}/api/version`, {
        headers: buildApiHeaders(settings.apiKey, settings.customHeaders),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch server version: ${response.status}`);
      }

      const data = await response.json();
      return data.version as string;
    },
    enabled: !!settings.address,
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
}

/**
 * Hook to determine the appropriate archived filter value based on user settings.
 * Returns `false` to hide archived bookmarks, or `undefined` to show all bookmarks.
 */
export function useArchiveFilter(): {
  archived: false | undefined;
  isLoading: boolean;
} {
  const api = useTRPC();
  const { settings } = useAppSettings();
  const { data: userSettings, isLoading } = useQuery(
    api.users.settings.queryOptions(undefined, {
      // Don't block list screens forever when offline.
      enabled: !settings.offlineEnabled,
      retry: settings.offlineEnabled ? false : undefined,
    }),
  );
  return {
    archived:
      userSettings?.archiveDisplayBehaviour === "show" ? undefined : false,
    // When offline mode is on, fall through with default (hide archived).
    isLoading: settings.offlineEnabled ? false : isLoading,
  };
}
