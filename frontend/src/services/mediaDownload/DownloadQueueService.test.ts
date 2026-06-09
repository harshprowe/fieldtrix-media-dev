import { describe, expect, it } from "vitest";

import type { MediaRead } from "../../api/media";
import { DownloadQueueService } from "./DownloadQueueService";
import type {
  MediaDownloadManagerPort,
  MediaDownloadOptions,
  MediaDownloadResult
} from "./types";

function makeMedia(index: number): MediaRead {
  return {
    id: `media-${index}`,
    title: `Media ${index}`,
    media_type: "video",
    object_key: `media/media-${index}/v1/video.mp4`,
    cdn_url: `https://cdn.example.com/media/media-${index}/v1/video.mp4`,
    version: 1,
    file_size: 1024,
    created_at: "2026-06-06T00:00:00.000Z",
    updated_at: "2026-06-06T00:00:00.000Z"
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeDownloadManager implements MediaDownloadManagerPort {
  active = 0;
  maxActive = 0;
  started: string[] = [];
  deferred = new Map<string, ReturnType<typeof createDeferred<MediaDownloadResult>>>();

  async download(media: MediaRead, options: MediaDownloadOptions = {}): Promise<MediaDownloadResult> {
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.started.push(media.id);
    options.onProgress?.({
      mediaId: media.id,
      status: "downloading",
      downloadedBytes: 0,
      totalBytes: media.file_size,
      progress: 0,
      resumable: false
    });

    const deferred = createDeferred<MediaDownloadResult>();
    this.deferred.set(media.id, deferred);
    try {
      return await deferred.promise;
    } finally {
      this.active -= 1;
    }
  }

  async isCached(): Promise<boolean> {
    return false;
  }

  async deleteCachedMedia(): Promise<void> {
    return undefined;
  }

  async getStorageEstimate(): Promise<StorageEstimate | null> {
    return null;
  }
}

function completeDownload(manager: FakeDownloadManager, media: MediaRead): void {
  manager.deferred.get(media.id)?.resolve({
    media,
    cacheKey: "cache-key",
    downloadedBytes: media.file_size,
    fromCache: false
  });
}

describe("DownloadQueueService", () => {
  it("limits active downloads to three and queues the rest", async () => {
    const manager = new FakeDownloadManager();
    const service = new DownloadQueueService({
      downloadManager: manager,
      maxConcurrentDownloads: 3
    });

    const media = [1, 2, 3, 4, 5].map(makeMedia);
    const promises = media.map((item) => service.enqueue(item));
    await Promise.resolve();

    expect(manager.started).toEqual(["media-1", "media-2", "media-3"]);
    expect(manager.maxActive).toBe(3);
    expect(service.getSnapshot()).toMatchObject({
      queued: 2,
      downloading: 3,
      completed: 0,
      failed: 0
    });

    completeDownload(manager, media[0]);
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.started).toContain("media-4");
    expect(manager.maxActive).toBe(3);

    completeDownload(manager, media[1]);
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.started).toContain("media-5");

    for (const item of media.slice(2)) {
      completeDownload(manager, item);
    }

    await Promise.all(promises);
    expect(service.getSnapshot()).toMatchObject({
      queued: 0,
      downloading: 0,
      completed: 5,
      failed: 0
    });
  });

  it("tracks failed downloads and continues processing queued work", async () => {
    const manager = new FakeDownloadManager();
    const service = new DownloadQueueService({
      downloadManager: manager,
      maxConcurrentDownloads: 1
    });
    const first = makeMedia(1);
    const second = makeMedia(2);

    const firstPromise = service.enqueue(first);
    const secondPromise = service.enqueue(second);
    await Promise.resolve();

    manager.deferred.get(first.id)?.reject(new Error("Network unavailable"));
    await expect(firstPromise).rejects.toThrow("Network unavailable");
    await Promise.resolve();
    await Promise.resolve();

    expect(manager.started).toEqual(["media-1", "media-2"]);
    expect(service.getSnapshot()).toMatchObject({
      queued: 0,
      downloading: 1,
      completed: 0,
      failed: 1
    });

    completeDownload(manager, second);
    await secondPromise;

    expect(service.getSnapshot()).toMatchObject({
      queued: 0,
      downloading: 0,
      completed: 1,
      failed: 1
    });
  });
});
