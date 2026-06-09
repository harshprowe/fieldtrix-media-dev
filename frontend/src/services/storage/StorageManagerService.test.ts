import { describe, expect, it, vi } from "vitest";

import {
  MAX_MEDIA_SIZE_BYTES,
  MAX_TOTAL_OFFLINE_STORAGE_BYTES,
  StorageManagerService
} from "./StorageManagerService";

function makeService(input: {
  usage?: number;
  quota?: number;
  persistent?: boolean;
  persistResult?: boolean;
} = {}) {
  const estimate = vi.fn(async () => ({
    usage: input.usage ?? 100,
    quota: input.quota ?? 1000
  }));
  const persist = vi.fn(async () => input.persistResult ?? true);
  const persisted = vi.fn(async () => input.persistent ?? false);

  return {
    service: new StorageManagerService({
      storageManager: {
        estimate,
        persist,
        persisted
      }
    }),
    persist
  };
}

describe("StorageManagerService", () => {
  it("requests persistent storage from the browser", async () => {
    const { service, persist } = makeService({ persistResult: true });

    await expect(service.requestPersistentStorage()).resolves.toBe(true);
    expect(persist).toHaveBeenCalledOnce();
  });

  it("reports usage, quota, and available space", async () => {
    const { service } = makeService({ usage: 250, quota: 1000, persistent: true });

    await expect(service.getUsage()).resolves.toBe(250);
    await expect(service.getQuota()).resolves.toBe(1000);
    await expect(service.getAvailableSpace()).resolves.toBe(750);
    await expect(service.getStatus()).resolves.toMatchObject({
      usage: 250,
      quota: 1000,
      availableSpace: 750,
      persistent: true
    });
  });

  it("rejects downloads larger than 100 MB", async () => {
    const { service } = makeService({
      usage: 0,
      quota: MAX_TOTAL_OFFLINE_STORAGE_BYTES
    });

    const result = await service.canDownload(MAX_MEDIA_SIZE_BYTES + 1);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("This file is larger than the 100 MB offline download limit.");
  });

  it("rejects downloads that exceed the 500 MB offline budget", async () => {
    const { service } = makeService({
      usage: MAX_TOTAL_OFFLINE_STORAGE_BYTES - 10,
      quota: MAX_TOTAL_OFFLINE_STORAGE_BYTES * 2
    });

    const result = await service.canDownload(20);

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe(
      "Offline storage is limited to 500 MB. Remove cached media before downloading."
    );
  });

  it("allows downloads inside file, total, and browser quota limits", async () => {
    const { service } = makeService({
      usage: 10,
      quota: MAX_TOTAL_OFFLINE_STORAGE_BYTES
    });

    const result = await service.canDownload(20);

    expect(result.allowed).toBe(true);
    expect(result.reason).toBeNull();
  });
});
