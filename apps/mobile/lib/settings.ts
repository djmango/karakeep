import { useEffect } from "react";
import Constants from "expo-constants";
import * as FileSystem from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { z } from "zod";
import { create } from "zustand";

import { zReaderFontFamilySchema } from "@karakeep/shared/types/users";

const SETTING_NAME = "settings";

/** Explicit keychain service avoids iOS 26 SecureStore NSExceptions. */
const SECURE_STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainService:
    Constants.expoConfig?.ios?.bundleIdentifier ?? "gg.skg.karakeep",
};

async function readSecureSettings(): Promise<string | null> {
  try {
    const withService = await SecureStore.getItemAsync(
      SETTING_NAME,
      SECURE_STORE_OPTIONS,
    );
    if (withService != null) {
      return withService;
    }
  } catch (err) {
    console.warn("[settings] SecureStore read with service failed", err);
  }
  try {
    // Migrate values written before keychainService was set.
    const legacy = await SecureStore.getItemAsync(SETTING_NAME);
    if (legacy != null) {
      try {
        await SecureStore.setItemAsync(
          SETTING_NAME,
          legacy,
          SECURE_STORE_OPTIONS,
        );
      } catch {
        // Keep returning the legacy value even if migration write fails.
      }
      return legacy;
    }
  } catch (err) {
    console.warn("[settings] SecureStore legacy read failed", err);
  }
  return null;
}

const zToolbarActionId = z.enum([
  "lists",
  "tags",
  "info",
  "favourite",
  "archive",
  "browser",
  "share",
  "download",
  "delete",
]);

export type ToolbarActionId = z.infer<typeof zToolbarActionId>;

export const DEFAULT_TOOLBAR_ACTIONS: ToolbarActionId[] = [
  "lists",
  "tags",
  "info",
  "favourite",
  "download",
  "share",
  "browser",
];

export const DEFAULT_OVERFLOW_ACTIONS: ToolbarActionId[] = [
  "archive",
  "delete",
];

const zSettingsSchema = z.object({
  apiKey: z.string().optional(),
  apiKeyId: z.string().optional(),
  address: z.string().optional().default("https://cloud.karakeep.app"),
  imageQuality: z.number().optional().default(0.2),
  theme: z.enum(["light", "dark", "system"]).optional().default("system"),
  defaultBookmarkView: z
    .enum(["reader", "browser", "externalBrowser"])
    .optional()
    .default("reader"),
  bookmarkLayout: z.enum(["card", "list"]).optional().default("list"),
  bookmarkSortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
  showNotes: z.boolean().optional().default(false),
  keepScreenOnWhileReading: z.boolean().optional().default(false),
  customHeaders: z.record(z.string(), z.string()).optional().default({}),
  // Reader settings (local device overrides)
  readerFontSize: z.number().int().min(12).max(24).optional(),
  readerLineHeight: z.number().min(1.2).max(2.5).optional(),
  readerFontFamily: zReaderFontFamilySchema.optional(),
  // Toolbar customization
  toolbarActions: z
    .array(zToolbarActionId)
    .optional()
    .default(DEFAULT_TOOLBAR_ACTIONS),
  overflowActions: z
    .array(zToolbarActionId)
    .optional()
    .default(DEFAULT_OVERFLOW_ACTIONS),
  // Default off: first sync with content+asset mirroring can starve the UI.
  offlineEnabled: z.boolean().optional().default(false),
  offlineMaxCacheSizeMb: z.number().int().positive().optional().default(1024),
  offlineSyncOnCellular: z.boolean().optional().default(false),
  offlineCacheReaderHtml: z.boolean().optional().default(true),
  offlineCacheImages: z.boolean().optional().default(true),
  offlineCachePdfs: z.boolean().optional().default(true),
  offlineCacheArchives: z.boolean().optional().default(false),
});

export type Settings = z.infer<typeof zSettingsSchema>;

interface AppSettingsState {
  settings: { isLoading: boolean; settings: Settings };
  setSettings: (settings: Settings) => Promise<void>;
  load: () => Promise<void>;
}

const useSettings = create<AppSettingsState>((set, get) => ({
  settings: {
    isLoading: true,
    settings: {
      address: "https://cloud.karakeep.app",
      imageQuality: 0.2,
      theme: "system",
      defaultBookmarkView: "reader",
      bookmarkLayout: "list",
      bookmarkSortOrder: "desc",
      showNotes: false,
      keepScreenOnWhileReading: false,
      customHeaders: {},
      toolbarActions: DEFAULT_TOOLBAR_ACTIONS,
      overflowActions: DEFAULT_OVERFLOW_ACTIONS,
      offlineEnabled: false,
      offlineMaxCacheSizeMb: 1024,
      offlineSyncOnCellular: false,
      offlineCacheReaderHtml: true,
      offlineCacheImages: true,
      offlineCachePdfs: true,
      offlineCacheArchives: false,
    },
  },
  setSettings: async (settings) => {
    try {
      await SecureStore.setItemAsync(
        SETTING_NAME,
        JSON.stringify(settings),
        SECURE_STORE_OPTIONS,
      );
    } catch (err) {
      console.warn("[settings] SecureStore write failed", err);
    }
    set((_state) => ({ settings: { isLoading: false, settings } }));
  },
  load: async () => {
    if (!get().settings.isLoading) {
      return;
    }
    let strVal = await readSecureSettings();
    // Dev-only: Documents/e2e-settings.json seeds SecureStore for simulator tests.
    if (__DEV__ && FileSystem.documentDirectory) {
      const e2ePath = `${FileSystem.documentDirectory}e2e-settings.json`;
      try {
        const info = await FileSystem.getInfoAsync(e2ePath);
        if (info.exists) {
          strVal = await FileSystem.readAsStringAsync(e2ePath);
          try {
            await SecureStore.setItemAsync(
              SETTING_NAME,
              strVal,
              SECURE_STORE_OPTIONS,
            );
          } catch {
            // Ignore SecureStore failures during e2e seed.
          }
          await FileSystem.deleteAsync(e2ePath, { idempotent: true });
        }
      } catch {
        // Ignore e2e seed failures.
      }
    }
    if (!strVal) {
      set((state) => ({
        settings: { isLoading: false, settings: state.settings.settings },
      }));
      return;
    }
    const parsed = zSettingsSchema.safeParse(JSON.parse(strVal));
    if (!parsed.success) {
      // Wipe the state if invalid
      set((state) => ({
        settings: { isLoading: false, settings: state.settings.settings },
      }));
      return;
    }

    // Ensure any new action IDs (added in future updates) appear in overflow
    const knownIds = new Set([
      ...parsed.data.toolbarActions,
      ...parsed.data.overflowActions,
    ]);
    // Download belongs on the main toolbar, not buried in overflow.
    if (!knownIds.has("download")) {
      const shareIdx = parsed.data.toolbarActions.indexOf("share");
      if (shareIdx >= 0) {
        parsed.data.toolbarActions.splice(shareIdx, 0, "download");
      } else {
        parsed.data.toolbarActions.push("download");
      }
      knownIds.add("download");
    }
    const missing = zToolbarActionId.options.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      parsed.data.overflowActions = [
        ...parsed.data.overflowActions,
        ...missing,
      ];
    }

    set((_state) => ({
      settings: { isLoading: false, settings: parsed.data },
    }));
  },
}));

export default function useAppSettings() {
  const { settings, setSettings, load } = useSettings();

  useEffect(() => {
    if (settings.isLoading) {
      load();
    }
  }, [load, settings.isLoading]);

  return { ...settings, setSettings, load };
}

export { useSettings };
