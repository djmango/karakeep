import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";

import { useTRPC } from "@karakeep/shared-react/trpc";

import useAppSettings from "@/lib/settings";

import { getPendingSyncCount } from "./repository";
import { runOfflineSync } from "./syncEngine";
import { useOfflineStore } from "./store";

export function useOfflineSyncLifecycle() {
  const api = useTRPC();
  const { settings } = useAppSettings();
  const { setSyncState, setPendingCount, setLastSyncedAt } = useOfflineStore();

  const syncNow = useCallback(async () => {
    if (!settings.offlineEnabled) {
      return;
    }
    setSyncState("syncing");
    try {
      const state = await runOfflineSync(api, settings);
      setSyncState(state);
      setLastSyncedAt(new Date().toISOString());
    } catch {
      setSyncState("error");
    } finally {
      setPendingCount(await getPendingSyncCount());
    }
  }, [api, settings, setLastSyncedAt, setPendingCount, setSyncState]);

  useEffect(() => {
    if (!settings.offlineEnabled) {
      return;
    }
    void syncNow();
    const unsubscribe = NetInfo.addEventListener((state) => {
      if (state.isConnected) {
        void syncNow();
      } else {
        setSyncState("offline");
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
  const [bookmarks, setBookmarks] = useState<Awaited<
    ReturnType<typeof import("./repository").listBookmarks>
  >>([]);
  const [isLoading, setIsLoading] = useState(true);
  const syncState = useOfflineStore((s) => s.syncState);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    const { listBookmarks } = await import("./repository");
    const rows = await listBookmarks({
      archived: query.archived,
      favourited: query.favourited,
      tagId: query.tagId,
      sortOrder: query.sortOrder,
    });
    setBookmarks(rows);
    setIsLoading(false);
  }, [query.archived, query.favourited, query.sortOrder, query.tagId]);

  useEffect(() => {
    void refresh();
  }, [refresh, syncState]);

  return {
    bookmarks,
    isLoading,
    refresh,
    syncState,
  };
}

export function useOfflineBookmark(bookmarkId: string | undefined) {
  const [bookmark, setBookmark] = useState<Awaited<
    ReturnType<typeof import("./repository").getBookmarkById>
  >>(null);
  const api = useTRPC();
  const { settings } = useAppSettings();

  useEffect(() => {
    if (!bookmarkId) {
      return;
    }
    void (async () => {
      const { getBookmarkById } = await import("./repository");
      let local = await getBookmarkById(bookmarkId);
      if (!local && settings.offlineEnabled) {
        try {
          const { seedBookmarkFromNetwork } = await import("./syncEngine");
          local = await seedBookmarkFromNetwork(api, settings, bookmarkId);
        } catch {
          local = await getBookmarkById(bookmarkId);
        }
      }
      setBookmark(local);
    })();
  }, [api, bookmarkId, settings]);

  return bookmark;
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
      const { searchOfflineBookmarks } = await import("./search");
      setResults(await searchOfflineBookmarks(query));
      setIsLoading(false);
    })();
  }, [query]);

  return { results, isLoading };
}
