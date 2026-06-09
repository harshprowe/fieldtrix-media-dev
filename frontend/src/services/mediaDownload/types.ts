import type { MediaRead } from "../../api/media";

export type MediaDownloadStatus =
  | "idle"
  | "queued"
  | "checking_storage"
  | "downloading"
  | "cached"
  | "failed"
  | "cancelled";

export type MediaDownloadProgress = {
  mediaId: string;
  status: MediaDownloadStatus;
  downloadedBytes: number;
  totalBytes: number;
  progress: number;
  resumable: boolean;
};

export type MediaDownloadErrorCode =
  | "cache_unavailable"
  | "quota_exceeded"
  | "network_error"
  | "storage_error"
  | "invalid_response"
  | "cancelled";

export class MediaDownloadError extends Error {
  constructor(
    message: string,
    readonly code: MediaDownloadErrorCode
  ) {
    super(message);
    this.name = "MediaDownloadError";
  }
}

export type MediaDownloadOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: MediaDownloadProgress) => void;
};

export type MediaDownloadResult = {
  media: MediaRead;
  cacheKey: string;
  downloadedBytes: number;
  fromCache: boolean;
};

export interface MediaDownloadManagerPort {
  download(media: MediaRead, options?: MediaDownloadOptions): Promise<MediaDownloadResult>;
  isCached(media: MediaRead): Promise<boolean>;
  deleteCachedMedia(media: MediaRead): Promise<void>;
  getStorageEstimate(): Promise<StorageEstimate | null>;
}

export type DownloadQueueItemStatus = "queued" | "downloading" | "completed" | "failed";

export type DownloadQueueItem = {
  id: string;
  mediaId: string;
  mediaTitle: string;
  status: DownloadQueueItemStatus;
  progress: number;
  error: string | null;
};

export type DownloadQueueSnapshot = {
  queued: number;
  downloading: number;
  completed: number;
  failed: number;
  items: DownloadQueueItem[];
};

export type DownloadQueueListener = (snapshot: DownloadQueueSnapshot) => void;
