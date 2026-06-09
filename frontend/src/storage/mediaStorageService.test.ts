import "fake-indexeddb/auto";

import { afterEach, describe, expect, it } from "vitest";

import type { MediaRead } from "../api/media";
import { MediaStorageService } from "./mediaStorageService";

function makeMedia(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: "media-1",
    title: "Launch Screen",
    media_type: "image",
    object_key: "media/media-1/v1/launch.png",
    cdn_url: "https://cdn.example.com/media/media-1/v1/launch.png",
    version: 1,
    file_size: 1024,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    ...overrides
  };
}

describe("MediaStorageService", () => {
  const service = new MediaStorageService("fieldtrix-media-test");

  afterEach(async () => {
    await service.clearForTests();
  });

  it("saves and retrieves media metadata", async () => {
    const saved = await service.saveMediaMetadata(makeMedia());

    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.data.download_status).toBe("not_started");

    const retrieved = await service.getMediaMetadata("media-1");

    expect(retrieved.ok).toBe(true);
    if (!retrieved.ok) {
      return;
    }
    expect(retrieved.data?.title).toBe("Launch Screen");
  });

  it("tracks media versions when metadata changes", async () => {
    await service.saveMediaMetadata(makeMedia({ version: 1 }));
    await service.saveMediaMetadata(
      makeMedia({
        version: 2,
        object_key: "media/media-1/v2/launch.png",
        cdn_url: "https://cdn.example.com/media/media-1/v2/launch.png",
        file_size: 2048
      })
    );

    const history = await service.getVersionHistory("media-1");

    expect(history.ok).toBe(true);
    if (!history.ok) {
      return;
    }
    expect(history.data.map((item) => item.version)).toEqual([2, 1]);
    expect(history.data.map((item) => item.object_key)).toEqual([
      "media/media-1/v2/launch.png",
      "media/media-1/v1/launch.png"
    ]);
  });

  it("treats a changed version as a new local asset", async () => {
    await service.saveMediaMetadata(makeMedia({ version: 1 }));
    await service.updateDownloadStatus("media-1", {
      status: "downloaded",
      downloadedBytes: 1024
    });

    const saved = await service.saveMediaMetadata(
      makeMedia({
        version: 2,
        object_key: "media/media-1/v2/launch.png",
        cdn_url: "https://cdn.example.com/media/media-1/v2/launch.png"
      })
    );

    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.data.download_status).toBe("not_started");
    expect(saved.data.download_progress).toBe(0);
    expect(saved.data.downloaded_bytes).toBe(0);
    expect(saved.data.downloaded_at).toBeNull();
  });

  it("updates download status", async () => {
    await service.saveMediaMetadata(makeMedia());

    const updated = await service.updateDownloadStatus("media-1", {
      status: "downloaded"
    });

    expect(updated.ok).toBe(true);
    if (!updated.ok) {
      return;
    }
    expect(updated.data.download_status).toBe("downloaded");
    expect(updated.data.downloaded_at).not.toBeNull();
  });

  it("lists media by download status", async () => {
    await service.saveMediaMetadata(makeMedia({ id: "media-1" }));
    await service.saveMediaMetadata(makeMedia({ id: "media-2", title: "Menu" }));
    await service.updateDownloadStatus("media-2", { status: "queued" });

    const queued = await service.listByDownloadStatus("queued");

    expect(queued.ok).toBe(true);
    if (!queued.ok) {
      return;
    }
    expect(queued.data).toHaveLength(1);
    expect(queued.data[0].id).toBe("media-2");
  });

  it("deletes metadata and related version history", async () => {
    await service.saveMediaMetadata(makeMedia({ version: 1 }));
    await service.saveMediaMetadata(makeMedia({ version: 2 }));

    const deleted = await service.deleteMediaMetadata("media-1");
    const metadata = await service.getMediaMetadata("media-1");
    const history = await service.getVersionHistory("media-1");

    expect(deleted.ok).toBe(true);
    expect(metadata.ok && metadata.data).toBeNull();
    expect(history.ok && history.data).toEqual([]);
  });

  it("returns not_found when updating a missing media record", async () => {
    const result = await service.updateDownloadStatus("missing", {
      status: "failed",
      error: "Network unavailable"
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe("not_found");
  });
});
