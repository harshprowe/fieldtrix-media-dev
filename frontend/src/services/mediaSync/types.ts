import type { MediaRead } from "../../api/media";
import type { StorageResult, StoredMediaMetadata } from "../../storage/mediaStorageService";

export type MediaSyncAction = "created" | "unchanged" | "updated" | "redownloaded" | "failed";

export type MediaSyncStatus = "idle" | "checking" | "downloading" | "completed" | "failed";

export type MediaSyncRecordResult = {
  mediaId: string;
  title: string;
  localVersion: number | null;
  serverVersion: number;
  action: MediaSyncAction;
  error: string | null;
};

export type MediaSyncProgress = {
  status: MediaSyncStatus;
  scanned: number;
  total: number | null;
  created: number;
  updated: number;
  unchanged: number;
  redownloaded: number;
  failed: number;
};

export type MediaSyncOptions = {
  pageSize?: number;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (progress: MediaSyncProgress) => void;
  onRecord?: (record: MediaSyncRecordResult) => void;
};

export type MediaSyncSummary = MediaSyncProgress & {
  records: MediaSyncRecordResult[];
};

export type MediaListPage = {
  items: MediaRead[];
  total: number;
  limit: number;
  offset: number;
};

export interface MediaSyncApiPort {
  listMedia(params: { limit: number; offset: number }): Promise<MediaListPage>;
}

export interface MediaSyncStoragePort {
  getMediaMetadata(mediaId: string): Promise<StorageResult<StoredMediaMetadata | null>>;
  saveMediaMetadata(media: MediaRead): Promise<StorageResult<unknown>>;
  deleteMediaMetadata(mediaId: string): Promise<StorageResult<void>>;
}

export interface MediaSyncDownloadPort {
  download(media: MediaRead, options?: { signal?: AbortSignal }): Promise<unknown>;
  deleteCachedMedia(media: MediaRead): Promise<void>;
}
