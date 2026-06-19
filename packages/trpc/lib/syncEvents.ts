import { eq, gt } from "drizzle-orm";

import { syncAppliedOperations, syncEvents } from "@karakeep/db/schema";
import type {
  ZSyncEntityType,
  ZSyncEvent,
  ZSyncOperation,
} from "@karakeep/shared/types/sync";

import type { AuthedContext } from "../index";

interface RecordSyncEventInput {
  entityType: ZSyncEntityType;
  entityId: string;
  operation: ZSyncOperation;
  modifiedAt?: Date;
  bookmarkId?: string;
  payload?: unknown;
}

export async function recordSyncEvent(
  ctx: AuthedContext,
  input: RecordSyncEventInput,
) {
  await ctx.db.insert(syncEvents).values({
    userId: ctx.user.id,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    bookmarkId: input.bookmarkId,
    payload: input.payload,
    modifiedAt: input.modifiedAt ?? new Date(),
  });
}

export async function getLatestSyncSequence(
  ctx: AuthedContext,
): Promise<number> {
  const row = await ctx.db.query.syncEvents.findFirst({
    where: eq(syncEvents.userId, ctx.user.id),
    orderBy: (events, { desc }) => [desc(events.id)],
    columns: { id: true },
  });
  return row?.id ?? 0;
}

export async function pullSyncEvents(
  ctx: AuthedContext,
  cursor: number,
  limit: number,
): Promise<{ events: ZSyncEvent[]; nextCursor: number | null }> {
  const rows = await ctx.db.query.syncEvents.findMany({
    where: (events, { and, eq: eqOp }) =>
      and(eqOp(events.userId, ctx.user.id), gt(events.id, cursor)),
    orderBy: (events, { asc }) => [asc(events.id)],
    limit: limit + 1,
  });

  let nextCursor: number | null = null;
  if (rows.length > limit) {
    const next = rows.pop()!;
    nextCursor = next.id;
  }

  return {
    events: rows.map((row) => ({
      sequence: row.id,
      entityType: row.entityType,
      entityId: row.entityId,
      operation: row.operation,
      modifiedAt: row.modifiedAt,
      bookmarkId: row.bookmarkId ?? undefined,
      data: row.payload ?? undefined,
    })),
    nextCursor,
  };
}

export async function markOperationApplied(
  ctx: AuthedContext,
  operationId: string,
) {
  await ctx.db
    .insert(syncAppliedOperations)
    .values({
      operationId,
      userId: ctx.user.id,
      appliedAt: new Date(),
    })
    .onConflictDoNothing();
}

export async function isOperationApplied(
  ctx: AuthedContext,
  operationId: string,
): Promise<boolean> {
  const row = await ctx.db.query.syncAppliedOperations.findFirst({
    where: (ops, { and, eq: eqOp }) =>
      and(eqOp(ops.operationId, operationId), eqOp(ops.userId, ctx.user.id)),
    columns: { operationId: true },
  });
  return !!row;
}
