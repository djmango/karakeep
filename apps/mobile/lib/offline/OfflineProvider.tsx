import useAppSettings from "@/lib/settings";

import { useOfflineSyncLifecycle } from "./hooks";
import { useOfflineStore } from "./store";

export function OfflineProvider({ children }: { children: React.ReactNode }) {
  useOfflineSyncLifecycle();
  return children;
}

export function useOfflineStatusLabel() {
  const { settings } = useAppSettings();
  const syncState = useOfflineStore((s) => s.syncState);
  const pendingCount = useOfflineStore((s) => s.pendingCount);

  if (!settings.offlineEnabled) {
    return null;
  }

  if (pendingCount > 0) {
    return `${pendingCount} pending`;
  }

  switch (syncState) {
    case "syncing":
      return "Syncing…";
    case "offline":
      return "Offline";
    case "error":
      return "Sync error";
    default:
      return "Synced";
  }
}
