import type { MediaRead } from "../../api/media";
import {
  mediaStorageService,
  type MediaStorageService,
  type StorageResult
} from "../../storage/mediaStorageService";
import {
  getMediaVersionIdentity,
  getVersionedMediaCacheKey,
  getVersionedMediaChunkCacheKey
} from "../mediaIdentity";
import {
  storageManagerService,
  type StorageManagerService
} from "../storage";
import {
  MediaDownloadError,
  type MediaDownloadManagerPort,
  type MediaDownloadOptions,
  type MediaDownloadProgress,
  type MediaDownloadResult
} from "./types";

const MEDIA_CACHE_NAME = "fieldtrix-media-v1";
const MEDIA_CHUNK_CACHE_NAME = "fieldtrix-media-chunks-v1";
const PROGRESS_UPDATE_INTERVAL_BYTES = 512 * 1024;
const DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;

type DownloadDependencies = {
  fetcher: typeof fetch;
  cacheStorage: CacheStorage;
  metadataStorage: MediaStorageService;
  storageManager: StorageManagerService;
  chunkSizeBytes: number;
};

function toCacheKey(media: MediaRead): string {
  return getVersionedMediaCacheKey(media);
}

function toChunkCacheKey(media: MediaRead, start: number, end: number): string {
  return getVersionedMediaChunkCacheKey(media, start, end);
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === "QuotaExceededError" || error.name === "NS_ERROR_DOM_QUOTA_REACHED")
  );
}

function assertStorageResult<T>(result: StorageResult<T>, message: string): T {
  if (!result.ok) {
    throw new MediaDownloadError(`${message}: ${result.error.message}`, "storage_error");
  }
  return result.data;
}

export class MediaDownloadManager implements MediaDownloadManagerPort {
  private readonly fetcher: typeof fetch;
  private readonly cacheStorage: CacheStorage;
  private readonly metadataStorage: MediaStorageService;
  private readonly storageManager: StorageManagerService;
  private readonly chunkSizeBytes: number;

  constructor(dependencies?: Partial<DownloadDependencies>) {
    if (!("caches" in globalThis) && !dependencies?.cacheStorage) {
      throw new MediaDownloadError("Cache API is not available", "cache_unavailable");
    }

    this.fetcher = dependencies?.fetcher ?? fetch.bind(globalThis);
    this.cacheStorage = dependencies?.cacheStorage ?? caches;
    this.metadataStorage = dependencies?.metadataStorage ?? mediaStorageService;
    this.storageManager = dependencies?.storageManager ?? storageManagerService;
    this.chunkSizeBytes = dependencies?.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
  }

  async download(
    media: MediaRead,
    options: MediaDownloadOptions = {}
  ): Promise<MediaDownloadResult> {
    const cacheKey = toCacheKey(media);
    const cache = await this.cacheStorage.open(MEDIA_CACHE_NAME);
    const chunkCache = await this.cacheStorage.open(MEDIA_CHUNK_CACHE_NAME);

    if (await cache.match(cacheKey)) {
      await this.markDownloaded(media, media.file_size);
      options.onProgress?.(this.createProgress(media, media.file_size, media.file_size, "cached", false));
      return {
        media,
        cacheKey,
        downloadedBytes: media.file_size,
        fromCache: true
      };
    }

    options.onProgress?.(this.createProgress(media, 0, media.file_size, "checking_storage", false));
    await this.ensureStorageBudget(media.file_size);
    assertStorageResult(await this.metadataStorage.saveMediaMetadata(media), "Unable to save metadata");
    assertStorageResult(
      await this.metadataStorage.updateDownloadStatus(media.id, {
        status: "downloading",
        progress: 0,
        downloadedBytes: 0
      }),
      "Unable to mark media as downloading"
    );

    const downloadedBytes = await this.downloadRangeChunksToCache({
      media,
      cache,
      chunkCache,
      cacheKey,
      options
    });

    await this.markDownloaded(media, downloadedBytes);

    return {
      media,
      cacheKey,
      downloadedBytes,
      fromCache: false
    };
  }

  async isCached(media: MediaRead): Promise<boolean> {
    const cache = await this.cacheStorage.open(MEDIA_CACHE_NAME);
    return Boolean(await cache.match(toCacheKey(media)));
  }

  async deleteCachedMedia(media: MediaRead): Promise<void> {
    const cache = await this.cacheStorage.open(MEDIA_CACHE_NAME);
    const chunkCache = await this.cacheStorage.open(MEDIA_CHUNK_CACHE_NAME);
    await cache.delete(toCacheKey(media));
    await this.deleteChunkCacheEntries(chunkCache, media);
    await this.metadataStorage.updateDownloadStatus(media.id, {
      status: "not_started",
      progress: 0,
      downloadedBytes: 0,
      downloadedAt: null,
      error: null
    });
  }

  async getStorageEstimate(): Promise<StorageEstimate | null> {
    const status = await this.storageManager.getStatus();
    return {
      usage: status.usage,
      quota: status.quota ?? undefined
    };
  }

  private async downloadRangeChunksToCache(input: {
    media: MediaRead;
    cache: Cache;
    chunkCache: Cache;
    cacheKey: string;
    options: MediaDownloadOptions;
  }): Promise<number> {
    const { media, cache, chunkCache, cacheKey, options } = input;
    let downloadedBytes = await this.countCachedChunkBytes(chunkCache, media);

    options.onProgress?.(
      this.createProgress(media, downloadedBytes, media.file_size, "downloading", downloadedBytes > 0)
    );

    for (let start = 0; start < media.file_size; start += this.chunkSizeBytes) {
      const end = Math.min(start + this.chunkSizeBytes - 1, media.file_size - 1);
      const chunkKey = toChunkCacheKey(media, start, end);
      if (await chunkCache.match(chunkKey)) {
        continue;
      }

      const response = await this.fetchChunk(media, start, end, options);
      if (response.status === 200 && start === 0) {
        const fullBytes = await this.readFullResponseToCache({
          media,
          cache,
          cacheKey,
          response,
          options
        });
        await this.deleteChunkCacheEntries(chunkCache, media);
        return fullBytes;
      }
      if (response.status !== 206) {
        await this.markFailed(media.id, `CDN responded with status ${response.status}`);
        throw new MediaDownloadError("CDN did not return a resumable byte range", "invalid_response");
      }

      const chunkBlob = await this.readResponseBlob(response, media, options);
      try {
        await chunkCache.put(
          chunkKey,
          new Response(chunkBlob, {
            status: 206,
            headers: this.buildChunkHeaders(response, start, end)
          })
        );
      } catch (error) {
        if (isQuotaError(error)) {
          await this.markFailed(media.id, "Storage quota exceeded");
          throw new MediaDownloadError("Storage quota exceeded", "quota_exceeded");
        }
        throw error;
      }

      downloadedBytes += chunkBlob.size;
      await this.metadataStorage.updateDownloadStatus(media.id, {
        status: "downloading",
        progress: media.file_size > 0 ? downloadedBytes / media.file_size : 0,
        downloadedBytes
      });
      options.onProgress?.(
        this.createProgress(media, downloadedBytes, media.file_size, "downloading", true)
      );
    }

    await this.assembleChunksIntoFinalCache(media, cache, chunkCache, cacheKey);
    await this.deleteChunkCacheEntries(chunkCache, media);
    return media.file_size;
  }

  private async fetchChunk(
    media: MediaRead,
    start: number,
    end: number,
    options: MediaDownloadOptions
  ): Promise<Response> {
    try {
      return await this.fetcher(media.cdn_url, {
        signal: options.signal,
        headers: {
          Range: `bytes=${start}-${end}`
        }
      });
    } catch (error) {
      await this.markFailed(media.id, "Network request failed");
      if (options.signal?.aborted) {
        throw new MediaDownloadError("Download was cancelled", "cancelled");
      }
      throw new MediaDownloadError(
        error instanceof Error ? error.message : "Network request failed",
        "network_error"
      );
    }
  }

  private async readFullResponseToCache(input: {
    media: MediaRead;
    cache: Cache;
    cacheKey: string;
    response: Response;
    options: MediaDownloadOptions;
  }): Promise<number> {
    const { media, cache, cacheKey, response, options } = input;
    const reader = response.body?.getReader();
    if (!reader) {
      await this.markFailed(media.id, "CDN response body is not readable");
      throw new MediaDownloadError("CDN response body is not readable", "invalid_response");
    }

    const chunks: Uint8Array[] = [];
    let downloadedBytes = 0;
    let bytesSinceLastProgress = 0;

    try {
      while (true) {
        if (options.signal?.aborted) {
          await this.metadataStorage.updateDownloadStatus(media.id, {
            status: "failed",
            progress: media.file_size > 0 ? downloadedBytes / media.file_size : 0,
            downloadedBytes,
            error: "Download was cancelled"
          });
          throw new MediaDownloadError("Download was cancelled", "cancelled");
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        chunks.push(value);
        downloadedBytes += value.byteLength;
        bytesSinceLastProgress += value.byteLength;

        options.onProgress?.(
          this.createProgress(media, downloadedBytes, media.file_size, "downloading", false)
        );

        if (bytesSinceLastProgress >= PROGRESS_UPDATE_INTERVAL_BYTES) {
          bytesSinceLastProgress = 0;
          await this.metadataStorage.updateDownloadStatus(media.id, {
            status: "downloading",
            progress: media.file_size > 0 ? downloadedBytes / media.file_size : 0,
            downloadedBytes
          });
        }
      }

      const responseToCache = new Response(new Blob(chunks), {
        status: 200,
        headers: this.buildCachedResponseHeaders(response, media)
      });
      await cache.put(cacheKey, responseToCache);
      return downloadedBytes;
    } catch (error) {
      if (error instanceof MediaDownloadError) {
        throw error;
      }
      if (isQuotaError(error)) {
        await this.markFailed(media.id, "Storage quota exceeded");
        throw new MediaDownloadError("Storage quota exceeded", "quota_exceeded");
      }
      await this.markFailed(media.id, "Download failed");
      throw new MediaDownloadError(
        error instanceof Error ? error.message : "Download failed",
        "network_error"
      );
    } finally {
      reader.releaseLock();
    }
  }

  private async readResponseBlob(
    response: Response,
    media: MediaRead,
    options: MediaDownloadOptions
  ): Promise<Blob> {
    if (options.signal?.aborted) {
      await this.markFailed(media.id, "Download was cancelled");
      throw new MediaDownloadError("Download was cancelled", "cancelled");
    }
    try {
      return await response.blob();
    } catch (error) {
      if (isQuotaError(error)) {
        await this.markFailed(media.id, "Storage quota exceeded");
        throw new MediaDownloadError("Storage quota exceeded", "quota_exceeded");
      }
      await this.markFailed(media.id, "Unable to read downloaded chunk");
      throw new MediaDownloadError("Unable to read downloaded chunk", "network_error");
    }
  }

  private async countCachedChunkBytes(chunkCache: Cache, media: MediaRead): Promise<number> {
    let total = 0;
    for (let start = 0; start < media.file_size; start += this.chunkSizeBytes) {
      const end = Math.min(start + this.chunkSizeBytes - 1, media.file_size - 1);
      const response = await chunkCache.match(toChunkCacheKey(media, start, end));
      if (!response) {
        continue;
      }
      total += Number(response.headers.get("Content-Length") ?? end - start + 1);
    }
    return total;
  }

  private async assembleChunksIntoFinalCache(
    media: MediaRead,
    cache: Cache,
    chunkCache: Cache,
    cacheKey: string
  ): Promise<void> {
    const blobs: Blob[] = [];
    for (let start = 0; start < media.file_size; start += this.chunkSizeBytes) {
      const end = Math.min(start + this.chunkSizeBytes - 1, media.file_size - 1);
      const response = await chunkCache.match(toChunkCacheKey(media, start, end));
      if (!response) {
        throw new MediaDownloadError("Downloaded chunk is missing", "invalid_response");
      }
      blobs.push(await response.blob());
    }

    try {
      await cache.put(
        cacheKey,
        new Response(new Blob(blobs), {
          status: 200,
          headers: this.buildCachedResponseHeaders(null, media)
        })
      );
    } catch (error) {
      if (isQuotaError(error)) {
        await this.markFailed(media.id, "Storage quota exceeded");
        throw new MediaDownloadError("Storage quota exceeded", "quota_exceeded");
      }
      throw error;
    }
  }

  private async deleteChunkCacheEntries(chunkCache: Cache, media: MediaRead): Promise<void> {
    const deletes: Array<Promise<boolean>> = [];
    for (let start = 0; start < media.file_size; start += this.chunkSizeBytes) {
      const end = Math.min(start + this.chunkSizeBytes - 1, media.file_size - 1);
      deletes.push(chunkCache.delete(toChunkCacheKey(media, start, end)));
    }
    await Promise.all(deletes);
  }

  private async ensureStorageBudget(requiredBytes: number): Promise<void> {
    const check = await this.storageManager.canDownload(requiredBytes);
    if (!check.allowed) {
      throw new MediaDownloadError(
        check.reason ?? "This download exceeds the offline storage budget.",
        "quota_exceeded"
      );
    }
  }

  private buildCachedResponseHeaders(response: Response | null, media: MediaRead): Headers {
    const headers = new Headers();
    const contentType = response?.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    headers.set("Content-Length", String(media.file_size));
    headers.set("X-FieldTrix-Media-ID", media.id);
    headers.set("X-FieldTrix-Media-Version", String(media.version));
    headers.set("X-FieldTrix-Media-Identity", getMediaVersionIdentity(media));
    return headers;
  }

  private buildChunkHeaders(response: Response, start: number, end: number): Headers {
    const headers = new Headers();
    const contentType = response.headers.get("Content-Type");
    if (contentType) {
      headers.set("Content-Type", contentType);
    }
    headers.set("Content-Length", String(end - start + 1));
    headers.set("Content-Range", `bytes ${start}-${end}/*`);
    return headers;
  }

  private createProgress(
    media: MediaRead,
    downloadedBytes: number,
    totalBytes: number,
    status: MediaDownloadProgress["status"],
    resumable: boolean
  ): MediaDownloadProgress {
    return {
      mediaId: media.id,
      status,
      downloadedBytes,
      totalBytes,
      progress: totalBytes > 0 ? Math.min(downloadedBytes / totalBytes, 1) : 0,
      resumable
    };
  }

  private async markDownloaded(media: MediaRead, downloadedBytes: number): Promise<void> {
    assertStorageResult(
      await this.metadataStorage.saveMediaMetadata(media),
      "Unable to save downloaded metadata"
    );
    assertStorageResult(
      await this.metadataStorage.updateDownloadStatus(media.id, {
        status: "downloaded",
        progress: 1,
        downloadedBytes,
        error: null
      }),
      "Unable to mark media as downloaded"
    );
  }

  private async markFailed(mediaId: string, error: string): Promise<void> {
    await this.metadataStorage.updateDownloadStatus(mediaId, {
      status: "failed",
      error
    });
  }
}

function createUnavailableManager(): MediaDownloadManagerPort {
  return {
    async download() {
      throw new MediaDownloadError("Cache API is not available", "cache_unavailable");
    },
    async isCached() {
      return false;
    },
    async deleteCachedMedia() {
      throw new MediaDownloadError("Cache API is not available", "cache_unavailable");
    },
    async getStorageEstimate() {
      return null;
    }
  };
}

export const mediaDownloadManager: MediaDownloadManagerPort =
  "caches" in globalThis ? new MediaDownloadManager() : createUnavailableManager();
