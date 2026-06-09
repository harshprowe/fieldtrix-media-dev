# Media Sync Engine

`MediaSyncEngine` synchronizes server media metadata with local browser state.

```text
GET /media -> compare server version with IndexedDB version
           -> remove old Cache API entry when versions differ
           -> remove old IndexedDB metadata when versions differ
           -> download the latest immutable media version
```

## Architecture

Main files:

- `frontend/src/services/mediaSync/types.ts`
- `frontend/src/services/mediaSync/MediaSyncEngine.ts`
- `frontend/src/hooks/useMediaSync.ts`

Dependencies:

- API: `GET /media`
- Local metadata: `MediaStorageService`
- Local media bytes: `DownloadQueueService`

## Version Comparison

For each server media record:

- missing local record: save metadata as `created`
- matching `local.version === server.version`: save latest metadata and mark `unchanged`
- mismatched version: delete cached local media, delete local metadata, download latest version
- duplicate `media_id + server_version` records in the same sync pass: skip duplicate download

## Efficiency

- uses paginated `GET /media` requests
- default page size is `100`
- bounded per-page concurrency defaults to `3`
- emits lifecycle status: `idle`, `checking`, `downloading`, `completed`, `failed`
- supports cancellation with `AbortSignal`

This avoids loading thousands of records into memory at once and avoids unbounded concurrent downloads.

## Redownload Strategy

Changed versions are always redownloaded. The old local version is removed before the new download starts:

1. stale cached media is deleted
2. old IndexedDB metadata is deleted
3. `DownloadQueueService.download()` downloads the current CDN asset
4. the download manager stores fresh metadata for the new immutable version

This prevents stale metadata or stale Cache API entries from surviving a failed version transition.
