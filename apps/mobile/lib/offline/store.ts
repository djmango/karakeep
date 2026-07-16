import { create } from "zustand";

import type { OfflineSyncState } from "./types";

interface OfflineStore {
  syncState: OfflineSyncState;
  pendingCount: number;
  lastSyncedAt: string | null;
  /** Bumped when SQLite cache changes so list hooks can refresh mid-sync. */
  cacheGeneration: number;
  setSyncState: (state: OfflineSyncState) => void;
  setPendingCount: (count: number) => void;
  setLastSyncedAt: (value: string | null) => void;
  bumpCacheGeneration: () => void;
}

export const useOfflineStore = create<OfflineStore>((set) => ({
  syncState: "idle",
  pendingCount: 0,
  lastSyncedAt: null,
  cacheGeneration: 0,
  setSyncState: (syncState) => set({ syncState }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
  bumpCacheGeneration: () =>
    set((state) => ({ cacheGeneration: state.cacheGeneration + 1 })),
}));
