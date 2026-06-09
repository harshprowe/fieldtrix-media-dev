import type { MediaRead } from "../../api/media";
import { getMediaVersionIdentity } from "../mediaIdentity";
import { mediaDownloadManager } from "./MediaDownloadManager";
import {
  type DownloadQueueItem,
  type DownloadQueueItemStatus,
  type DownloadQueueListener,
  type DownloadQueueSnapshot,
  type MediaDownloadManagerPort,
  type MediaDownloadOptions,
  type MediaDownloadResult
} from "./types";

const DEFAULT_MAX_CONCURRENT_DOWNLOADS = 3;

type QueueDependencies = {
  downloadManager: MediaDownloadManagerPort;
  maxConcurrentDownloads: number;
};

type InternalQueueItem = DownloadQueueItem & {
  media: MediaRead;
  options: MediaDownloadOptions;
  resolve: (result: MediaDownloadResult) => void;
  reject: (error: Error) => void;
  promise: Promise<MediaDownloadResult>;
};

export class DownloadQueueService {
  private readonly downloadManager: MediaDownloadManagerPort;
  private readonly maxConcurrentDownloads: number;
  private readonly items = new Map<string, InternalQueueItem>();
  private readonly listeners = new Set<DownloadQueueListener>();
  private activeDownloads = 0;

  constructor(dependencies: Partial<QueueDependencies> = {}) {
    this.downloadManager = dependencies.downloadManager ?? mediaDownloadManager;
    this.maxConcurrentDownloads =
      dependencies.maxConcurrentDownloads ?? DEFAULT_MAX_CONCURRENT_DOWNLOADS;
  }

  enqueue(media: MediaRead, options: MediaDownloadOptions = {}): Promise<MediaDownloadResult> {
    const id = getMediaVersionIdentity(media);
    const existing = this.items.get(id);
    if (existing && (existing.status === "queued" || existing.status === "downloading")) {
      return existing.promise;
    }

    let resolve!: (result: MediaDownloadResult) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<MediaDownloadResult>((resolvePromise, rejectPromise) => {
      resolve = resolvePromise;
      reject = rejectPromise;
    });

    const item: InternalQueueItem = {
      id,
      mediaId: media.id,
      mediaTitle: media.title,
      media,
      options,
      status: "queued",
      progress: 0,
      error: null,
      resolve,
      reject,
      promise
    };

    this.items.set(id, item);
    options.onProgress?.({
      mediaId: media.id,
      status: "queued",
      downloadedBytes: 0,
      totalBytes: media.file_size,
      progress: 0,
      resumable: false
    });
    this.emit();
    this.processQueue();
    return promise;
  }

  download(media: MediaRead, options: MediaDownloadOptions = {}): Promise<MediaDownloadResult> {
    return this.enqueue(media, options);
  }

  isCached(media: MediaRead): Promise<boolean> {
    return this.downloadManager.isCached(media);
  }

  deleteCachedMedia(media: MediaRead): Promise<void> {
    return this.downloadManager.deleteCachedMedia(media);
  }

  getStorageEstimate(): Promise<StorageEstimate | null> {
    return this.downloadManager.getStorageEstimate();
  }

  getSnapshot(): DownloadQueueSnapshot {
    const items = Array.from(this.items.values()).map((item) => this.toPublicItem(item));
    return {
      queued: this.countByStatus("queued"),
      downloading: this.countByStatus("downloading"),
      completed: this.countByStatus("completed"),
      failed: this.countByStatus("failed"),
      items
    };
  }

  subscribe(listener: DownloadQueueListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  clearCompleted(): void {
    for (const [id, item] of this.items.entries()) {
      if (item.status === "completed" || item.status === "failed") {
        this.items.delete(id);
      }
    }
    this.emit();
  }

  private processQueue(): void {
    while (this.activeDownloads < this.maxConcurrentDownloads) {
      const next = Array.from(this.items.values()).find((item) => item.status === "queued");
      if (!next) {
        return;
      }
      void this.start(next);
    }
  }

  private async start(item: InternalQueueItem): Promise<void> {
    this.activeDownloads += 1;
    this.updateItem(item.id, { status: "downloading", progress: 0, error: null });

    try {
      const result = await this.downloadManager.download(item.media, {
        ...item.options,
        onProgress: (progress) => {
          item.options.onProgress?.(progress);
          this.updateItem(item.id, {
            status: progress.status === "cached" ? "completed" : "downloading",
            progress: progress.progress,
            error: null
          });
        }
      });
      this.updateItem(item.id, { status: "completed", progress: 1, error: null });
      item.resolve(result);
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error("Download failed");
      this.updateItem(item.id, {
        status: "failed",
        error: nextError.message
      });
      item.reject(nextError);
    } finally {
      this.activeDownloads -= 1;
      this.processQueue();
    }
  }

  private updateItem(
    id: string,
    updates: Partial<Pick<InternalQueueItem, "status" | "progress" | "error">>
  ): void {
    const item = this.items.get(id);
    if (!item) {
      return;
    }
    Object.assign(item, updates);
    this.emit();
  }

  private countByStatus(status: DownloadQueueItemStatus): number {
    return Array.from(this.items.values()).filter((item) => item.status === status).length;
  }

  private emit(): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  private toPublicItem(item: InternalQueueItem): DownloadQueueItem {
    return {
      id: item.id,
      mediaId: item.mediaId,
      mediaTitle: item.mediaTitle,
      status: item.status,
      progress: item.progress,
      error: item.error
    };
  }
}

export const downloadQueueService = new DownloadQueueService();
