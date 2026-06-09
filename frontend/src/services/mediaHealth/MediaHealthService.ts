import {
  mediaStorageService,
  type MediaStorageService,
  type StoredMediaMetadata
} from "../../storage/mediaStorageService";
import { getVersionedMediaCacheKey } from "../mediaIdentity";
import {
  MediaHealthStatus,
  type MediaHealthResult,
  type MediaHealthServicePort
} from "./types";

const MEDIA_CACHE_NAME = "fieldtrix-media-v1";

type MediaHealthDependencies = {
  cacheStorage: CacheStorage;
  metadataStorage: MediaStorageService;
  logger: Pick<Console, "debug" | "warn" | "error">;
};

export class MediaHealthService implements MediaHealthServicePort {
  private readonly cacheStorage?: CacheStorage;
  private readonly metadataStorage: MediaStorageService;
  private readonly logger: Pick<Console, "debug" | "warn" | "error">;

  constructor(dependencies?: Partial<MediaHealthDependencies>) {
    this.cacheStorage = dependencies?.cacheStorage ?? globalThis.caches;
    this.metadataStorage = dependencies?.metadataStorage ?? mediaStorageService;
    this.logger = dependencies?.logger ?? console;
  }

  async verifyMedia(mediaId: string): Promise<MediaHealthResult> {
    const metadataResult = await this.metadataStorage.getMediaMetadata(mediaId);
    if (!metadataResult.ok) {
      throw new Error(metadataResult.error.message);
    }

    const metadata = metadataResult.data;
    if (!metadata) {
      return {
        mediaId,
        status: MediaHealthStatus.NOT_DOWNLOADED,
        metadata,
        cacheExists: false
      };
    }

    if (metadata.download_status === "stale") {
      return {
        mediaId,
        status: MediaHealthStatus.STALE,
        metadata,
        cacheExists: false
      };
    }

    if (metadata.download_status !== "downloaded") {
      return {
        mediaId,
        status: MediaHealthStatus.NOT_DOWNLOADED,
        metadata,
        cacheExists: false
      };
    }

    const cacheExists = await this.hasCachedMedia(metadata);
    if (!cacheExists) {
      this.logger.warn("[MediaHealthService] downloaded metadata has no cached media", {
        mediaId,
        version: metadata.version
      });
      return this.markStale(mediaId);
    }

    this.logger.debug("[MediaHealthService] media cache verified", {
      mediaId,
      version: metadata.version
    });
    return {
      mediaId,
      status: MediaHealthStatus.DOWNLOADED,
      metadata,
      cacheExists: true
    };
  }

  async markStale(mediaId: string): Promise<MediaHealthResult> {
    const metadataResult = await this.metadataStorage.getMediaMetadata(mediaId);
    if (!metadataResult.ok) {
      throw new Error(metadataResult.error.message);
    }

    const metadata = metadataResult.data;
    if (!metadata) {
      return {
        mediaId,
        status: MediaHealthStatus.NOT_DOWNLOADED,
        metadata: null,
        cacheExists: false
      };
    }

    const updated = await this.metadataStorage.updateDownloadStatus(mediaId, {
      status: "stale",
      progress: 0,
      downloadedBytes: 0,
      downloadedAt: null,
      error: "Cached media is missing. Download again to restore offline playback."
    });
    if (!updated.ok) {
      throw new Error(updated.error.message);
    }

    return {
      mediaId,
      status: MediaHealthStatus.STALE,
      metadata: updated.data,
      cacheExists: false
    };
  }

  private async hasCachedMedia(metadata: StoredMediaMetadata): Promise<boolean> {
    if (!this.cacheStorage) {
      return false;
    }

    try {
      const cache = await this.cacheStorage.open(MEDIA_CACHE_NAME);
      return Boolean(await cache.match(getVersionedMediaCacheKey(metadata)));
    } catch (error) {
      this.logger.error("[MediaHealthService] cache verification failed", {
        mediaId: metadata.id,
        version: metadata.version,
        error
      });
      return false;
    }
  }
}

export const mediaHealthService = new MediaHealthService();
