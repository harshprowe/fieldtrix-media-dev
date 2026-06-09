export const MAX_MEDIA_SIZE_BYTES = 100 * 1024 * 1024;
export const MAX_TOTAL_OFFLINE_STORAGE_BYTES = 500 * 1024 * 1024;

export type StorageBudgetStatus = {
  usage: number;
  quota: number | null;
  availableSpace: number | null;
  persistent: boolean | null;
  maxMediaSize: number;
  maxTotalOfflineStorage: number;
};

export type DownloadBudgetCheck = {
  allowed: boolean;
  reason: string | null;
  status: StorageBudgetStatus;
};

type BrowserStorageManager = Pick<StorageManager, "estimate" | "persist" | "persisted">;

type StorageManagerDependencies = {
  storageManager?: BrowserStorageManager;
};

function unavailableStatus(): StorageBudgetStatus {
  return {
    usage: 0,
    quota: null,
    availableSpace: null,
    persistent: null,
    maxMediaSize: MAX_MEDIA_SIZE_BYTES,
    maxTotalOfflineStorage: MAX_TOTAL_OFFLINE_STORAGE_BYTES
  };
}

export class StorageManagerService {
  private readonly storageManager?: BrowserStorageManager;

  constructor(dependencies: StorageManagerDependencies = {}) {
    this.storageManager = dependencies.storageManager ?? globalThis.navigator?.storage;
  }

  async requestPersistentStorage(): Promise<boolean> {
    if (!this.storageManager?.persist) {
      return false;
    }
    return this.storageManager.persist();
  }

  async isPersistent(): Promise<boolean | null> {
    if (!this.storageManager?.persisted) {
      return null;
    }
    return this.storageManager.persisted();
  }

  async getUsage(): Promise<number> {
    return (await this.getEstimate()).usage;
  }

  async getQuota(): Promise<number | null> {
    return (await this.getEstimate()).quota;
  }

  async getAvailableSpace(): Promise<number | null> {
    const estimate = await this.getEstimate();
    if (estimate.quota === null) {
      return null;
    }
    return Math.max(estimate.quota - estimate.usage, 0);
  }

  async getStatus(): Promise<StorageBudgetStatus> {
    const estimate = await this.getEstimate();
    return {
      usage: estimate.usage,
      quota: estimate.quota,
      availableSpace: estimate.quota === null ? null : Math.max(estimate.quota - estimate.usage, 0),
      persistent: await this.isPersistent(),
      maxMediaSize: MAX_MEDIA_SIZE_BYTES,
      maxTotalOfflineStorage: MAX_TOTAL_OFFLINE_STORAGE_BYTES
    };
  }

  async canDownload(fileSize: number): Promise<DownloadBudgetCheck> {
    const status = await this.getStatus();
    if (fileSize > MAX_MEDIA_SIZE_BYTES) {
      return {
        allowed: false,
        reason: "This file is larger than the 100 MB offline download limit.",
        status
      };
    }

    if (status.usage + fileSize > MAX_TOTAL_OFFLINE_STORAGE_BYTES) {
      return {
        allowed: false,
        reason: "Offline storage is limited to 500 MB. Remove cached media before downloading.",
        status
      };
    }

    if (status.availableSpace !== null && status.availableSpace < fileSize) {
      return {
        allowed: false,
        reason: "Your browser does not have enough available storage for this download.",
        status
      };
    }

    return {
      allowed: true,
      reason: null,
      status
    };
  }

  private async getEstimate(): Promise<{ usage: number; quota: number | null }> {
    if (!this.storageManager?.estimate) {
      return {
        usage: unavailableStatus().usage,
        quota: unavailableStatus().quota
      };
    }

    const estimate = await this.storageManager.estimate();
    return {
      usage: estimate.usage ?? 0,
      quota: estimate.quota ?? null
    };
  }
}

export const storageManagerService = new StorageManagerService();
