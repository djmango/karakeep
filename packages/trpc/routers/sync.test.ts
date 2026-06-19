import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { syncAppliedOperations, syncEvents } from "@karakeep/db/schema";
import * as sharedServer from "@karakeep/shared-server";
import { BookmarkTypes } from "@karakeep/shared/types/bookmarks";

import type { CustomTestContext } from "../testUtils";
import { defaultBeforeEach } from "../testUtils";

vi.mock("@karakeep/shared-server", async (original) => {
  const mod = (await original()) as typeof import("@karakeep/shared-server");
  return {
    ...mod,
    LinkCrawlerQueue: {
      enqueue: vi.fn(),
    },
    OpenAIQueue: {
      enqueue: vi.fn(),
    },
    EmbeddingsQueue: {
      enqueue: vi.fn(),
    },
    SearchIndexingQueue: {
      enqueue: vi.fn(),
    },
    RuleEngineQueue: {
      enqueue: vi.fn(),
    },
    triggerSearchReindex: vi.fn(),
  };
});

beforeEach<CustomTestContext>(defaultBeforeEach(true));

describe("Sync Routes", () => {
  test<CustomTestContext>("status reports latest sequence", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const bookmark = await api.bookmarks.createBookmark({
      url: "https://example.com/sync-status",
      type: BookmarkTypes.LINK,
    });

    const status = await api.sync.status();
    expect(status.enabled).toBe(true);
    expect(status.latestSequence).toBeGreaterThan(0);

    const events = await db.query.syncEvents.findMany({
      where: eq(syncEvents.entityId, bookmark.id),
    });
    expect(events.length).toBeGreaterThan(0);
  });

  test<CustomTestContext>("pull returns bookmark create events after cursor", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0];
    const bookmark = await api.bookmarks.createBookmark({
      url: "https://example.com/sync-pull",
      type: BookmarkTypes.LINK,
    });

    const firstPage = await api.sync.pull({ cursor: 0, limit: 100 });
    const match = firstPage.events.find(
      (event) =>
        event.entityType === "bookmark" &&
        event.entityId === bookmark.id &&
        event.operation === "create",
    );
    expect(match).toBeDefined();
    expect(firstPage.nextCursor).toBeNull();
  });

  test<CustomTestContext>("push applies bookmark update idempotently", async ({
    apiCallers,
    db,
  }) => {
    const api = apiCallers[0];
    const bookmark = await api.bookmarks.createBookmark({
      url: "https://example.com/sync-push",
      type: BookmarkTypes.LINK,
    });

    const operation = {
      id: "offline-op-1",
      type: "bookmark.update" as const,
      payload: {
        bookmarkId: bookmark.id,
        patch: { title: "Offline title" },
      },
    };

    const firstPush = await api.sync.push({ operations: [operation] });
    expect(firstPush.results[0]?.status).toBe("applied");

    const updated = await api.bookmarks.getBookmark({ bookmarkId: bookmark.id });
    expect(updated.title).toBe("Offline title");

    const secondPush = await api.sync.push({ operations: [operation] });
    expect(secondPush.results[0]?.status).toBe("duplicate");

    const applied = await db.query.syncAppliedOperations.findMany({
      where: eq(syncAppliedOperations.operationId, operation.id),
    });
    expect(applied).toHaveLength(1);
  });

  test<CustomTestContext>("push records delete tombstones via pull", async ({
    apiCallers,
  }) => {
    const api = apiCallers[0];
    const bookmark = await api.bookmarks.createBookmark({
      url: "https://example.com/sync-delete",
      type: BookmarkTypes.LINK,
    });

    const deleteResult = await api.sync.push({
      operations: [
        {
          id: "offline-op-delete",
          type: "bookmark.delete",
          payload: { bookmarkId: bookmark.id },
        },
      ],
    });
    expect(deleteResult.results[0]?.status).toBe("applied");

    await expect(
      api.bookmarks.getBookmark({ bookmarkId: bookmark.id }),
    ).rejects.toThrow();

    const pull = await api.sync.pull({ cursor: 0, limit: 500 });
    const deleteEvent = pull.events.find(
      (event) =>
        event.entityId === bookmark.id && event.operation === "delete",
    );
    expect(deleteEvent).toBeDefined();
  });
});
