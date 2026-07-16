import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";

import {
  useCreateBookmark as useSharedCreateBookmark,
  useDeleteBookmark as useSharedDeleteBookmark,
  useUpdateBookmark as useSharedUpdateBookmark,
  useUpdateBookmarkTags as useSharedUpdateBookmarkTags,
} from "@karakeep/shared-react/hooks/bookmarks";
import {
  useAddBookmarkToList as useSharedAddBookmarkToList,
  useRemoveBookmarkFromList as useSharedRemoveBookmarkFromList,
} from "@karakeep/shared-react/hooks/lists";
import { useTRPC } from "@karakeep/shared-react/trpc";
import type {
  ZBookmark,
  ZNewBookmarkRequest,
  ZUpdateBookmarksRequest,
} from "@karakeep/shared/types/bookmarks";
import {
  BookmarkTypes,
  zManipulatedTagSchema,
} from "@karakeep/shared/types/bookmarks";

import useAppSettings from "@/lib/settings";

import { enqueueOutboxOperation } from "./outbox";
import {
  addBookmarkToListLocal,
  getPendingSyncCount,
  markBookmarkDeleted,
  removeBookmarkFromListLocal,
  upsertBookmark,
} from "./repository";
import { useOfflineStore } from "./store";
import { isOnline } from "./syncEngine";

type ManipulatedTag = z.infer<typeof zManipulatedTagSchema>;

function newLocalBookmarkId() {
  return `local-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;
}

export function useOfflineCreateBookmark(
  opts?: Parameters<typeof useSharedCreateBookmark>[0],
) {
  const { settings } = useAppSettings();
  const onlineMutation = useSharedCreateBookmark(opts);
  const queryClient = useQueryClient();
  const api = useTRPC();
  const setPendingCount = useOfflineStore((s) => s.setPendingCount);

  return useMutation({
    mutationFn: async (input: ZNewBookmarkRequest) => {
      if (settings.offlineEnabled && !(await isOnline(settings))) {
        const localId = newLocalBookmarkId();
        const now = new Date();
        const optimistic = {
          id: localId,
          createdAt: now,
          modifiedAt: now,
          title: input.title ?? null,
          archived: input.archived ?? false,
          favourited: input.favourited ?? false,
          taggingStatus: null,
          summarizationStatus: null,
          embeddingStatus: null,
          note: input.note ?? null,
          summary: input.summary ?? null,
          source: input.source ?? "mobile",
          userId: "local",
          tags: [],
          assets: [],
          content:
            input.type === BookmarkTypes.LINK
              ? {
                  type: BookmarkTypes.LINK,
                  url: input.url,
                  title: null,
                  description: null,
                  imageUrl: null,
                  imageAssetId: null,
                  screenshotAssetId: null,
                  pdfAssetId: null,
                  fullPageArchiveAssetId: null,
                  precrawledArchiveAssetId: null,
                  videoAssetId: null,
                  favicon: null,
                  htmlContent: null,
                  contentAssetId: null,
                  crawledAt: null,
                  crawlStatus: null,
                  author: null,
                  publisher: null,
                  datePublished: null,
                  dateModified: null,
                }
              : input.type === BookmarkTypes.TEXT
                ? {
                    type: BookmarkTypes.TEXT,
                    text: input.text,
                    sourceUrl: input.sourceUrl ?? null,
                  }
                : {
                    type: BookmarkTypes.ASSET,
                    assetType: input.assetType,
                    assetId: input.assetId,
                    fileName: input.fileName ?? null,
                    sourceUrl: input.sourceUrl ?? null,
                    size: null,
                    content: null,
                  },
        } satisfies ZBookmark;
        await upsertBookmark(optimistic, {
          localId,
          pendingSync: true,
        });
        await enqueueOutboxOperation({
          type: "bookmark.create",
          payload: { ...input, clientBookmarkId: localId },
        });
        setPendingCount(await getPendingSyncCount());
        return { ...optimistic, alreadyExists: false };
      }
      return onlineMutation.mutateAsync(input);
    },
    onSuccess: (res, req, meta, context) => {
      queryClient.invalidateQueries(api.bookmarks.getBookmarks.pathFilter());
      return opts?.onSuccess?.(res, req, meta, context);
    },
  });
}

export function useOfflineUpdateBookmark(
  opts?: Parameters<typeof useSharedUpdateBookmark>[0],
) {
  const { settings } = useAppSettings();
  const onlineMutation = useSharedUpdateBookmark(opts);
  const setPendingCount = useOfflineStore((s) => s.setPendingCount);

  return useMutation({
    mutationFn: async (input: ZUpdateBookmarksRequest) => {
      if (settings.offlineEnabled && !(await isOnline(settings))) {
        const { getBookmarkById } = await import("./repository");
        const existing = await getBookmarkById(input.bookmarkId);
        if (!existing) {
          throw new Error("Bookmark not found offline");
        }
        const updated: ZBookmark = {
          ...existing,
          ...input,
          modifiedAt: new Date(),
        };
        await upsertBookmark(updated, { pendingSync: true });
        await enqueueOutboxOperation({
          type: "bookmark.update",
          payload: {
            bookmarkId: input.bookmarkId,
            baseModifiedAt: existing.modifiedAt ?? existing.createdAt,
            patch: input,
          },
        });
        setPendingCount(await getPendingSyncCount());
        return updated;
      }
      return onlineMutation.mutateAsync(input);
    },
    onSuccess: opts?.onSuccess,
  });
}

export function useOfflineDeleteBookmark(
  opts?: Parameters<typeof useSharedDeleteBookmark>[0],
) {
  const { settings } = useAppSettings();
  const onlineMutation = useSharedDeleteBookmark(opts);
  const setPendingCount = useOfflineStore((s) => s.setPendingCount);

  return useMutation({
    mutationFn: async (input: { bookmarkId: string }) => {
      if (settings.offlineEnabled && !(await isOnline(settings))) {
        await markBookmarkDeleted(input.bookmarkId);
        await enqueueOutboxOperation({
          type: "bookmark.delete",
          payload: {
            bookmarkId: input.bookmarkId,
          },
        });
        setPendingCount(await getPendingSyncCount());
        return;
      }
      return onlineMutation.mutateAsync(input);
    },
    onSuccess: opts?.onSuccess,
  });
}

export function useOfflineUpdateBookmarkTags(
  opts?: Parameters<typeof useSharedUpdateBookmarkTags>[0],
) {
  const { settings } = useAppSettings();
  const onlineMutation = useSharedUpdateBookmarkTags(opts);
  const setPendingCount = useOfflineStore((s) => s.setPendingCount);

  return useMutation({
    mutationFn: async (input: {
      bookmarkId: string;
      attach: ManipulatedTag[];
      detach: ManipulatedTag[];
    }) => {
      if (settings.offlineEnabled && !(await isOnline(settings))) {
        const { getBookmarkById } = await import("./repository");
        const existing = await getBookmarkById(input.bookmarkId);
        if (!existing) {
          throw new Error("Bookmark not found offline");
        }
        const detachKeys = new Set(
          input.detach.flatMap((tag) =>
            tag.tagId ? [tag.tagId] : tag.tagName ? [tag.tagName] : [],
          ),
        );
        const tags = existing.tags.filter(
          (tag) => !detachKeys.has(tag.id) && !detachKeys.has(tag.name),
        );
        for (const tag of input.attach) {
          if (tag.tagId) {
            if (!tags.some((existingTag) => existingTag.id === tag.tagId)) {
              tags.push({
                id: tag.tagId,
                name: tag.tagName ?? tag.tagId,
                attachedBy: tag.attachedBy ?? "human",
              });
            }
          } else if (
            tag.tagName &&
            !tags.some(
              (existingTag) =>
                existingTag.name.toLowerCase() === tag.tagName!.toLowerCase(),
            )
          ) {
            tags.push({
              id: `local-tag-${tag.tagName}`,
              name: tag.tagName,
              attachedBy: tag.attachedBy ?? "human",
            });
          }
        }
        const updated: ZBookmark = {
          ...existing,
          tags,
          modifiedAt: new Date(),
        };
        await upsertBookmark(updated, { pendingSync: true });
        await enqueueOutboxOperation({
          type: "bookmark.updateTags",
          payload: {
            bookmarkId: input.bookmarkId,
            attach: input.attach,
            detach: input.detach,
            baseModifiedAt: existing.modifiedAt ?? existing.createdAt,
          },
        });
        setPendingCount(await getPendingSyncCount());
        return {
          attached: input.attach
            .map((tag) => tag.tagId)
            .filter((id): id is string => !!id),
          detached: input.detach
            .map((tag) => tag.tagId)
            .filter((id): id is string => !!id),
        };
      }
      return onlineMutation.mutateAsync(input);
    },
    onSuccess: opts?.onSuccess,
  });
}

export function useOfflineAddBookmarkToList(
  opts?: Parameters<typeof useSharedAddBookmarkToList>[0],
) {
  const { settings } = useAppSettings();
  const onlineMutation = useSharedAddBookmarkToList(opts);
  const setPendingCount = useOfflineStore((s) => s.setPendingCount);

  return useMutation({
    mutationFn: async (input: { bookmarkId: string; listId: string }) => {
      if (settings.offlineEnabled && !(await isOnline(settings))) {
        await addBookmarkToListLocal(input.bookmarkId, input.listId);
        await enqueueOutboxOperation({
          type: "list.addToList",
          payload: input,
        });
        setPendingCount(await getPendingSyncCount());
        return;
      }
      return onlineMutation.mutateAsync(input);
    },
    onSuccess: opts?.onSuccess,
  });
}

export function useOfflineRemoveBookmarkFromList(
  opts?: Parameters<typeof useSharedRemoveBookmarkFromList>[0],
) {
  const { settings } = useAppSettings();
  const onlineMutation = useSharedRemoveBookmarkFromList(opts);
  const setPendingCount = useOfflineStore((s) => s.setPendingCount);

  return useMutation({
    mutationFn: async (input: { bookmarkId: string; listId: string }) => {
      if (settings.offlineEnabled && !(await isOnline(settings))) {
        await removeBookmarkFromListLocal(input.bookmarkId, input.listId);
        await enqueueOutboxOperation({
          type: "list.removeFromList",
          payload: input,
        });
        setPendingCount(await getPendingSyncCount());
        return;
      }
      return onlineMutation.mutateAsync(input);
    },
    onSuccess: opts?.onSuccess,
  });
}

export const useUpdateBookmark = useOfflineUpdateBookmark;
export const useDeleteBookmark = useOfflineDeleteBookmark;
