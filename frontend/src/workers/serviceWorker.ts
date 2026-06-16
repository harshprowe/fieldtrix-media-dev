/// <reference lib="webworker" />

import { clientsClaim, setCacheNameDetails } from "workbox-core";
import { CacheableResponsePlugin } from "workbox-cacheable-response";
import { ExpirationPlugin } from "workbox-expiration";
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { CacheFirst, StaleWhileRevalidate } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

type BackgroundSyncEvent = ExtendableEvent & {
  tag: string;
};

const CACHE_VERSION = "v1";
const CACHE_PREFIX = "fieldtrix";
const APP_SHELL_CACHE = `${CACHE_PREFIX}-precache-${CACHE_VERSION}`;
const APP_ASSET_CACHE = `${CACHE_PREFIX}-app-assets-${CACHE_VERSION}`;
const MEDIA_CACHE = `${CACHE_PREFIX}-media-${CACHE_VERSION}`;
const MEDIA_CHUNK_CACHE = `${CACHE_PREFIX}-media-chunks-${CACHE_VERSION}`;
const ANALYTICS_SYNC_TAG = "fieldtrix-analytics-sync";
const VERSIONED_MEDIA_PATH_PATTERN = /\/v\d+\//;

setCacheNameDetails({
  prefix: CACHE_PREFIX,
  suffix: CACHE_VERSION,
  precache: "precache",
  runtime: "runtime"
});

clientsClaim();

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), {
    denylist: [/^\/api\//]
  })
);

registerRoute(
  ({ request, sameOrigin }) =>
    sameOrigin && ["script", "style", "font", "worker"].includes(request.destination),
  new StaleWhileRevalidate({
    cacheName: APP_ASSET_CACHE,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [200]
      }),
      new ExpirationPlugin({
        maxEntries: 80,
        maxAgeSeconds: 30 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

registerRoute(
  ({ request, url }) => {
    if (!["image", "video", "audio"].includes(request.destination)) {
      return false;
    }
    if (request.headers.has("Range")) {
      return false;
    }

    return !url.pathname.startsWith("/api/") && VERSIONED_MEDIA_PATH_PATTERN.test(url.pathname);
  },
  new CacheFirst({
    cacheName: MEDIA_CACHE,
    plugins: [
      new CacheableResponsePlugin({
        statuses: [0, 200]
      }),
      new ExpirationPlugin({
        maxEntries: 250,
        maxAgeSeconds: 90 * 24 * 60 * 60,
        purgeOnQuotaError: true
      })
    ]
  })
);

self.addEventListener("message", (event) => {
  if (event.data?.type === "FIELDTRIX_APPLY_UPDATE" || event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data?.type === "FIELDTRIX_CLEAR_MEDIA_CACHE") {
    event.waitUntil(Promise.all([caches.delete(MEDIA_CACHE), caches.delete(MEDIA_CHUNK_CACHE)]));
  }
  if (event.data?.type === "FIELDTRIX_CLEAR_APP_CACHE") {
    event.waitUntil(
      Promise.all([caches.delete(APP_SHELL_CACHE), caches.delete(APP_ASSET_CACHE)])
    );
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName.startsWith(`${CACHE_PREFIX}-`))
            .filter((cacheName) => !cacheName.endsWith(CACHE_VERSION))
            .map((cacheName) => caches.delete(cacheName))
        )
      )
  );
});

self.addEventListener("sync", (event: Event) => {
  const syncEvent = event as BackgroundSyncEvent;
  if (syncEvent.tag !== ANALYTICS_SYNC_TAG) {
    return;
  }

  syncEvent.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: "FIELDTRIX_FLUSH_ANALYTICS" });
        }
      })
  );
});
