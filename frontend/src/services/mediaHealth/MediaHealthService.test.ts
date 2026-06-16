import { describe, expect, it, vi } from "vitest";

import type {
  DownloadStatus,
  StorageResult,
  StoredMediaMetadata
} from "../../storage/mediaStorageService";
import { getVersionedMediaCacheKey } from "../mediaIdentity";
import { MediaHealthService } from "./MediaHealthService";
import { MediaHealthStatus } from "./types";

function makeMetadata(
  overrides: Partial<StoredMediaMetadata> = {}
): StoredMediaMetadata {
  return {
    id: "media-1",
    title: "Launch Screen",
    media_type: "image",
    version: 1,
    file_size: 1024,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    download_status: "downloaded",
    download_progress: 1,
    downloaded_bytes: 1024,
    last_synced_at: "2026-06-05T00:00:00.000Z",
    downloaded_at: "2026-06-05T00:00:00.000Z",
    download_error: null,
    ...overrides
  };
}

class FakeCache {
  records = new Map<string, Response>();

  async match(request: RequestInfo | URL): Promise<Response | undefined> {
    return this.records.get(String(request));
  }
}

class FakeCacheStorage {
  cache = new FakeCache();

  async open(): Promise<Cache> {
    return this.cache as unknown as Cache;
  }
}

class FakeMetadataStorage {
  metadata: StoredMediaMetadata | null = null;

  async getMediaMetadata(): Promise<StorageResult<StoredMediaMetadata | null>> {
    return { ok: true, data: this.metadata };
  }

  async updateDownloadStatus(
    _mediaId: string,
    update: {
      status: DownloadStatus;
      progress?: number;
      downloadedBytes?: number;
      downloadedAt?: string | null;
      error?: string | null;
    }
  ): Promise<StorageResult<StoredMediaMetadata>> {
    const current = this.metadata ?? makeMetadata();
    this.metadata = {
      ...current,
      download_status: update.status,
      download_progress: update.progress ?? current.download_progress,
      downloaded_bytes: update.downloadedBytes ?? current.downloaded_bytes,
      downloaded_at: update.downloadedAt ?? current.downloaded_at,
      download_error: update.error ?? current.download_error
    };
    return { ok: true, data: this.metadata };
  }
}

function makeService(input: {
  metadata: StoredMediaMetadata | null;
  cacheExists: boolean;
}) {
  const cacheStorage = new FakeCacheStorage();
  const metadataStorage = new FakeMetadataStorage();
  metadataStorage.metadata = input.metadata;
  if (input.metadata && input.cacheExists) {
    cacheStorage.cache.records.set(getVersionedMediaCacheKey(input.metadata), new Response("cached"));
  }

  return {
    service: new MediaHealthService({
      cacheStorage: cacheStorage as unknown as CacheStorage,
      metadataStorage: metadataStorage as never,
      logger: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }),
    metadataStorage
  };
}

describe("MediaHealthService", () => {
  it("returns downloaded when metadata and cached file exist", async () => {
    const { service } = makeService({
      metadata: makeMetadata(),
      cacheExists: true
    });

    await expect(service.verifyMedia("media-1")).resolves.toMatchObject({
      status: MediaHealthStatus.DOWNLOADED,
      cacheExists: true
    });
  });

  it("marks media stale when metadata exists but cache is missing", async () => {
    const { service, metadataStorage } = makeService({
      metadata: makeMetadata(),
      cacheExists: false
    });

    const result = await service.verifyMedia("media-1");

    expect(result.status).toBe(MediaHealthStatus.STALE);
    expect(result.cacheExists).toBe(false);
    expect(metadataStorage.metadata?.download_status).toBe("stale");
    expect(metadataStorage.metadata?.download_error).toBe(
      "Cached media is missing. Download again to restore offline playback."
    );
  });

  it("returns not downloaded when metadata and cache are missing", async () => {
    const { service } = makeService({
      metadata: null,
      cacheExists: false
    });

    await expect(service.verifyMedia("media-1")).resolves.toMatchObject({
      status: MediaHealthStatus.NOT_DOWNLOADED,
      cacheExists: false,
      metadata: null
    });
  });

  it("keeps stale media marked stale on later checks", async () => {
    const { service } = makeService({
      metadata: makeMetadata({ download_status: "stale" }),
      cacheExists: false
    });

    await expect(service.verifyMedia("media-1")).resolves.toMatchObject({
      status: MediaHealthStatus.STALE,
      cacheExists: false
    });
  });
});
