import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

import useAppSettings from "@/lib/settings";

import { isOnline } from "./syncEngine";

/** Lightweight connectivity signal for offline UI (not for sync). */
export function useIsAppOnline() {
  const { settings } = useAppSettings();
  const [online, setOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const value = await isOnline(settings);
      if (!cancelled) {
        setOnline(value);
      }
    };
    void refresh();
    const unsub = NetInfo.addEventListener((state) => {
      if (state.isConnected === false || state.isInternetReachable === false) {
        setOnline(false);
        return;
      }
      void refresh();
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, [settings]);

  return online;
}
