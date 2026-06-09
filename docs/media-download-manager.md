# Media Download Manager

The media download path has no backend involvement.

```text
CDN -> Browser Download Manager -> Cache Storage -> IndexedDB Metadata
```

## Responsibilities

- downloads media from `cdn_url`
- tracks byte progress
- resumes interrupted downloads when byte-range chunks already exist
- stores completed media in Cache Storage
- stores metadata and download state in IndexedDB
- checks browser storage quota before starting

## Cache Layout

Final media cache:

```text
fieldtrix-media-v1
```

Partial chunk cache:

```text
fieldtrix-media-chunks-v1
```

The final cache is what playback and offline reads should use. The chunk cache is temporary working storage for resumable downloads.

## Resume Strategy

The Cache API stores complete `Response` objects. It does not expose a reliable way to keep a partially written response after a network interruption.

To support resume:

1. The manager downloads CDN media as byte ranges.
2. Each completed range is saved as a separate cached response.
3. If a download is interrupted, completed chunks remain in `fieldtrix-media-chunks-v1`.
4. A later download skips cached chunks and fetches only missing ranges.
5. Once every chunk exists, the manager assembles a final cached response in `fieldtrix-media-v1`.
6. Chunk entries are deleted after final assembly.

If the CDN does not support byte ranges and returns `200`, the manager falls back to a full download. That path cannot resume mid-file because no partial response is durable.

## Large Video Support

- default chunk size is 8 MB
- progress is updated after each chunk
- metadata progress is persisted in IndexedDB
- quota is checked through `navigator.storage.estimate()`
- quota errors during cache writes are converted into `MediaDownloadError`

## IndexedDB Metadata

`MediaStorageService` stores:

- `download_status`
- `download_progress`
- `downloaded_bytes`
- `downloaded_at`
- `download_error`
- version history

## Public API

Main files:

- `frontend/src/services/mediaDownload/types.ts`
- `frontend/src/services/mediaDownload/MediaDownloadManager.ts`
- `frontend/src/hooks/useMediaDownload.ts`

