import { useCallback, useRef, useState } from "react";

import {
  mediaSyncEngine,
  type MediaSyncOptions,
  type MediaSyncProgress,
  type MediaSyncStatus,
  type MediaSyncSummary
} from "../services/mediaSync";

type MediaSyncState = {
  status: MediaSyncStatus;
  isSyncing: boolean;
  progress: MediaSyncProgress | null;
  summary: MediaSyncSummary | null;
  error: Error | null;
};

export function useMediaSync() {
  const [state, setState] = useState<MediaSyncState>({
    status: "idle",
    isSyncing: false,
    progress: null,
    summary: null,
    error: null
  });
  const controllerRef = useRef<AbortController | null>(null);

  const startSync = useCallback(async (options: Omit<MediaSyncOptions, "signal" | "onProgress"> = {}) => {
    const controller = new AbortController();
    controllerRef.current = controller;
    setState({ status: "checking", isSyncing: true, progress: null, summary: null, error: null });

    try {
      const summary = await mediaSyncEngine.sync({
        ...options,
        signal: controller.signal,
        onProgress(progress) {
          setState((current) => ({ ...current, status: progress.status, progress }));
        }
      });
      setState((current) => ({ ...current, status: summary.status, isSyncing: false, summary }));
      return summary;
    } catch (error) {
      const nextError = error instanceof Error ? error : new Error("Media sync failed");
      setState((current) => ({ ...current, status: "failed", isSyncing: false, error: nextError }));
      throw nextError;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  const cancelSync = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return {
    ...state,
    startSync,
    cancelSync
  };
}
