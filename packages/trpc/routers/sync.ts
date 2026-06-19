import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";

import { bookmarks } from "@karakeep/db/schema";
import {
  zSyncPullRequestSchema,
  zSyncPullResponseSchema,
  zSyncPushRequestSchema,
  zSyncPushResponseSchema,
  zSyncStatusSchema,
} from "@karakeep/shared/types/sync";
import { zNewBookmarkRequestSchema } from "@karakeep/shared/types/bookmarks";
import { zManipulatedTagSchema } from "@karakeep/shared/types/bookmarks";

import type { AuthedContext } from "../index";
import { createCallerFactory, createScopedAuthedProcedure, router } from "../index";
import { Bookmark } from "../models/bookmarks";
import {
  getLatestSyncSequence,
  isOperationApplied,
  markOperationApplied,
  pullSyncEvents,
} from "../lib/syncEvents";
import { bookmarksAppRouter } from "./bookmarks";
import { listsAppRouter } from "./lists";

const syncProcedure = createScopedAuthedProcedure("bookmarks");

function getBookmarksCaller(ctx: AuthedContext) {
  return createCallerFactory(bookmarksAppRouter)(ctx);
}

function getListsCaller(ctx: AuthedContext) {
  return createCallerFactory(listsAppRouter)(ctx);
}

async function assertBookmarkNotConflicted(
  ctx: AuthedContext,
  bookmarkId: string,
  baseModifiedAt?: Date,
) {
  if (!baseModifiedAt) {
    return;
  }
  const row = await ctx.db.query.bookmarks.findFirst({
    where: and(eq(bookmarks.id, bookmarkId), eq(bookmarks.userId, ctx.user.id)),
    columns: { modifiedAt: true },
  });
  if (!row?.modifiedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Bookmark not found" });
  }
  if (row.modifiedAt.getTime() > baseModifiedAt.getTime()) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Bookmark was modified on the server after this offline edit",
    });
  }
}

export const syncAppRouter = router({
  status: syncProcedure.output(zSyncStatusSchema).query(async ({ ctx }) => {
    return {
      enabled: true,
      latestSequence: await getLatestSyncSequence(ctx),
    };
  }),

  pull: syncProcedure
    .input(zSyncPullRequestSchema)
    .output(zSyncPullResponseSchema)
    .query(async ({ ctx, input }) => {
      const { events, nextCursor } = await pullSyncEvents(
        ctx,
        input.cursor,
        input.limit,
      );
      return {
        events,
        nextCursor,
        serverTime: new Date(),
      };
    }),

  push: syncProcedure
    .input(zSyncPushRequestSchema)
    .output(zSyncPushResponseSchema)
    .mutation(async ({ ctx, input }) => {
      const bookmarksCaller = getBookmarksCaller(ctx);
      const listsCaller = getListsCaller(ctx);
      const results = [];

      for (const operation of input.operations) {
        if (await isOperationApplied(ctx, operation.id)) {
          results.push({
            operationId: operation.id,
            status: "duplicate" as const,
          });
          continue;
        }

        try {
          switch (operation.type) {
            case "bookmark.create": {
              const payload = zNewBookmarkRequestSchema.parse(operation.payload);
              const bookmark = await bookmarksCaller.createBookmark(payload);
              await markOperationApplied(ctx, operation.id);
              results.push({
                operationId: operation.id,
                status: "applied" as const,
                bookmark,
              });
              break;
            }
            case "bookmark.update": {
              await assertBookmarkNotConflicted(
                ctx,
                operation.payload.bookmarkId,
                operation.payload.baseModifiedAt,
              );
              const bookmark = await bookmarksCaller.updateBookmark({
                bookmarkId: operation.payload.bookmarkId,
                ...(operation.payload.patch as Record<string, unknown>),
              });
              await markOperationApplied(ctx, operation.id);
              results.push({
                operationId: operation.id,
                status: "applied" as const,
                bookmark,
              });
              break;
            }
            case "bookmark.delete": {
              await assertBookmarkNotConflicted(
                ctx,
                operation.payload.bookmarkId,
                operation.payload.baseModifiedAt,
              );
              await bookmarksCaller.deleteBookmark({
                bookmarkId: operation.payload.bookmarkId,
              });
              await markOperationApplied(ctx, operation.id);
              results.push({
                operationId: operation.id,
                status: "applied" as const,
              });
              break;
            }
            case "bookmark.updateTags": {
              await assertBookmarkNotConflicted(
                ctx,
                operation.payload.bookmarkId,
                operation.payload.baseModifiedAt,
              );
              await bookmarksCaller.updateTags({
                bookmarkId: operation.payload.bookmarkId,
                attach: operation.payload.attach.map((t) =>
                  zManipulatedTagSchema.parse(t),
                ),
                detach: operation.payload.detach.map((t) =>
                  zManipulatedTagSchema.parse(t),
                ),
              });
              const bookmark = (
                await Bookmark.fromId(ctx, operation.payload.bookmarkId, false)
              ).asZBookmark();
              await markOperationApplied(ctx, operation.id);
              results.push({
                operationId: operation.id,
                status: "applied" as const,
                bookmark,
              });
              break;
            }
            case "list.addToList": {
              await listsCaller.addToList(operation.payload);
              await markOperationApplied(ctx, operation.id);
              results.push({
                operationId: operation.id,
                status: "applied" as const,
              });
              break;
            }
            case "list.removeFromList": {
              await listsCaller.removeFromList(operation.payload);
              await markOperationApplied(ctx, operation.id);
              results.push({
                operationId: operation.id,
                status: "applied" as const,
              });
              break;
            }
          }
        } catch (error) {
          results.push({
            operationId: operation.id,
            status:
              error instanceof TRPCError && error.code === "CONFLICT"
                ? ("conflict" as const)
                : ("error" as const),
            message:
              error instanceof Error ? error.message : "Unknown sync error",
          });
        }
      }

      return {
        results,
        serverTime: new Date(),
      };
    }),
});
