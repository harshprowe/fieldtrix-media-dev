import { registerSW } from "virtual:pwa-register";

import { env } from "../services/env";
import { analyticsQueue } from "../services/analytics";

const UPDATE_AVAILABLE_EVENT = "fieldtrix:service-worker-update-available";
const ANALYTICS_SYNC_TAG = "fieldtrix-analytics-sync";
let applyServiceWorkerUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;

export function registerServiceWorker(): void {
  if (!env.enablePwa) {
    return;
  }

  applyServiceWorkerUpdate = registerSW({
    immediate: true,
    onNeedRefresh() {
      window.dispatchEvent(new CustomEvent(UPDATE_AVAILABLE_EVENT));
    },
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent("fieldtrix:offline-ready"));
    },
    onRegisteredSW(_, registration) {
      setInterval(
        () => {
          void registration?.update();
        },
        60 * 60 * 1000
      );
    }
  });

  navigator.serviceWorker.addEventListener("message", (event) => {
    if (event.data?.type === "FIELDTRIX_FLUSH_ANALYTICS") {
      void analyticsQueue.flush();
    }
  });
}

export async function activatePendingServiceWorkerUpdate(): Promise<void> {
  await applyServiceWorkerUpdate?.(true);
}

export function clearMediaCache(): void {
  navigator.serviceWorker.controller?.postMessage({ type: "FIELDTRIX_CLEAR_MEDIA_CACHE" });
}

export function clearApplicationCache(): void {
  navigator.serviceWorker.controller?.postMessage({ type: "FIELDTRIX_CLEAR_APP_CACHE" });
}

export async function registerAnalyticsBackgroundSync(): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const syncRegistration = registration as ServiceWorkerRegistration & {
    sync?: {
      register: (tag: string) => Promise<void>;
    };
  };

  if (syncRegistration.sync) {
    await syncRegistration.sync.register(ANALYTICS_SYNC_TAG);
    return;
  }

  if (navigator.onLine) {
    await analyticsQueue.flush();
  }
}
