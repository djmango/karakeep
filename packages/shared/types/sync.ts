import { z } from "zod";

import { zBookmarkSchema } from "./bookmarks";
import { zBookmarkListSchema } from "./lists";
import { zBookmarkTagSchema } from "./tags";

export const SYNC_ENTITY_TYPES = [
  "bookmark",
  "tag",
  "list",
  "bookmarkTag",
  "bookmarkList",
] as const;

export const SYNC_OPERATIONS = ["create", "update", "delete"] as const;

export const zSyncEntityTypeSchema = z.enum(SYNC_ENTITY_TYPES);
export type ZSyncEntityType = z.infer<typeof zSyncEntityTypeSchema>;

export const zSyncOperationSchema = z.enum(SYNC_OPERATIONS);
export type ZSyncOperation = z.infer<typeof zSyncOperationSchema>;

export const zSyncEventSchema = z.object({
  sequence: z.number().int().positive(),
  entityType: zSyncEntityTypeSchema,
  entityId: z.string(),
  operation: zSyncOperationSchema,
  modifiedAt: z.date(),
  bookmarkId: z.string().optional(),
  data: z.unknown().optional(),
});
export type ZSyncEvent = z.infer<typeof zSyncEventSchema>;

export const zSyncPullRequestSchema = z.object({
  cursor: z.number().int().nonnegative().optional().default(0),
  limit: z.number().int().min(1).max(500).optional().default(100),
});
export type ZSyncPullRequest = z.infer<typeof zSyncPullRequestSchema>;

export const zSyncPullResponseSchema = z.object({
  events: z.array(zSyncEventSchema),
  nextCursor: z.number().int().nonnegative().nullable(),
  serverTime: z.date(),
});
export type ZSyncPullResponse = z.infer<typeof zSyncPullResponseSchema>;

export const zSyncPushOperationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("bookmark.create"),
    payload: z.record(z.string(), z.unknown()),
  }),
  z.object({
    id: z.string(),
    type: z.literal("bookmark.update"),
    payload: z.object({
      bookmarkId: z.string(),
      baseModifiedAt: z.date().optional(),
      patch: z.record(z.string(), z.unknown()),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("bookmark.delete"),
    payload: z.object({
      bookmarkId: z.string(),
      baseModifiedAt: z.date().optional(),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("bookmark.updateTags"),
    payload: z.object({
      bookmarkId: z.string(),
      attach: z.array(z.record(z.string(), z.unknown())),
      detach: z.array(z.record(z.string(), z.unknown())),
      baseModifiedAt: z.date().optional(),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("list.addToList"),
    payload: z.object({
      bookmarkId: z.string(),
      listId: z.string(),
    }),
  }),
  z.object({
    id: z.string(),
    type: z.literal("list.removeFromList"),
    payload: z.object({
      bookmarkId: z.string(),
      listId: z.string(),
    }),
  }),
]);
export type ZSyncPushOperation = z.infer<typeof zSyncPushOperationSchema>;

export const zSyncPushRequestSchema = z.object({
  operations: z.array(zSyncPushOperationSchema).max(100),
});
export type ZSyncPushRequest = z.infer<typeof zSyncPushRequestSchema>;

export const zSyncPushResultSchema = z.object({
  operationId: z.string(),
  status: z.enum(["applied", "duplicate", "conflict", "error"]),
  message: z.string().optional(),
  bookmark: zBookmarkSchema.optional(),
  tag: zBookmarkTagSchema.optional(),
  list: zBookmarkListSchema.optional(),
});
export type ZSyncPushResult = z.infer<typeof zSyncPushResultSchema>;

export const zSyncPushResponseSchema = z.object({
  results: z.array(zSyncPushResultSchema),
  serverTime: z.date(),
});
export type ZSyncPushResponse = z.infer<typeof zSyncPushResponseSchema>;

export const zSyncStatusSchema = z.object({
  enabled: z.boolean(),
  latestSequence: z.number().int().nonnegative(),
  pendingClientOperations: z.number().int().nonnegative().optional(),
});
export type ZSyncStatus = z.infer<typeof zSyncStatusSchema>;
