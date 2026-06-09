# Analytics System

Analytics are offline-first.

```text
Local Queue -> Background Sync -> FastAPI
```

## Events

Tracked event types:

- `viewed`
- `playback_started`
- `playback_completed`
- `duration_watched`

Each event includes:

- event id
- media id
- media version
- event type
- occurrence timestamp
- duration watched, when applicable
- playback position, when applicable
- playback source: `cache`, `cdn`, or `unknown`
- metadata object

## Local Queue

`AnalyticsQueue` stores events in IndexedDB before any network attempt.

Database:

```text
fieldtrix-analytics
```

Object store:

```text
analytics_events
```

Indexes:

- `by_status`
- `by_queued_at`

## Upload Flow

1. UI or playback hooks call `analyticsQueue.track(...)`.
2. Event is stored locally with `queue_status = pending`.
3. `registerAnalyticsBackgroundSync()` registers the sync tag when supported.
4. Service worker receives the sync event.
5. Service worker notifies open app windows.
6. Window calls `analyticsQueue.flush()`.
7. Queue uploads a batch to `POST /analytics/events`.
8. Accepted events are marked `uploaded`.
9. Failed uploads are returned to `pending` and attempts are incremented.

## Why Upload From The Window

The service worker only signals the page to flush. It does not call FastAPI directly.

Reasons:

- auth token access currently lives in window storage
- API client is already implemented in the app context
- this avoids duplicating auth and error handling inside the worker

## Files

- `frontend/src/api/analytics.ts`
- `frontend/src/services/analytics/AnalyticsQueue.ts`
- `frontend/src/hooks/useAnalyticsQueue.ts`
- `frontend/src/hooks/usePlaybackAnalytics.ts`
- `frontend/src/workers/serviceWorker.ts`
- `frontend/src/workers/registerServiceWorker.ts`

