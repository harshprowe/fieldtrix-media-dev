import { describe, expect, it, vi } from "vitest";

import type { MediaRead } from "../../api/media";
import type { StorageResult, StoredMediaMetadata } from "../../storage/mediaStorageService";
import { MediaSyncEngine } from "./MediaSyncEngine";
import type { MediaListPage } from "./types";

function makeMedia(id: string, version: number): MediaRead {
  return {
    id,
    title: `Media ${id}`,
    media_type: "video",
    version,
    file_size: 1024,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z"
  };
}

function toStored(media: MediaRead): StoredMediaMetadata {
  return {
    ...media,
    download_status: "downloaded",
    download_progress: 1,
    downloaded_bytes: media.file_size,
    last_synced_at: "2026-06-05T00:00:00.000Z",
    downloaded_at: "2026-06-05T00:00:00.000Z",
    download_error: null
  };
}

class FakeMediaApi {
  calls: Array<{ limit: number; offset: number }> = [];

  constructor(private readonly items: MediaRead[]) {}

  async listMedia(params: { limit: number; offset: number }): Promise<MediaListPage> {
    this.calls.push(params);
    return {
      items: this.items.slice(params.offset, params.offset + params.limit),
      total: this.items.length,
      limit: params.limit,
      offset: params.offset
    };
  }
}

class FakeStorage {
  records = new Map<string, StoredMediaMetadata>();
  deleted: string[] = [];

  async getMediaMetadata(mediaId: string): Promise<StorageResult<StoredMediaMetadata | null>> {
    return { ok: true, data: this.records.get(mediaId) ?? null };
  }

  async saveMediaMetadata(media: MediaRead): Promise<StorageResult<StoredMediaMetadata>> {
    const stored = this.records.get(media.id);
    const next = stored ? { ...stored, ...media } : toStored(media);
    this.records.set(media.id, next);
    return { ok: true, data: next };
  }

  async deleteMediaMetadata(mediaId: string): Promise<StorageResult<void>> {
    this.deleted.push(mediaId);
    this.records.delete(mediaId);
    return { ok: true, data: undefined };
  }
}

class FakeDownloader {
  deleted: MediaRead[] = [];
  downloaded: MediaRead[] = [];

  async deleteCachedMedia(media: MediaRead): Promise<void> {
    this.deleted.push(media);
  }

  async download(media: MediaRead): Promise<void> {
    this.downloaded.push(media);
  }
}

function makeEngine(input: {
  serverItems: MediaRead[];
  storage?: FakeStorage;
  downloader?: FakeDownloader;
}) {
  const api = new FakeMediaApi(input.serverItems);
  const storage = input.storage ?? new FakeStorage();
  const downloader = input.downloader ?? new FakeDownloader();
  const engine = new MediaSyncEngine({
    api,
    storage,
    downloader,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    }
  });

  return { engine, api, storage, downloader };
}

describe("MediaSyncEngine", () => {
  it("fetches media in pages for efficient large-list synchronization", async () => {
    const serverItems = Array.from({ length: 250 }, (_, index) => makeMedia(String(index), 1));
    const { engine, api } = makeEngine({ serverItems });

    const summary = await engine.sync({ pageSize: 100 });

    expect(summary.scanned).toBe(250);
    expect(summary.status).toBe("completed");
    expect(api.calls).toEqual([
      { limit: 100, offset: 0 },
      { limit: 100, offset: 100 },
      { limit: 100, offset: 200 }
    ]);
  });

  it("leaves matching versions unchanged", async () => {
    const media = makeMedia("media-1", 2);
    const storage = new FakeStorage();
    storage.records.set(media.id, toStored(media));
    const { engine, downloader } = makeEngine({ serverItems: [media], storage });

    const summary = await engine.sync();

    expect(summary.unchanged).toBe(1);
    expect(downloader.deleted).toHaveLength(0);
    expect(downloader.downloaded).toHaveLength(0);
  });

  it("invalidates cache and redownloads when server version differs", async () => {
    const local = makeMedia("media-1", 1);
    const server = makeMedia("media-1", 2);
    const storage = new FakeStorage();
    storage.records.set(local.id, toStored(local));
    const { engine, downloader } = makeEngine({ serverItems: [server], storage });

    const summary = await engine.sync();

    expect(summary.updated).toBe(1);
    expect(summary.redownloaded).toBe(1);
    expect(summary.status).toBe("completed");
    expect(downloader.deleted[0].version).toBe(1);
    expect(storage.deleted).toEqual(["media-1"]);
    expect(downloader.downloaded[0].version).toBe(2);
  });

  it("prevents duplicate downloads for the same server media version", async () => {
    const local = makeMedia("media-1", 1);
    const server = makeMedia("media-1", 2);
    const storage = new FakeStorage();
    storage.records.set(local.id, toStored(local));
    const { engine, downloader } = makeEngine({ serverItems: [server, server], storage });

    const summary = await engine.sync();

    expect(summary.updated).toBe(1);
    expect(summary.redownloaded).toBe(1);
    expect(downloader.deleted).toHaveLength(1);
    expect(storage.deleted).toEqual(["media-1"]);
    expect(downloader.downloaded).toHaveLength(1);
  });

  it("emits checking, downloading, and completed statuses", async () => {
    const local = makeMedia("media-1", 1);
    const server = makeMedia("media-1", 2);
    const storage = new FakeStorage();
    storage.records.set(local.id, toStored(local));
    const { engine } = makeEngine({ serverItems: [server], storage });
    const statuses: string[] = [];

    await engine.sync({
      onProgress(progress) {
        statuses.push(progress.status);
      }
    });

    expect(statuses).toContain("checking");
    expect(statuses).toContain("downloading");
    expect(statuses.at(-1)).toBe("completed");
  });

  it("reports failed status when a changed version cannot download", async () => {
    class FailingDownloader extends FakeDownloader {
      async download(media: MediaRead): Promise<void> {
        this.downloaded.push(media);
        throw new Error("Download failed");
      }
    }
    const local = makeMedia("media-1", 1);
    const server = makeMedia("media-1", 2);
    const storage = new FakeStorage();
    const downloader = new FailingDownloader();
    storage.records.set(local.id, toStored(local));
    const { engine } = makeEngine({ serverItems: [server], storage, downloader });

    const summary = await engine.sync();

    expect(summary.status).toBe("failed");
    expect(summary.failed).toBe(1);
    expect(storage.deleted).toEqual(["media-1"]);
  });
});
