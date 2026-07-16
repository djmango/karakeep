import type { ZSyncPushOperation } from "@karakeep/shared/types/sync";

import { getOfflineDb } from "./db";
import type { OutboxOperation } from "./types";

function newLocalId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}

export async function enqueueOutboxOperation(
  operation: Omit<ZSyncPushOperation, "id"> & { id?: string },
): Promise<string> {
  const db = await getOfflineDb();
  const id = operation.id ?? newLocalId();
  const payload =
    "payload" in operation
      ? operation.payload
      : ((operation as { payload?: unknown }).payload ?? {});
  await db.runAsync(
    `INSERT INTO outbox(id, type, payload_json, created_at, attempts, last_error)
     VALUES(?, ?, ?, ?, 0, NULL)`,
    [id, operation.type, JSON.stringify(payload), new Date().toISOString()],
  );
  return id;
}

export async function listOutboxOperations(): Promise<OutboxOperation[]> {
  const db = await getOfflineDb();
  return db.getAllAsync<OutboxOperation>(
    "SELECT id, type, payload_json as payloadJson, created_at as createdAt, attempts, last_error as lastError FROM outbox ORDER BY created_at ASC",
  );
}

export async function removeOutboxOperation(id: string) {
  const db = await getOfflineDb();
  await db.runAsync("DELETE FROM outbox WHERE id = ?", [id]);
}

export async function markOutboxAttempt(id: string, error?: string) {
  const db = await getOfflineDb();
  await db.runAsync(
    "UPDATE outbox SET attempts = attempts + 1, last_error = ? WHERE id = ?",
    [error ?? null, id],
  );
}

export function outboxToSyncOperations(
  operations: OutboxOperation[],
): ZSyncPushOperation[] {
  return operations.map((operation) => {
    const payload = JSON.parse(operation.payloadJson);
    return {
      id: operation.id,
      type: operation.type,
      payload,
    } as ZSyncPushOperation;
  });
}
