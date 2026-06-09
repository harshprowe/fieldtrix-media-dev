# Offline Playback Service

Playback has no backend involvement.

```text
Media selected -> Cache Storage lookup -> Blob URL playback
                                 |
                                 +-> CDN fallback
```

## Behavior

1. `OfflinePlaybackService.resolvePlaybackSource(media)` opens `fieldtrix-media-v1`.
2. It checks for a cached response using `media.cdn_url` as the cache key.
3. If found, it converts the cached response to a `Blob`.
4. It creates a local `blob:` URL and returns it for playback.
5. If not found, it returns `media.cdn_url`.

## Components

- `OfflineVideoPlayer`: renders cached/CDN video.
- `OfflineImageViewer`: renders cached/CDN image.
- `OfflinePdfViewer`: renders cached/CDN PDF in an iframe.

## Hook

`useOfflinePlayback(media)` resolves the playback source and revokes cached blob URLs when the selected media changes or the component unmounts.

## Debug Logging

The service logs:

- cache lookup start
- cache hit
- cache miss
- CDN fallback
- blob URL creation
- blob URL revocation
- cache read failures

## Safety

- The service imports media API types only.
- It does not call the backend API client.
- It does not fetch FastAPI endpoints.
- CDN fallback uses the media record's `cdn_url` directly.

