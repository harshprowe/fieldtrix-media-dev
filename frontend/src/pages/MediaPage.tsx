import { FormEvent, useMemo, useState } from "react";

import type { MediaRead, MediaType } from "../api/media";
import { ErrorState } from "../components/feedback/ErrorState";
import { LoadingState } from "../components/feedback/LoadingState";
import { OfflineImageViewer, OfflinePdfViewer, OfflineVideoPlayer } from "../components/media";
import { getDisplayHealthStatus, useMediaHealth } from "../hooks/useMediaHealth";
import { useMediaList } from "../hooks/useMedia";
import { useMediaDownload } from "../hooks/useMediaDownload";
import { useMediaUpload } from "../hooks/useMediaUpload";
import { useOfflinePlayback } from "../hooks/useOfflinePlayback";
import { useStorageManager } from "../hooks/useStorageManager";
import { MediaHealthStatus } from "../services/mediaHealth";
import { PlaybackSource } from "../services/offlinePlayback";

function formatBytes(bytes: number | null): string {
  if (bytes === null) {
    return "Unavailable";
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

function formatQueueStatus(status: string | undefined): string | null {
  if (!status) {
    return null;
  }
  if (status === "queued") {
    return "Queued";
  }
  if (status === "downloading") {
    return "Downloading";
  }
  if (status === "completed") {
    return "Completed";
  }
  if (status === "failed") {
    return "Failed";
  }
  return null;
}

function formatUploadPhase(phase: string | undefined): string {
  if (phase === "requesting_url") {
    return "Preparing R2 upload";
  }
  if (phase === "uploading_to_r2") {
    return "Uploading to R2";
  }
  if (phase === "saving_metadata") {
    return "Saving metadata";
  }
  if (phase === "completed") {
    return "Upload complete";
  }
  return "Upload";
}

function getSelectedMediaLabel(media: MediaRead): string {
  return `${media.title} v${media.version}`;
}

function AudioPlayer({ media }: { media: MediaRead }) {
  const playback = useOfflinePlayback(media);

  if (playback.isLoading) {
    return <LoadingState label="Preparing audio" />;
  }

  if (playback.error) {
    return <ErrorState title="Audio unavailable" message={playback.error.message} />;
  }

  if (!playback.source) {
    return null;
  }

  return (
    <figure className="media-player">
      <audio src={playback.source.url} controls preload="metadata" />
      {import.meta.env.DEV ? (
        <figcaption>
          Source: {playback.source.playback_source}
          {playback.source.playback_source === PlaybackSource.CACHE
            ? " / Playing offline copy"
            : " / Streaming from CDN"}
        </figcaption>
      ) : null}
    </figure>
  );
}

function MediaPreview({ media }: { media: MediaRead }) {
  if (media.media_type === "video") {
    return <OfflineVideoPlayer media={media} />;
  }
  if (media.media_type === "image") {
    return <OfflineImageViewer media={media} />;
  }
  if (media.media_type === "audio") {
    return <AudioPlayer media={media} />;
  }
  if (media.media_type === "document") {
    return <OfflinePdfViewer media={media} />;
  }

  return (
    <p className="status-message">
      This media type is registered and available from CDN, but inline preview is not supported.
    </p>
  );
}

export function MediaPage() {
  const mediaQuery = useMediaList({ limit: 25, offset: 0 });
  const storage = useStorageManager();
  const download = useMediaDownload();
  const upload = useMediaUpload();
  const media = useMemo(() => mediaQuery.data?.items ?? [], [mediaQuery.data?.items]);
  const mediaHealth = useMediaHealth(media);
  const [selectedMedia, setSelectedMedia] = useState<MediaRead | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState<MediaType | "">("");
  const [version, setVersion] = useState(1);

  async function handleUploadSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) {
      return;
    }

    const uploaded = await upload.upload({
      file: selectedFile,
      title,
      mediaType: mediaType || undefined,
      version
    });
    setSelectedMedia(uploaded);
    setSelectedFile(null);
    setTitle("");
    setMediaType("");
    setVersion(1);
  }

  if (mediaQuery.isLoading) {
    return <LoadingState label="Loading media" />;
  }

  if (mediaQuery.isError) {
    return <ErrorState message={mediaQuery.error.message} />;
  }

  return (
    <section className="page-section">
      <div className="page-heading">
        <h2>Media Library</h2>
        <p>{mediaQuery.data?.total ?? media.length} assets</p>
      </div>
      <form className="upload-panel" onSubmit={(event) => void handleUploadSubmit(event)}>
        <div className="upload-panel-heading">
          <div>
            <h3>Upload media</h3>
            <p>Files upload directly to R2; FastAPI stores metadata only.</p>
          </div>
          <button type="submit" disabled={upload.isUploading || !selectedFile || !title.trim()}>
            {upload.isUploading ? "Uploading" : "Upload"}
          </button>
        </div>
        <div className="upload-grid">
          <label>
            <span>File</span>
            <input
              type="file"
              accept="image/*,video/*,audio/*,application/pdf"
              disabled={upload.isUploading}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setSelectedFile(file);
                if (file && !title.trim()) {
                  setTitle(file.name.replace(/\.[^.]+$/, ""));
                }
              }}
            />
          </label>
          <label>
            <span>Title</span>
            <input
              type="text"
              value={title}
              maxLength={255}
              disabled={upload.isUploading}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Asset title"
            />
          </label>
          <label>
            <span>Type</span>
            <select
              value={mediaType}
              disabled={upload.isUploading}
              onChange={(event) => setMediaType(event.target.value as MediaType | "")}
            >
              <option value="">Auto detect</option>
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
              <option value="document">Document</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label>
            <span>Version</span>
            <input
              type="number"
              min="1"
              step="1"
              value={version}
              disabled={upload.isUploading}
              onChange={(event) => setVersion(Number(event.target.value))}
            />
          </label>
        </div>
        {selectedFile ? (
          <p className="status-message">
            Selected {selectedFile.name} / {formatBytes(selectedFile.size)}
          </p>
        ) : null}
        {upload.progress ? (
          <div className="upload-progress" aria-live="polite">
            <span>{formatUploadPhase(upload.progress.phase)}</span>
            <progress value={upload.progress.progress} max={1} />
            <strong>{Math.round(upload.progress.progress * 100)}%</strong>
          </div>
        ) : null}
        {upload.error ? <p className="status-message error-text">{upload.error.message}</p> : null}
        {upload.uploadedMedia ? (
          <p className="status-message">Uploaded {getSelectedMediaLabel(upload.uploadedMedia)}</p>
        ) : null}
      </form>
      <div className="storage-summary" aria-live="polite">
        <div>
          <span>Offline usage</span>
          <strong>{formatBytes(storage.status?.usage ?? null)}</strong>
        </div>
        <div>
          <span>Available</span>
          <strong>{formatBytes(storage.status?.availableSpace ?? null)}</strong>
        </div>
        <div>
          <span>Offline budget</span>
          <strong>{formatBytes(storage.status?.maxTotalOfflineStorage ?? null)}</strong>
        </div>
        <div>
          <span>Persistent</span>
          <strong>
            {storage.status?.persistent === true
              ? "Enabled"
              : storage.status?.persistent === false
                ? "Not granted"
                : "Unknown"}
          </strong>
        </div>
        <button type="button" onClick={() => void storage.refresh()} disabled={storage.isLoading}>
          Refresh
        </button>
      </div>
      <div className="queue-summary" aria-live="polite">
        <span>Queued: {download.queue.queued}</span>
        <span>Downloading: {download.queue.downloading}</span>
        <span>Completed: {download.queue.completed}</span>
        <span>Failed: {download.queue.failed}</span>
      </div>
      {mediaHealth.error ? (
        <p className="status-message error-text">{mediaHealth.error.message}</p>
      ) : null}
      {download.error ? <p className="status-message error-text">{download.error.message}</p> : null}
      {download.progress ? (
        <p className="status-message">
          {download.progress.status === "checking_storage"
            ? "Checking offline storage"
            : `Download ${Math.round(download.progress.progress * 100)}%`}
        </p>
      ) : null}
      {selectedMedia ? (
        <section className="playback-panel" aria-label={`Preview ${selectedMedia.title}`}>
          <div className="playback-panel-heading">
            <div>
              <h3>{getSelectedMediaLabel(selectedMedia)}</h3>
              <p>{selectedMedia.media_type} / {formatBytes(selectedMedia.file_size)}</p>
            </div>
            <button type="button" onClick={() => setSelectedMedia(null)}>
              Close
            </button>
          </div>
          <MediaPreview media={selectedMedia} />
        </section>
      ) : null}
      {media.length === 0 ? (
        <p className="status-message">No media assets have been registered.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Version</th>
                <th>Size</th>
                <th>Offline</th>
                <th>Playback</th>
              </tr>
            </thead>
            <tbody>
              {media.map((item) => {
                const queueItem = download.queue.items.find(
                  (queuedItem) => queuedItem.mediaId === item.id
                );
                const queueStatus = formatQueueStatus(queueItem?.status);
                return (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.media_type}</td>
                    <td>{item.version}</td>
                    <td>{formatBytes(item.file_size)}</td>
                    <td>
                      <button
                        type="button"
                        onClick={() =>
                          void download
                            .download(item)
                            .then(() => {
                              void storage.refresh();
                              void mediaHealth.refresh();
                            })
                            .catch(() => undefined)
                        }
                        disabled={queueItem?.status === "queued" || queueItem?.status === "downloading"}
                      >
                        Download
                      </button>
                      <span className={`offline-status offline-status-${getDisplayHealthStatus(mediaHealth.healthById[item.id])}`}>
                        {queueStatus ??
                          (getDisplayHealthStatus(mediaHealth.healthById[item.id]) === MediaHealthStatus.DOWNLOADED
                            ? "Downloaded"
                            : getDisplayHealthStatus(mediaHealth.healthById[item.id]) === MediaHealthStatus.STALE
                              ? "Stale"
                          : "Not downloaded")}
                      </span>
                    </td>
                    <td>
                      <button type="button" onClick={() => setSelectedMedia(item)}>
                        Open
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
