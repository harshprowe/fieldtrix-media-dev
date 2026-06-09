import { listMedia } from "../../api/media";
import {
  mediaStorageService,
  type StoredMediaMetadata
} from "../../storage/mediaStorageService";
import { downloadQueueService } from "../mediaDownload";
import type {
  MediaListPage,
  MediaSyncApiPort,
  MediaSyncDownloadPort,
  MediaSyncOptions,
  MediaSyncProgress,
  MediaSyncRecordResult,
  MediaSyncStoragePort,
  MediaSyncSummary
} from "./types";

const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_CONCURRENCY = 3;

type MediaSyncDependencies = {
  api: MediaSyncApiPort;
  storage: MediaSyncStoragePort;
  downloader: MediaSyncDownloadPort;
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
};

function createInitialProgress(): MediaSyncProgress {
  return {
    status: "idle",
    scanned: 0,
    total: null,
    created: 0,
    updated: 0,
    unchanged: 0,
    redownloaded: 0,
    failed: 0
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown synchronization error";
}

function isCancellation(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "code" in error && error.code === "cancelled")
  );
}

export class MediaSyncEngine {
  private readonly api: MediaSyncApiPort;
  private readonly storage: MediaSyncStoragePort;
  private readonly downloader: MediaSyncDownloadPort;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(dependencies?: Partial<MediaSyncDependencies>) {
    this.api = dependencies?.api ?? { listMedia };
    this.storage = dependencies?.storage ?? mediaStorageService;
    this.downloader = dependencies?.downloader ?? downloadQueueService;
    this.logger = dependencies?.logger ?? console;
  }

  async sync(options: MediaSyncOptions = {}): Promise<MediaSyncSummary> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    const progress: MediaSyncProgress = {
      ...createInitialProgress(),
      status: "checking"
    };
    const records: MediaSyncRecordResult[] = [];
    const processedIdentities = new Set<string>();
    let offset = 0;
    let total: number | null = null;

    this.logger.info("[MediaSyncEngine] sync started", {
      pageSize,
      concurrency
    });
    options.onProgress?.({ ...progress });

    try {
      do {
        this.throwIfAborted(options.signal);
        progress.status = "checking";
        options.onProgress?.({ ...progress });
        const page = await this.fetchPage(pageSize, offset);
        total = page.total;
        progress.total = total;
        if (page.items.length === 0) {
          break;
        }

        await this.processPage(page, {
          concurrency,
          signal: options.signal,
          progress,
          records,
          processedIdentities,
          onProgress: options.onProgress,
          onRecord: options.onRecord
        });

        offset += page.items.length;
      } while (total !== null && offset < total);

      progress.status = progress.failed > 0 ? "failed" : "completed";
      options.onProgress?.({ ...progress });
      this.logger.info("[MediaSyncEngine] sync completed", progress);
      return { ...progress, records };
    } catch (error) {
      progress.status = "failed";
      options.onProgress?.({ ...progress });
      throw error;
    }
  }

  private async fetchPage(limit: number, offset: number): Promise<MediaListPage> {
    this.logger.debug("[MediaSyncEngine] fetching media page", { limit, offset });
    return this.api.listMedia({ limit, offset });
  }

  private async processPage(
    page: MediaListPage,
    input: {
      concurrency: number;
      signal?: AbortSignal;
      progress: MediaSyncProgress;
      records: MediaSyncRecordResult[];
      processedIdentities: Set<string>;
      onProgress?: (progress: MediaSyncProgress) => void;
      onRecord?: (record: MediaSyncRecordResult) => void;
    }
  ): Promise<void> {
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < page.items.length) {
        this.throwIfAborted(input.signal);
        const media = page.items[nextIndex];
        nextIndex += 1;

        const record = await this.syncRecord(media, {
          signal: input.signal,
          progress: input.progress,
          processedIdentities: input.processedIdentities,
          onProgress: input.onProgress
        });
        input.records.push(record);
        this.applyRecordToProgress(input.progress, record);
        input.onRecord?.(record);
        input.onProgress?.({ ...input.progress });
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(input.concurrency, page.items.length) }, () => worker())
    );
  }

  private async syncRecord(
    media: MediaListPage["items"][number],
    options: {
      signal?: AbortSignal;
      progress: MediaSyncProgress;
      processedIdentities: Set<string>;
      onProgress?: (progress: MediaSyncProgress) => void;
    }
  ): Promise<MediaSyncRecordResult> {
    this.throwIfAborted(options.signal);

    try {
      const identity = `${media.id}:v${media.version}`;
      if (options.processedIdentities.has(identity)) {
        this.logger.debug("[MediaSyncEngine] duplicate media version skipped", {
          mediaId: media.id,
          serverVersion: media.version
        });
        return this.createRecord(media, null, "unchanged");
      }
      options.processedIdentities.add(identity);

      const localResult = await this.storage.getMediaMetadata(media.id);
      if (!localResult.ok) {
        throw new Error(localResult.error.message);
      }

      const local = localResult.data as StoredMediaMetadata | null;
      if (!local) {
        await this.saveMetadata(media);
        return this.createRecord(media, null, "created");
      }

      if (local.version === media.version) {
        await this.saveMetadata(media);
        return this.createRecord(media, local.version, "unchanged");
      }

      this.logger.debug("[MediaSyncEngine] version mismatch detected", {
        mediaId: media.id,
        localVersion: local.version,
        serverVersion: media.version
      });

      await this.downloader.deleteCachedMedia(local);
      await this.deleteMetadata(media.id);
      options.progress.status = "downloading";
      options.onProgress?.({ ...options.progress });
      await this.downloader.download(media, { signal: options.signal });
      options.progress.status = "checking";
      options.onProgress?.({ ...options.progress });
      return this.createRecord(media, local.version, "redownloaded");
    } catch (error) {
      if (isCancellation(error)) {
        throw error;
      }
      const message = toErrorMessage(error);
      options.progress.status = "failed";
      options.onProgress?.({ ...options.progress });
      this.logger.error("[MediaSyncEngine] record sync failed", {
        mediaId: media.id,
        error: message
      });
      return this.createRecord(media, null, "failed", message);
    }
  }

  private async saveMetadata(media: MediaListPage["items"][number]): Promise<void> {
    const saved = await this.storage.saveMediaMetadata(media);
    if (!saved.ok) {
      throw new Error(saved.error.message);
    }
  }

  private async deleteMetadata(mediaId: string): Promise<void> {
    const deleted = await this.storage.deleteMediaMetadata(mediaId);
    if (!deleted.ok) {
      throw new Error(deleted.error.message);
    }
  }

  private createRecord(
    media: MediaListPage["items"][number],
    localVersion: number | null,
    action: MediaSyncRecordResult["action"],
    error: string | null = null
  ): MediaSyncRecordResult {
    return {
      mediaId: media.id,
      title: media.title,
      localVersion,
      serverVersion: media.version,
      action,
      error
    };
  }

  private applyRecordToProgress(
    progress: MediaSyncProgress,
    record: MediaSyncRecordResult
  ): void {
    progress.scanned += 1;
    if (record.action === "created") {
      progress.created += 1;
    } else if (record.action === "updated") {
      progress.updated += 1;
    } else if (record.action === "unchanged") {
      progress.unchanged += 1;
    } else if (record.action === "redownloaded") {
      progress.updated += 1;
      progress.redownloaded += 1;
    } else {
      progress.failed += 1;
    }
  }

  private throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
      throw new DOMException("Media sync was cancelled", "AbortError");
    }
  }
}

export const mediaSyncEngine = new MediaSyncEngine();
