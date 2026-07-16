import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { useTRPCClient } from "@karakeep/shared-react/trpc";

import useAppSettings from "@/lib/settings";

import { getPendingSyncCount } from "./repository";
import { runOfflineSync } from "./syncEngine";
import { useOfflineStore } from "./store";

export function useOfflineSyncLifecycle() {
  const client = useTRPCClient();
  const { settings } = useAppSettings();
  const { setSyncState, setPendingCount, setLastSyncedAt } = useOfflineStore();

  const syncNow = useCallback(async () => {
    if (!settings.offlineEnabled) {
      return;
    }
    // Fail fast when the OS already knows we're offline — don't flash "syncing"
    // and don't wait on a hung fetch probe.
    const net = await NetInfo.fetch();
    if (net.isConnected === false || net.isInternetReachable === false) {
      setSyncState("offline");
      setPendingCount(await getPendingSyncCount());
      return;
    }
    setSyncState("syncing");
    try {
      const state = await runOfflineSync(client, settings);
      setSyncState(state);
      if (state === "idle") {
        setLastSyncedAt(new Date().toISOString());
      }
    } catch {
      setSyncState("error");
    } finally {
      setPendingCount(await getPendingSyncCount());
    }
  }, [client, settings, setLastSyncedAt, setPendingCount, setSyncState]);

  useEffect(() => {
    if (!settings.offlineEnabled) {
      return;
    }
    void syncNow();
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected === false || state.isInternetReachable === false) {
        setSyncState("offline");
        return;
      }
      if (state.isConnected) {
        void syncNow();
      }
    });
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void syncNow();
      }
    });
    return () => {
      unsubscribe();
      appStateSub.remove();
    };
  }, [settings.offlineEnabled, syncNow, setSyncState]);

  return { syncNow };
}

export function useOfflineBookmarks(query: {
  archived?: boolean;
  favourited?: boolean;
  tagId?: string;
  sortOrder?: "asc" | "desc";
}) {
  const [bookmarks, setBookmarks] = useState<
    Awaited<ReturnType<typeof import("./repository").listBookmarks>>
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const syncState = useOfflineStore((s) => s.syncState);
  const cacheGeneration = useOfflineStore((s) => s.cacheGeneration);

  const refresh = useCallback(async () => {
    // Only full-page load on the first read; mid-sync refreshes update quietly.
    if (!hasLoadedOnce.current) {
      setIsLoading(true);
    }
    try {
      const { listBookmarks } = await import("./repository");
      const rows = await listBookmarks({
        archived: query.archived,
        favourited: query.favourited,
        tagId: query.tagId,
        sortOrder: query.sortOrder,
      });
      setBookmarks(rows);
    } finally {
      hasLoadedOnce.current = true;
      setIsLoading(false);
    }
  }, [query.archived, query.favourited, query.sortOrder, query.tagId]);

  useEffect(() => {
    void refresh();
  }, [refresh, syncState, cacheGeneration]);

  return {
    bookmarks,
    isLoading,
    refresh,
    syncState,
  };
}

export function useOfflineBookmark(bookmarkId: string | undefined) {
  const [bookmark, setBookmark] =
    useState<
      Awaited<ReturnType<typeof import("./repository").getBookmarkById>>
    >(null);
  const [resolved, setResolved] = useState(false);
  const client = useTRPCClient();
  const { settings } = useAppSettings();

  useEffect(() => {
    if (!bookmarkId) {
      return;
    }
    let cancelled = false;
    setResolved(false);
    void (async () => {
      const { getBookmarkById } = await import("./repository");
      let local = await getBookmarkById(bookmarkId);
      // Unblock the bookmark screen immediately from SQLite — never wait on a
      // hung includeContent seed before showing something.
      if (!cancelled) {
        setBookmark(local);
        setResolved(true);
      }
      if (local || !settings.offlineEnabled || cancelled) {
        return;
      }
      const { isOnline, seedBookmarkFromNetwork } =
        await import("./syncEngine");
      if (!(await isOnline(settings))) {
        return;
      }
      try {
        local = await seedBookmarkFromNetwork(client, settings, bookmarkId);
        if (!cancelled) {
          setBookmark(local);
        }
      } catch {
        // Keep the resolved empty/error state from the local miss.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, bookmarkId, settings]);

  return { bookmark, resolved };
}

export function useBookmarkDownload(bookmarkId: string) {
  const client = useTRPCClient();
  const { settings } = useAppSettings();
  const [downloaded, setDownloaded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const cacheGeneration = useOfflineStore((s) => s.cacheGeneration);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { getBookmarkDownloadStatus } = await import("./download");
      const status = await getBookmarkDownloadStatus(bookmarkId);
      if (!cancelled) {
        setDownloaded(status.downloaded);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bookmarkId, cacheGeneration]);

  const download = useCallback(async () => {
    if (isDownloading || downloaded) {
      return;
    }
    setIsDownloading(true);
    try {
      const { downloadBookmarkForOffline } = await import("./download");
      await downloadBookmarkForOffline(client, settings, bookmarkId);
      setDownloaded(true);
    } finally {
      setIsDownloading(false);
    }
  }, [bookmarkId, client, downloaded, isDownloading, settings]);

  return { downloaded, isDownloading, download };
}

export function useOfflineSearch(query: string) {
  const [results, setResults] = useState<
    Awaited<ReturnType<typeof import("./search").searchOfflineBookmarks>>
  >([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!query.trim()) {
        setResults([]);
        return;
      }
      setIsLoading(true);
      try {
        const { searchOfflineBookmarks } = await import("./search");
        setResults(await searchOfflineBookmarks(query));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [query]);

  return { results, isLoading };
}
