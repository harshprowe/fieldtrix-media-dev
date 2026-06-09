import type { MediaRead } from "../../api/media";

export enum PlaybackSource {
  CACHE = "CACHE",
  CDN = "CDN"
}

export type ResolvedPlaybackSource = {
  media: MediaRead;
  playback_source: PlaybackSource;
  url: string;
  objectUrl: string | null;
  contentType: string | null;
  revoke: () => void;
};

export type PlaybackFailureCode = "cache_unavailable" | "cache_read_failed" | "blob_url_failed";

export class OfflinePlaybackError extends Error {
  constructor(
    message: string,
    readonly code: PlaybackFailureCode
  ) {
    super(message);
    this.name = "OfflinePlaybackError";
  }
}

export interface OfflinePlaybackServicePort {
  resolvePlaybackSource(media: MediaRead): Promise<ResolvedPlaybackSource>;
}
