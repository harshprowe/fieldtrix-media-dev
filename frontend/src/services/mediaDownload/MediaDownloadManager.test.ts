import { describe, expect, it, vi } from "vitest";

import type { MediaRead } from "../../api/media";
import type {
  DownloadStatus,
  StorageResult,
  StoredMediaMetadata
} from "../../storage/mediaStorageService";
import { getVersionedMediaCacheKey, getVersionedMediaChunkCacheKey } from "../mediaIdentity";
import { StorageManagerService } from "../storage";
import { MediaDownloadManager } from "./MediaDownloadManager";

function makeMedia(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: "media-1",
    title: "Launch Screen",
    media_type: "video",
    object_key: "media/media-1/v1/video.mp4",
    cdn_url: "https://cdn.example.com/media/media-1/v1/video.mp4",
    version: 1,
    file_size: 12,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    ...overrides
  };
}

function toStored(media: MediaRead, overrides: Partial<StoredMediaMetadata> = {}): StoredMediaMetadata {
  return {
    ...media,
    download_status: "not_started",
    download_progress: 0,
    downloaded_bytes: 0,
    last_synced_at: "2026-06-05T00:00:00.000Z",
    downloaded_at: null,
    download_error: null,
    ...overrides
  };
}

class FakeCache {
  records = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.records.get(String(request));
  }

  async put(request: RequestInfo | URL, response: Response): Promise<void> {
    this.records.set(String(request), response);
  }

  async delete(request: RequestInfo | URL): Promise<boolean> {
    return this.records.delete(String(request));
  }

  async keys(): Promise<Request[]> {
    return Array.from(this.records.keys()).map((url) => new Request(url));
  }
}

class FakeCacheStorage {
  caches = new Map<string, FakeCache>();

  async open(name: string): Promise<Cache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache as unknown as Cache;
  }
}

class FakeMetadataStorage {
  metadata = new Map<string, StoredMediaMetadata>();
  updates: Array<{ mediaId: string; status: DownloadStatus; downloadedBytes?: number }> = [];

  async saveMediaMetadata(media: MediaRead): Promise<StorageResult<StoredMediaMetadata>> {
    const stored = this.metadata.get(media.id) ?? toStored(media);
    this.metadata.set(media.id, { ...stored, ...media });
    return { ok: true, data: this.metadata.get(media.id)! };
  }

  async getMediaMetadata(mediaId: string): Promise<StorageResult<StoredMediaMetadata | null>> {
    return { ok: true, data: this.metadata.get(mediaId) ?? null };
  }

  async updateDownloadStatus(
    mediaId: string,
    update: {
      status: DownloadStatus;
      progress?: number;
      downloadedBytes?: number;
      downloadedAt?: string | null;
      error?: string | null;
    }
  ): Promise<StorageResult<StoredMediaMetadata>> {
    const current = this.metadata.get(mediaId) ?? toStored(makeMedia({ id: mediaId }));
    const next: StoredMediaMetadata = {
      ...current,
      download_status: update.status,
      download_progress: update.progress ?? current.download_progress,
      downloaded_bytes: update.downloadedBytes ?? current.downloaded_bytes,
      downloaded_at: update.downloadedAt ?? current.downloaded_at,
      download_error: update.error ?? current.download_error
    };
    this.metadata.set(mediaId, next);
    this.updates.push({
      mediaId,
      status: update.status,
      downloadedBytes: update.downloadedBytes
    });
    return { ok: true, data: next };
  }
}

function makeManager(input: {
  fetcher: typeof fetch;
  cacheStorage?: FakeCacheStorage;
  metadataStorage?: FakeMetadataStorage;
  quota?: StorageEstimate;
  chunkSizeBytes?: number;
}) {
  const cacheStorage = input.cacheStorage ?? new FakeCacheStorage();
  const metadataStorage = input.metadataStorage ?? new FakeMetadataStorage();
  const manager = new MediaDownloadManager({
    fetcher: input.fetcher,
    cacheStorage: cacheStorage as unknown as CacheStorage,
    metadataStorage: metadataStorage as never,
    storageManager: new StorageManagerService({
      storageManager: {
        estimate: async () => input.quota ?? { quota: 1_000_000, usage: 0 },
        persist: async () => true,
        persisted: async () => true
      }
    }),
    chunkSizeBytes: input.chunkSizeBytes ?? 4
  });

  return { manager, cacheStorage, metadataStorage };
}

describe("MediaDownloadManager", () => {
  it("downloads media from CDN and stores final bytes in Cache API", async () => {
    const media = makeMedia({ file_size: 4 });
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const range = new Headers(init?.headers).get("Range");
      expect(range).toBe("bytes=0-3");
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "Content-Type": "video/mp4" }
      });
    });
    const { manager, cacheStorage, metadataStorage } = makeManager({
      fetcher,
      chunkSizeBytes: 4
    });

    const result = await manager.download(media);
    const mediaCache = cacheStorage.caches.get("fieldtrix-media-v1");

    expect(result.fromCache).toBe(false);
    expect(await mediaCache?.match(getVersionedMediaCacheKey(media))).toBeDefined();
    expect(metadataStorage.updates.at(-1)?.status).toBe("downloaded");
  });

  it("resumes from cached chunks and only fetches missing ranges", async () => {
    const media = makeMedia({ file_size: 8 });
    const cacheStorage = new FakeCacheStorage();
    const chunkCache = await cacheStorage.open("fieldtrix-media-chunks-v1");
    await chunkCache.put(
      getVersionedMediaChunkCacheKey(media, 0, 3),
      new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 206,
        headers: { "Content-Length": "4" }
      })
    );
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      expect(new Headers(init?.headers).get("Range")).toBe("bytes=4-7");
      return new Response(new Uint8Array([5, 6, 7, 8]), { status: 206 });
    });
    const { manager } = makeManager({
      fetcher,
      cacheStorage,
      chunkSizeBytes: 4
    });

    await manager.download(media);

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("returns cached media without refetching CDN", async () => {
    const media = makeMedia();
    const cacheStorage = new FakeCacheStorage();
    const mediaCache = await cacheStorage.open("fieldtrix-media-v1");
    await mediaCache.put(getVersionedMediaCacheKey(media), new Response("cached"));
    const fetcher = vi.fn<typeof fetch>();
    const { manager } = makeManager({ fetcher, cacheStorage });

    const result = await manager.download(media);

    expect(result.fromCache).toBe(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("detects insufficient browser storage quota before downloading", async () => {
    const media = makeMedia({ file_size: 1000 });
    const { manager } = makeManager({
      fetcher: vi.fn<typeof fetch>(),
      quota: { quota: 500, usage: 100 }
    });

    await expect(manager.download(media)).rejects.toMatchObject({
      code: "quota_exceeded"
    });
  });

  it("rejects media larger than the offline media size limit", async () => {
    const media = makeMedia({ file_size: 101 * 1024 * 1024 });
    const { manager } = makeManager({
      fetcher: vi.fn<typeof fetch>(),
      quota: { quota: 1024 * 1024 * 1024, usage: 0 }
    });

    await expect(manager.download(media)).rejects.toMatchObject({
      code: "quota_exceeded",
      message: "This file is larger than the 100 MB offline download limit."
    });
  });
});
