import { deleteDB, openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction } from "idb";

import type { MediaRead } from "../api/media";

const DEFAULT_DB_NAME = "fieldtrix-media";
const DB_VERSION = 2;

export type DownloadStatus =
  | "not_started"
  | "queued"
  | "downloading"
  | "downloaded"
  | "stale"
  | "failed";

export type StoredMediaMetadata = MediaRead & {
  download_status: DownloadStatus;
  download_progress: number;
  downloaded_bytes: number;
  last_synced_at: string;
  downloaded_at: string | null;
  download_error: string | null;
};

export type MediaVersionRecord = {
  key: string;
  media_id: string;
  version: number;
  file_size: number;
  recorded_at: string;
};

export type StorageFailure = {
  code: "indexeddb_unavailable" | "operation_failed" | "not_found";
  message: string;
};

export type StorageResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: StorageFailure;
    };

type DownloadStatusUpdate = {
  status: DownloadStatus;
  progress?: number;
  downloadedBytes?: number;
  downloadedAt?: string | null;
  error?: string | null;
};

interface FieldTrixMediaDB extends DBSchema {
  media_metadata: {
    key: string;
    value: StoredMediaMetadata;
    indexes: {
      by_download_status: DownloadStatus;
      by_updated_at: string;
    };
  };
  media_versions: {
    key: string;
    value: MediaVersionRecord;
    indexes: {
      by_media_id: string;
    };
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function versionKey(mediaId: string, version: number): string {
  return `${mediaId}:${version}`;
}

function toFailure(error: unknown, fallback: string): StorageFailure {
  if (error instanceof Error) {
    if (error.message === "IndexedDB is not available in this environment") {
      return {
        code: "indexeddb_unavailable",
        message: error.message
      };
    }

    return {
      code: "operation_failed",
      message: error.message
    };
  }

  return {
    code: "operation_failed",
    message: fallback
  };
}

export class MediaStorageService {
  private databasePromise: Promise<IDBPDatabase<FieldTrixMediaDB>> | null = null;

  constructor(private readonly databaseName: string = DEFAULT_DB_NAME) {}

  async saveMediaMetadata(metadata: MediaRead): Promise<StorageResult<StoredMediaMetadata>> {
    try {
      const db = await this.getDatabase();
      const existing = await db.get("media_metadata", metadata.id);
      const isSameVersion = existing?.version === metadata.version;
      const timestamp = nowIso();
      const stored: StoredMediaMetadata = {
        ...metadata,
        download_status: isSameVersion && existing ? existing.download_status : "not_started",
        download_progress: isSameVersion && existing ? existing.download_progress : 0,
        downloaded_bytes: isSameVersion && existing ? existing.downloaded_bytes : 0,
        downloaded_at: isSameVersion && existing ? existing.downloaded_at : null,
        download_error: isSameVersion && existing ? existing.download_error : null,
        last_synced_at: timestamp
      };

      const transaction = db.transaction(["media_metadata", "media_versions"], "readwrite");
      await transaction.objectStore("media_metadata").put(stored);
      await transaction.objectStore("media_versions").put({
        key: versionKey(metadata.id, metadata.version),
        media_id: metadata.id,
        version: metadata.version,
        file_size: metadata.file_size,
        recorded_at: timestamp
      });
      await transaction.done;

      return { ok: true, data: stored };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to save media metadata") };
    }
  }

  async getMediaMetadata(mediaId: string): Promise<StorageResult<StoredMediaMetadata | null>> {
    try {
      const db = await this.getDatabase();
      const metadata = await db.get("media_metadata", mediaId);
      return { ok: true, data: metadata ?? null };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to retrieve media metadata") };
    }
  }

  async listMediaMetadata(): Promise<StorageResult<StoredMediaMetadata[]>> {
    try {
      const db = await this.getDatabase();
      const items = await db.getAllFromIndex("media_metadata", "by_updated_at");
      return { ok: true, data: items.reverse() };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to list media metadata") };
    }
  }

  async deleteMediaMetadata(mediaId: string): Promise<StorageResult<void>> {
    try {
      const db = await this.getDatabase();
      const transaction = db.transaction(["media_metadata", "media_versions"], "readwrite");
      await transaction.objectStore("media_metadata").delete(mediaId);

      const versionIndex = transaction.objectStore("media_versions").index("by_media_id");
      let cursor = await versionIndex.openCursor(mediaId);
      while (cursor) {
        await cursor.delete();
        cursor = await cursor.continue();
      }

      await transaction.done;
      return { ok: true, data: undefined };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to delete media metadata") };
    }
  }

  async getVersionHistory(mediaId: string): Promise<StorageResult<MediaVersionRecord[]>> {
    try {
      const db = await this.getDatabase();
      const versions = await db.getAllFromIndex("media_versions", "by_media_id", mediaId);
      versions.sort((left, right) => right.version - left.version);
      return { ok: true, data: versions };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to retrieve media version history") };
    }
  }

  async updateDownloadStatus(
    mediaId: string,
    update: DownloadStatusUpdate
  ): Promise<StorageResult<StoredMediaMetadata>> {
    try {
      const db = await this.getDatabase();
      const existing = await db.get("media_metadata", mediaId);
      if (!existing) {
        return {
          ok: false,
          error: {
            code: "not_found",
            message: "Media metadata was not found"
          }
        };
      }

      const next: StoredMediaMetadata = {
        ...existing,
        download_status: update.status,
        download_progress:
          update.progress === undefined
            ? update.status === "downloaded"
              ? 1
              : existing.download_progress
            : update.progress,
        downloaded_bytes:
          update.downloadedBytes === undefined ? existing.downloaded_bytes : update.downloadedBytes,
        downloaded_at:
          update.downloadedAt === undefined
            ? update.status === "downloaded"
              ? nowIso()
              : existing.downloaded_at
            : update.downloadedAt,
        download_error:
          update.error === undefined
            ? update.status === "failed"
              ? existing.download_error
              : null
            : update.error
      };

      await db.put("media_metadata", next);
      return { ok: true, data: next };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to update download status") };
    }
  }

  async listByDownloadStatus(
    status: DownloadStatus
  ): Promise<StorageResult<StoredMediaMetadata[]>> {
    try {
      const db = await this.getDatabase();
      const items = await db.getAllFromIndex("media_metadata", "by_download_status", status);
      return { ok: true, data: items };
    } catch (error) {
      return { ok: false, error: toFailure(error, "Unable to list media by download status") };
    }
  }

  async clearForTests(): Promise<void> {
    const database = await this.databasePromise;
    database?.close();
    this.databasePromise = null;
    await deleteDB(this.databaseName);
  }

  private async getDatabase(): Promise<IDBPDatabase<FieldTrixMediaDB>> {
    if (!("indexedDB" in globalThis)) {
      throw new Error("IndexedDB is not available in this environment");
    }

    this.databasePromise ??= openDB<FieldTrixMediaDB>(this.databaseName, DB_VERSION, {
      async upgrade(database, oldVersion, _newVersion, transaction) {
        if (!database.objectStoreNames.contains("media_metadata")) {
          const mediaStore = database.createObjectStore("media_metadata", { keyPath: "id" });
          mediaStore.createIndex("by_download_status", "download_status");
          mediaStore.createIndex("by_updated_at", "updated_at");
        }

        if (!database.objectStoreNames.contains("media_versions")) {
          const versionsStore = database.createObjectStore("media_versions", { keyPath: "key" });
          versionsStore.createIndex("by_media_id", "media_id");
        }

        if (oldVersion < 2) {
          await removeSensitiveUrlFields(transaction);
        }
      }
    });

    return this.databasePromise;
  }
}

export const mediaStorageService = new MediaStorageService();

async function removeSensitiveUrlFields(
  transaction: IDBPTransaction<FieldTrixMediaDB, ["media_metadata", "media_versions"], "versionchange">
): Promise<void> {
  const metadataStore = transaction.objectStore("media_metadata");
  let metadataCursor = await metadataStore.openCursor();
  while (metadataCursor) {
    const nextValue = { ...metadataCursor.value } as StoredMediaMetadata & Record<string, unknown>;
    delete nextValue.cdn_url;
    delete nextValue.object_key;
    await metadataCursor.update(nextValue);
    metadataCursor = await metadataCursor.continue();
  }

  const versionsStore = transaction.objectStore("media_versions");
  let versionCursor = await versionsStore.openCursor();
  while (versionCursor) {
    const nextValue = { ...versionCursor.value } as MediaVersionRecord & Record<string, unknown>;
    delete nextValue.cdn_url;
    delete nextValue.object_key;
    await versionCursor.update(nextValue);
    versionCursor = await versionCursor.continue();
  }
}
