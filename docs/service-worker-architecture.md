# Service Worker Architecture

FieldTrix uses a custom Workbox service worker through `vite-plugin-pwa` `injectManifest`. Vite injects the build manifest, while the application owns runtime caching behavior.

## Cache Groups

### Application Shell Cache

Cache name:

```text
fieldtrix-precache-v1
```

Purpose:

- caches `index.html`
- caches hashed build assets
- supports navigation fallback for offline app access

Strategy:

- Workbox precache
- navigation requests return `/index.html`
- API routes are excluded from navigation fallback

Reasoning:

- Vite produces content-hashed assets, so precaching is safe and deterministic.
- The app shell must be available offline even when API requests fail.
- API responses are not cached here because authenticated server data needs an explicit data safety strategy.

### Application Asset Runtime Cache

Cache name:

```text
fieldtrix-app-assets-v1
```

Purpose:

- caches same-origin scripts, styles, fonts, and workers requested at runtime

Strategy:

- `StaleWhileRevalidate`
- max 80 entries
- max age 30 days
- purge on quota pressure

Reasoning:

- These assets are safe to reuse briefly.
- Revalidation keeps the app reasonably fresh without making startup fragile offline.

### Media Cache

Cache name:

```text
fieldtrix-media-v1
```

Partial chunk cache:

```text
fieldtrix-media-chunks-v1
```

Purpose:

- caches image, video, and audio responses separately from application assets
- clears partial chunk entries alongside final media entries
- excludes byte-range requests so resumable downloads are handled by `MediaDownloadManager`

Strategy:

- `CacheFirst`
- cacheable statuses: `0`, `200`
- max 250 entries
- max age 90 days
- purge on quota pressure

Reasoning:

- Media is usually large and should not compete with application shell entries.
- A media-first cache supports offline playback/viewing after a successful fetch.
- Status `0` allows opaque CDN responses to be cached when CORS headers are unavailable.

## Update Strategy

The service worker does not force updates silently.

Flow:

1. `registerServiceWorker()` registers the worker.
2. Workbox detects a waiting update.
3. The app dispatches `fieldtrix:service-worker-update-available`.
4. UI can call `activatePendingServiceWorkerUpdate()`.
5. The waiting service worker activates and the page reloads.

Reasoning:

- Users should not lose in-progress upload or offline-sync work because of an automatic reload.
- The app still checks for updates every hour through `registration.update()`.

## Cache Invalidation Strategy

Versioned cache names use:

```text
fieldtrix-*-v1
```

On activation:

- current-version caches are preserved
- older `fieldtrix-*` caches are deleted

Manual invalidation helpers:

- `clearMediaCache()` sends `FIELDTRIX_CLEAR_MEDIA_CACHE`
- `clearApplicationCache()` sends `FIELDTRIX_CLEAR_APP_CACHE`

Reasoning:

- Versioned names make releases predictable.
- App and media invalidation are separate because media can be much larger and may need user-controlled cleanup.
- Manual cache clear hooks give future settings screens and storage-pressure handlers a stable API.

## Files

- `frontend/src/workers/serviceWorker.ts`: Workbox service worker and cache strategies.
- `frontend/src/workers/registerServiceWorker.ts`: registration, update notifications, and cache-clear messages.
- `frontend/vite.config.ts`: `injectManifest` PWA configuration.
