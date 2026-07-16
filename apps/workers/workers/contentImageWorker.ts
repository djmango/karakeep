import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { workerStatsCounter } from "metrics";
import { withWorkerEventLog, withWorkerTracing } from "workerTracing";

import { db } from "@karakeep/db";
import {
  assets,
  AssetTypes,
  bookmarkLinks,
  bookmarks,
} from "@karakeep/db/schema";
import {
  ContentImageQueue,
  QuotaService,
  StorageQuotaError,
  zContentImageRequestSchema,
} from "@karakeep/shared-server";
import type { ZContentImageRequest } from "@karakeep/shared-server";
import { saveAsset } from "@karakeep/shared/assetdb";
import serverConfig from "@karakeep/shared/config";
import logger from "@karakeep/shared/logger";
import { DequeuedJob, getQueueClient } from "@karakeep/shared/queueing";

const IMG_SRC_REGEX = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;

function deterministicAssetId(bookmarkId: string, sourceUrl: string) {
  return createHash("sha256")
    .update(`${bookmarkId}:${sourceUrl}`)
    .digest("hex")
    .slice(0, 32);
}

async function downloadImage(url: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "image/*",
        "User-Agent":
          "Mozilla/5.0 (compatible; KarakeepContentImageWorker/1.0)",
      },
    });
    if (!response.ok) {
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const maxBytes = serverConfig.crawler.contentImageMaxSizeMb * 1024 * 1024;
    if (buffer.byteLength > maxBytes) {
      return null;
    }
    const contentType = response.headers.get("content-type") ?? "image/jpeg";
    return { buffer, contentType };
  } catch {
    return null;
  }
}

async function runContentImageJob(job: DequeuedJob<ZContentImageRequest>) {
  if (!serverConfig.crawler.storeContentImages) {
    return;
  }

  const payload = zContentImageRequestSchema.parse(job.data);
  const link = await db.query.bookmarkLinks.findFirst({
    where: eq(bookmarkLinks.id, payload.bookmarkId),
  });
  if (!link?.htmlContent) {
    return;
  }

  const bookmark = await db.query.bookmarks.findFirst({
    where: eq(bookmarks.id, payload.bookmarkId),
    columns: { userId: true },
  });
  if (!bookmark) {
    return;
  }

  await db
    .update(bookmarkLinks)
    .set({ contentImageStatus: "pending" })
    .where(eq(bookmarkLinks.id, payload.bookmarkId));

  const matches = [...link.htmlContent.matchAll(IMG_SRC_REGEX)];
  const uniqueUrls = [
    ...new Set(
      matches.map((match) => match[1]).filter((url) => url.startsWith("http")),
    ),
  ].slice(0, serverConfig.crawler.contentImageMaxCount);

  let html = link.htmlContent;
  let cachedCount = 0;

  for (const sourceUrl of uniqueUrls) {
    const assetId = deterministicAssetId(payload.bookmarkId, sourceUrl);
    const existing = await db.query.assets.findFirst({
      where: eq(assets.id, assetId),
      columns: { id: true },
    });
    if (existing) {
      html = html.replaceAll(sourceUrl, `/api/assets/${assetId}`);
      cachedCount += 1;
      continue;
    }

    const downloaded = await downloadImage(sourceUrl);
    if (!downloaded) {
      continue;
    }

    try {
      const quotaApproved = await QuotaService.checkStorageQuota(
        db,
        bookmark.userId,
        downloaded.buffer.byteLength,
      );
      await saveAsset({
        userId: bookmark.userId,
        assetId,
        asset: downloaded.buffer,
        metadata: {
          contentType: downloaded.contentType,
          fileName: null,
        },
        quotaApproved,
      });
      await db.insert(assets).values({
        id: assetId,
        bookmarkId: payload.bookmarkId,
        userId: bookmark.userId,
        assetType: AssetTypes.CONTENT_IMAGE,
        contentType: downloaded.contentType,
        size: downloaded.buffer.byteLength,
        fileName: null,
      });
      html = html.replaceAll(sourceUrl, `/api/assets/${assetId}`);
      cachedCount += 1;
    } catch (error) {
      if (error instanceof StorageQuotaError) {
        logger.warn(
          `[ContentImage][${job.id}] Skipping image due to quota: ${error.message}`,
        );
        break;
      }
      logger.warn(
        `[ContentImage][${job.id}] Failed to cache ${sourceUrl}: ${error}`,
      );
    }
  }

  await db
    .update(bookmarkLinks)
    .set({
      htmlContent: html,
      contentImageStatus: cachedCount > 0 ? "success" : "failure",
    })
    .where(eq(bookmarkLinks.id, payload.bookmarkId));

  logger.info(
    `[ContentImage][${job.id}] Cached ${cachedCount} content images for bookmark ${payload.bookmarkId}`,
  );
}

export class ContentImageWorker {
  static async build() {
    logger.info("Starting content image worker ...");
    return (await getQueueClient()).createRunner<ZContentImageRequest>(
      ContentImageQueue,
      {
        run: withWorkerTracing(
          "contentImageWorker.run",
          withWorkerEventLog("contentImageWorker.run", runContentImageJob),
        ),
        onComplete: async (job) => {
          workerStatsCounter.labels("contentImage", "completed").inc();
          logger.info(`[ContentImage][${job.id}] Completed successfully`);
        },
        onError: async (job) => {
          workerStatsCounter.labels("contentImage", "failed").inc();
          if (job.numRetriesLeft === 0) {
            workerStatsCounter.labels("contentImage", "failed_permanent").inc();
          }
          logger.error(
            `[ContentImage][${job.id}] Content image job failed: ${job.error}`,
          );
        },
      },
      {
        pollIntervalMs: 1000,
        timeoutSecs: serverConfig.crawler.contentImageJobTimeoutSec,
        concurrency: serverConfig.crawler.contentImageNumWorkers,
        validator: zContentImageRequestSchema,
      },
    );
  }
}
