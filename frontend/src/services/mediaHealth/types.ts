import type { StoredMediaMetadata } from "../../storage/mediaStorageService";

export enum MediaHealthStatus {
  DOWNLOADED = "downloaded",
  STALE = "stale",
  NOT_DOWNLOADED = "not_downloaded"
}

export type MediaHealthResult = {
  mediaId: string;
  status: MediaHealthStatus;
  metadata: StoredMediaMetadata | null;
  cacheExists: boolean;
};

export interface MediaHealthServicePort {
  verifyMedia(mediaId: string): Promise<MediaHealthResult>;
  markStale(mediaId: string): Promise<MediaHealthResult>;
}
