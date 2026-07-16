import type { ToolbarActionId } from "@/lib/settings";
import type { LucideIcon } from "lucide-react-native";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { GlassView } from "expo-glass-effect";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { TailwindResolver } from "@/components/TailwindResolver";
import { useToast } from "@/components/ui/Toast";
import { shouldUseGlassPill } from "@/lib/ios";
import { useBookmarkDownload } from "@/lib/offline/hooks";
import useAppSettings, { ensureDownloadToolbarAction } from "@/lib/settings";
import { shareBookmark } from "@/lib/shareBookmark";
import { useMenuIconColors } from "@/lib/useMenuIconColors";
import { MenuAction, MenuView } from "@react-native-menu/menu";
import {
  Archive,
  CheckCircle2,
  ClipboardList,
  Download,
  Ellipsis,
  Globe,
  Info,
  ShareIcon,
  Star,
  Tag,
  Trash2,
} from "lucide-react-native";

import { useDeleteBookmark, useUpdateBookmark } from "@/lib/offline/mutations";
import { useWhoAmI } from "@karakeep/shared-react/hooks/users";
import { BookmarkTypes, ZBookmark } from "@karakeep/shared/types/bookmarks";

const TOOLBAR_ICON_GAP = 28;

function triggerHaptic() {
  Haptics.selectionAsync().catch(() => {
    // Ignore — haptics unavailable (e.g. simulator)
  });
}

interface ToolbarActionMeta {
  label: string;
  render: (b: ZBookmark) => string;
  Icon: LucideIcon;
  sfSymbol: string;
}

export const TOOLBAR_ACTION_REGISTRY: Record<
  ToolbarActionId,
  ToolbarActionMeta
> = {
  lists: {
    label: "Lists",
    render: () => "Lists",
    Icon: ClipboardList,
    sfSymbol: "list.bullet",
  },
  tags: { label: "Tags", render: () => "Tags", Icon: Tag, sfSymbol: "tag" },
  info: {
    label: "Info",
    render: () => "Info",
    Icon: Info,
    sfSymbol: "info.circle",
  },
  favourite: {
    label: "Favourite",
    render: (b) => (b.favourited ? "Unfavourite" : "Favourite"),
    Icon: Star,
    sfSymbol: "star",
  },
  archive: {
    label: "Archive",
    render: (b) => (b.archived ? "Un-archive" : "Archive"),
    Icon: Archive,
    sfSymbol: "archivebox",
  },
  browser: {
    label: "Open in Browser",
    render: () => "Open in Browser",
    Icon: Globe,
    sfSymbol: "safari",
  },
  share: {
    label: "Share",
    render: () => "Share",
    Icon: ShareIcon,
    sfSymbol: "square.and.arrow.up",
  },
  download: {
    label: "Download",
    render: () => "Download for Offline",
    Icon: Download,
    sfSymbol: "arrow.down.circle",
  },
  delete: {
    label: "Delete",
    render: () => "Delete",
    Icon: Trash2,
    sfSymbol: "trash",
  },
};

interface ToolbarAction {
  id: ToolbarActionId;
  icon: React.ReactNode;
  shouldRender: boolean;
  onClick: () => void;
  disabled: boolean;
}

function useToolbarActions(bookmark: ZBookmark) {
  const { toast } = useToast();
  const router = useRouter();
  const { settings } = useAppSettings();
  const { data: currentUser } = useWhoAmI();
  const {
    downloaded,
    isDownloading,
    download: downloadBookmark,
    remove: removeOfflineDownload,
  } = useBookmarkDownload(bookmark.id);

  const isOwner = currentUser?.id === bookmark.userId;

  const { mutate: deleteBookmark, isPending: isDeletionPending } =
    useDeleteBookmark({
      onSuccess: () => {
        router.back();
        toast({
          message: "The bookmark has been deleted!",
          showProgress: false,
        });
      },
      onError: () => {
        toast({
          message: "Something went wrong",
          variant: "destructive",
          showProgress: false,
        });
      },
    });

  const { mutate: favouriteBookmark, isPending: isFavouritePending } =
    useUpdateBookmark({
      onError: () => {
        toast({
          message: "Something went wrong",
          variant: "destructive",
          showProgress: false,
        });
      },
    });

  const { mutate: archiveBookmark, isPending: isArchivePending } =
    useUpdateBookmark({
      onSuccess: (resp) => {
        router.back();
        toast({
          message: `The bookmark has been ${resp.archived ? "archived" : "un-archived"}!`,
          showProgress: false,
        });
      },
      onError: () => {
        toast({
          message: "Something went wrong",
          variant: "destructive",
          showProgress: false,
        });
      },
    });

  const deleteBookmarkAlert = () =>
    Alert.alert(
      "Delete bookmark?",
      "Are you sure you want to delete this bookmark?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          onPress: () => deleteBookmark({ bookmarkId: bookmark.id }),
          style: "destructive",
        },
      ],
    );

  const handleShare = () => shareBookmark(bookmark, settings, toast);

  const makeIcon = (
    IconComp: LucideIcon,
    overrideColor?: string,
    fill?: string,
  ) => (
    <TailwindResolver
      className="text-foreground"
      comp={(styles) => (
        <IconComp
          size={22}
          color={overrideColor ?? styles?.color?.toString()}
          {...(fill != null && { fill })}
        />
      )}
    />
  );

  const allActions: Record<ToolbarActionId, ToolbarAction> = {
    lists: {
      id: "lists",
      icon: makeIcon(ClipboardList),
      shouldRender: isOwner,
      onClick: () =>
        router.push(`/dashboard/bookmarks/${bookmark.id}/manage_lists`),
      disabled: false,
    },
    tags: {
      id: "tags",
      icon: makeIcon(Tag),
      shouldRender: isOwner,
      onClick: () =>
        router.push(`/dashboard/bookmarks/${bookmark.id}/manage_tags`),
      disabled: false,
    },
    info: {
      id: "info",
      icon: makeIcon(Info),
      shouldRender: true,
      onClick: () => router.push(`/dashboard/bookmarks/${bookmark.id}/info`),
      disabled: false,
    },
    favourite: {
      id: "favourite",
      icon: bookmark.favourited
        ? makeIcon(Star, "#ebb434", "#ebb434")
        : makeIcon(Star),
      shouldRender: isOwner,
      onClick: () => {
        triggerHaptic();
        favouriteBookmark({
          bookmarkId: bookmark.id,
          favourited: !bookmark.favourited,
        });
      },
      disabled: isFavouritePending,
    },
    archive: {
      id: "archive",
      icon: makeIcon(Archive),
      shouldRender: isOwner,
      onClick: () => {
        archiveBookmark({
          bookmarkId: bookmark.id,
          archived: !bookmark.archived,
        });
      },
      disabled: isArchivePending,
    },
    browser: {
      id: "browser",
      icon: makeIcon(Globe),
      shouldRender: bookmark.content.type === BookmarkTypes.LINK,
      onClick: () => {
        if (bookmark.content.type !== BookmarkTypes.LINK) return;
        Linking.openURL(bookmark.content.url).catch(() => {
          toast({
            message: "Failed to open link",
            variant: "destructive",
            showProgress: false,
          });
        });
      },
      disabled: false,
    },
    share: {
      id: "share",
      icon: makeIcon(ShareIcon),
      shouldRender: true,
      onClick: () => {
        triggerHaptic();
        handleShare();
      },
      disabled: false,
    },
    download: {
      id: "download",
      icon: isDownloading ? (
        <ActivityIndicator size="small" />
      ) : downloaded ? (
        makeIcon(CheckCircle2, "#16a34a")
      ) : (
        makeIcon(Download)
      ),
      shouldRender:
        settings.offlineEnabled &&
        (bookmark.content.type === BookmarkTypes.LINK ||
          bookmark.content.type === BookmarkTypes.ASSET),
      onClick: () => {
        if (isDownloading) {
          return;
        }
        if (downloaded) {
          Alert.alert(
            "Remove offline copy?",
            "Frees local storage. The bookmark stays. Opening it again while online will re-download.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Remove",
                style: "destructive",
                onPress: () => {
                  triggerHaptic();
                  void removeOfflineDownload()
                    .then(() => {
                      toast({
                        message: "Removed offline copy",
                        showProgress: false,
                      });
                    })
                    .catch(() => {
                      toast({
                        message: "Failed to remove offline copy",
                        variant: "destructive",
                        showProgress: false,
                      });
                    });
                },
              },
            ],
          );
          return;
        }
        triggerHaptic();
        void downloadBookmark()
          .then(() => {
            toast({
              message: "Saved offline",
              showProgress: false,
            });
          })
          .catch(() => {
            toast({
              message: "Download failed",
              variant: "destructive",
              showProgress: false,
            });
          });
      },
      disabled: isDownloading,
    },
    delete: {
      id: "delete",
      icon: makeIcon(Trash2),
      shouldRender: isOwner,
      onClick: deleteBookmarkAlert,
      disabled: isDeletionPending,
    },
  };

  // Saved toolbar layouts from before Download existed omit it entirely.
  // Re-inject at render so Offline mode always exposes the control.
  const toolbarLayout = ensureDownloadToolbarAction(settings);

  const barActions = toolbarLayout.toolbarActions
    .map((id) => allActions[id])
    .filter((a): a is ToolbarAction => a !== undefined);

  const overflowActions = (toolbarLayout.overflowActions ?? [])
    .map((id) => allActions[id])
    .filter((a): a is ToolbarAction => a !== undefined);

  return { barActions, overflowActions, allActions, downloaded };
}

function ToolbarContainer({
  children,
  bottomMargin,
  bottomInset,
}: {
  children: React.ReactNode;
  bottomMargin: number;
  bottomInset: number;
}) {
  const innerRow = (
    <View
      style={{
        alignSelf: "center",
        flexDirection: "row",
        alignItems: "center",
        gap: TOOLBAR_ICON_GAP,
      }}
    >
      {children}
    </View>
  );

  if (shouldUseGlassPill) {
    return (
      <GlassView
        glassEffectStyle="regular"
        style={{
          borderRadius: 22,
          marginHorizontal: 16,
          alignSelf: "center",
          marginBottom: bottomMargin,
          paddingVertical: 10,
          paddingHorizontal: 20,
        }}
      >
        {innerRow}
      </GlassView>
    );
  }

  const fallbackStyle = {
    paddingHorizontal: 40,
    paddingTop: 16,
    paddingBottom: bottomInset + 16,
  };

  if (Platform.OS === "ios") {
    return (
      <BlurView tint="systemMaterial" intensity={80} style={fallbackStyle}>
        {innerRow}
      </BlurView>
    );
  }

  return (
    <View className="bg-background" style={fallbackStyle}>
      {innerRow}
    </View>
  );
}

interface BottomActionsProps {
  bookmark: ZBookmark;
}

export default function BottomActions({ bookmark }: BottomActionsProps) {
  const { barActions, overflowActions, allActions, downloaded } =
    useToolbarActions(bookmark);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { menuIconColor, destructiveMenuIconColor } = useMenuIconColors();

  const bottomMargin = shouldUseGlassPill ? Math.max(insets.bottom - 8, 4) : 8;

  // Build native menu actions for the overflow ellipsis
  const menuActions: MenuAction[] = overflowActions
    .filter((a) => a.shouldRender)
    .map((a) => {
      const meta = TOOLBAR_ACTION_REGISTRY[a.id];
      const title =
        a.id === "download"
          ? downloaded
            ? "Remove Offline Copy"
            : "Download for Offline"
          : meta.render(bookmark);
      return {
        id: a.id,
        title,
        image: Platform.select({
          ios:
            a.id === "download" && downloaded
              ? "checkmark.circle.fill"
              : meta.sfSymbol,
          default: undefined,
        }),
        imageColor:
          a.id === "delete" || (a.id === "download" && downloaded)
            ? destructiveMenuIconColor
            : menuIconColor,
        attributes: {
          ...((a.id === "delete" || (a.id === "download" && downloaded)) && {
            destructive: true as const,
          }),
          ...(a.disabled && { disabled: true as const }),
        },
      };
    });

  // Add separator + "Edit Toolbar..." at the bottom
  const menuActionsWithEdit: MenuAction[] = [
    ...(menuActions.length > 0
      ? [
          {
            id: "overflow-group",
            // DisplayInline doesn't seem to be working on android
            title: Platform.OS === "ios" ? "" : "More Actions",
            displayInline: true as const,
            subactions: menuActions,
          },
        ]
      : []),
    {
      id: "edit-toolbar",
      title: "Edit Toolbar...",
      image: Platform.select({
        ios: "slider.horizontal.3",
        default: undefined,
      }),
      imageColor: menuIconColor,
    },
  ];

  const handleMenuAction = (event: string) => {
    if (event === "edit-toolbar") {
      router.push("/dashboard/settings/toolbar-settings");
      return;
    }
    const action = allActions[event as ToolbarActionId];
    if (action) {
      action.onClick();
    } else {
      console.warn(`Unknown menu action: "${event}"`);
    }
  };

  return (
    <View>
      <ToolbarContainer bottomMargin={bottomMargin} bottomInset={insets.bottom}>
        {barActions.map(
          (a) =>
            a.shouldRender && (
              <Pressable
                disabled={a.disabled}
                key={a.id}
                onPress={a.onClick}
                className="py-auto"
              >
                {a.icon}
              </Pressable>
            ),
        )}
        <MenuView
          onPressAction={({ nativeEvent }) => {
            triggerHaptic();
            handleMenuAction(nativeEvent.event);
          }}
          actions={menuActionsWithEdit}
          shouldOpenOnLongPress={false}
        >
          <Pressable onPress={() => triggerHaptic()}>
            <TailwindResolver
              className="text-foreground"
              comp={(styles) => (
                <Ellipsis size={22} color={styles?.color?.toString()} />
              )}
            />
          </Pressable>
        </MenuView>
      </ToolbarContainer>
    </View>
  );
}
