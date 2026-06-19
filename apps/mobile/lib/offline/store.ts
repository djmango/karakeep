import { create } from "zustand";

import type { OfflineSyncState } from "./types";

interface OfflineStore {
  syncState: OfflineSyncState;
  pendingCount: number;
  lastSyncedAt: string | null;
  setSyncState: (state: OfflineSyncState) => void;
  setPendingCount: (count: number) => void;
  setLastSyncedAt: (value: string | null) => void;
}

export const useOfflineStore = create<OfflineStore>((set) => ({
  syncState: "idle",
  pendingCount: 0,
  lastSyncedAt: null,
  setSyncState: (syncState) => set({ syncState }),
  setPendingCount: (pendingCount) => set({ pendingCount }),
  setLastSyncedAt: (lastSyncedAt) => set({ lastSyncedAt }),
}));
