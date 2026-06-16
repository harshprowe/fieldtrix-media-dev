import type { MediaRead } from "../../api/media";
import { requestMediaPlaybackUrl } from "../../api/media";
import {
  OfflinePlaybackError,
  PlaybackSource,
  type OfflinePlaybackServicePort,
  type ResolvedPlaybackSource
} from "./types";
import {
  mediaHealthService,
  MediaHealthStatus,
  type MediaHealthServicePort
} from "../mediaHealth";
import { getMediaVersionIdentity, getVersionedMediaCacheKey } from "../mediaIdentity";

const MEDIA_CACHE_NAME = "fieldtrix-media-v1";

type OfflinePlaybackDependencies = {
  cacheStorage: CacheStorage;
  healthService: MediaHealthServicePort;
  resolvePlaybackUrl: typeof requestMediaPlaybackUrl;
  urlFactory: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  logger: Pick<Console, "debug" | "info" | "warn" | "error">;
};

async function createSignedCdnSource(
  media: MediaRead,
  resolvePlaybackUrl: typeof requestMediaPlaybackUrl
): Promise<ResolvedPlaybackSource> {
  const playback = await resolvePlaybackUrl(media.id);
  return {
    media,
    playback_source: PlaybackSource.CDN,
    url: playback.playback_url,
    objectUrl: null,
    contentType: null,
    revoke: () => undefined
  };
}

export class OfflinePlaybackService implements OfflinePlaybackServicePort {
  private readonly cacheStorage?: CacheStorage;
  private readonly healthService: MediaHealthServicePort;
  private readonly resolvePlaybackUrl: typeof requestMediaPlaybackUrl;
  private readonly urlFactory: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  private readonly logger: Pick<Console, "debug" | "info" | "warn" | "error">;

  constructor(dependencies?: Partial<OfflinePlaybackDependencies>) {
    this.cacheStorage = dependencies?.cacheStorage ?? globalThis.caches;
    this.healthService = dependencies?.healthService ?? mediaHealthService;
    this.resolvePlaybackUrl = dependencies?.resolvePlaybackUrl ?? requestMediaPlaybackUrl;
    this.urlFactory = dependencies?.urlFactory ?? URL;
    this.logger = dependencies?.logger ?? console;
  }

  async resolvePlaybackSource(media: MediaRead): Promise<ResolvedPlaybackSource> {
    this.logger.info("[OfflinePlaybackService] playback opened", {
      mediaId: media.id,
      mediaVersion: media.version,
      mediaIdentity: getMediaVersionIdentity(media)
    });

    if (!this.cacheStorage) {
      this.logger.warn("[OfflinePlaybackService] Cache API unavailable, falling back to CDN", {
        mediaId: media.id,
        playback_source: PlaybackSource.CDN
      });
      return createSignedCdnSource(media, this.resolvePlaybackUrl);
    }

    const health = await this.healthService.verifyMedia(media.id);
    if (health.status !== MediaHealthStatus.DOWNLOADED) {
      this.logger.info("[OfflinePlaybackService] local media unavailable, using CDN", {
        mediaId: media.id,
        mediaVersion: media.version,
        healthStatus: health.status,
        playback_source: PlaybackSource.CDN
      });
      return createSignedCdnSource(media, this.resolvePlaybackUrl);
    }

    let cachedResponse: Response | undefined;
    try {
      const cache = await this.cacheStorage.open(MEDIA_CACHE_NAME);
      cachedResponse = await cache.match(getVersionedMediaCacheKey(media));
    } catch (error) {
      this.logger.error("[OfflinePlaybackService] cache lookup failed, falling back to CDN", {
        mediaId: media.id,
        playback_source: PlaybackSource.CDN,
        error
      });
      return createSignedCdnSource(media, this.resolvePlaybackUrl);
    }

    if (!cachedResponse) {
      this.logger.info("[OfflinePlaybackService] playback source selected", {
        mediaId: media.id,
        mediaVersion: media.version,
        playback_source: PlaybackSource.CDN
      });
      return createSignedCdnSource(media, this.resolvePlaybackUrl);
    }

    try {
      const blob = await cachedResponse.blob();
      const objectUrl = this.urlFactory.createObjectURL(blob);
      this.logger.info("[OfflinePlaybackService] playback source selected", {
        mediaId: media.id,
        mediaVersion: media.version,
        playback_source: PlaybackSource.CACHE,
        size: blob.size,
        type: blob.type || cachedResponse.headers.get("Content-Type")
      });

      return {
        media,
        playback_source: PlaybackSource.CACHE,
        url: objectUrl,
        objectUrl,
        contentType: blob.type || cachedResponse.headers.get("Content-Type"),
        revoke: () => {
          this.logger.info("[OfflinePlaybackService] playback source revoked", {
            mediaId: media.id,
            mediaVersion: media.version,
            playback_source: PlaybackSource.CACHE
          });
          this.urlFactory.revokeObjectURL(objectUrl);
        }
      };
    } catch (error) {
      this.logger.error("[OfflinePlaybackService] failed to create cached playback source", {
        mediaId: media.id,
        mediaVersion: media.version,
        playback_source: PlaybackSource.CACHE,
        error
      });
      throw new OfflinePlaybackError("Unable to create local playback source", "blob_url_failed");
    }
  }
}

export const offlinePlaybackService = new OfflinePlaybackService();
