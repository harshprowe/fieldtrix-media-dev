import { describe, expect, it, vi } from "vitest";

import type { MediaRead } from "../../api/media";
import type { MediaHealthResult, MediaHealthServicePort } from "../mediaHealth";
import { MediaHealthStatus } from "../mediaHealth";
import { getVersionedMediaCacheKey } from "../mediaIdentity";
import { OfflinePlaybackService } from "./OfflinePlaybackService";
import { PlaybackSource } from "./types";

function makeMedia(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: "media-1",
    title: "Launch Screen",
    media_type: "image",
    version: 1,
    file_size: 1024,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
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

class FakeHealthService implements MediaHealthServicePort {
  constructor(private readonly result: MediaHealthResult) {}

  async verifyMedia(): Promise<MediaHealthResult> {
    return this.result;
  }

  async markStale(): Promise<MediaHealthResult> {
    return {
      ...this.result,
      status: MediaHealthStatus.STALE,
      cacheExists: false
    };
  }
}

function makeHealthService(
  media: MediaRead,
  status: MediaHealthStatus
): MediaHealthServicePort {
  return new FakeHealthService({
    mediaId: media.id,
    status,
    metadata: null,
    cacheExists: status === MediaHealthStatus.DOWNLOADED
  });
}

describe("OfflinePlaybackService", () => {
  it("creates a blob URL when cached media is available", async () => {
    const cacheStorage = new FakeCacheStorage();
    const media = makeMedia();
    cacheStorage.cache.records.set(
      getVersionedMediaCacheKey(media),
      new Response(new Blob(["image-bytes"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    );
    const revokeObjectURL = vi.fn();
    const service = new OfflinePlaybackService({
      cacheStorage: cacheStorage as unknown as CacheStorage,
      healthService: makeHealthService(media, MediaHealthStatus.DOWNLOADED),
      resolvePlaybackUrl: vi.fn(),
      urlFactory: {
        createObjectURL: () => "blob:fieldtrix-media",
        revokeObjectURL
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });

    const source = await service.resolvePlaybackSource(media);

    expect(source.playback_source).toBe(PlaybackSource.CACHE);
    expect(source.url).toBe("blob:fieldtrix-media");
    expect(source.contentType).toBe("image/png");
    source.revoke();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fieldtrix-media");
  });

  it("does not make a network request for downloaded media", async () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn<typeof fetch>();
    globalThis.fetch = fetchSpy;
    const cacheStorage = new FakeCacheStorage();
    const media = makeMedia();
    cacheStorage.cache.records.set(
      getVersionedMediaCacheKey(media),
      new Response(new Blob(["image-bytes"], { type: "image/png" }), {
        status: 200,
        headers: { "Content-Type": "image/png" }
      })
    );
    const service = new OfflinePlaybackService({
      cacheStorage: cacheStorage as unknown as CacheStorage,
      healthService: makeHealthService(media, MediaHealthStatus.DOWNLOADED),
      resolvePlaybackUrl: vi.fn(),
      urlFactory: {
        createObjectURL: () => "blob:fieldtrix-media",
        revokeObjectURL: vi.fn()
      },
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });

    try {
      const source = await service.resolvePlaybackSource(media);

      expect(source.playback_source).toBe(PlaybackSource.CACHE);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("falls back to a signed CDN URL when media is not cached", async () => {
    const resolvePlaybackUrl = vi.fn(async () => ({
      media_id: "media-1",
      version: 1,
      playback_url: "https://signed.example.com/media",
      expires_in: 900
    }));
    const service = new OfflinePlaybackService({
      cacheStorage: new FakeCacheStorage() as unknown as CacheStorage,
      healthService: makeHealthService(makeMedia(), MediaHealthStatus.NOT_DOWNLOADED),
      resolvePlaybackUrl,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    });
    const media = makeMedia();

    const source = await service.resolvePlaybackSource(media);

    expect(source.playback_source).toBe(PlaybackSource.CDN);
    expect(source.url).toBe("https://signed.example.com/media");
    expect(source.objectUrl).toBeNull();
    expect(resolvePlaybackUrl).toHaveBeenCalledWith(media.id);
  });
});
