import { useCallback, useEffect, useRef, useState } from "react";

import type { MediaRead } from "../api/media";
import {
  downloadQueueService,
  type DownloadQueueSnapshot,
  type MediaDownloadProgress,
  type MediaDownloadResult
} from "../services/mediaDownload";

export type UseMediaDownloadState = {
  progress: MediaDownloadProgress | null;
  result: MediaDownloadResult | null;
  queue: DownloadQueueSnapshot;
  error: Error | null;
  isDownloading: boolean;
};

export function useMediaDownload() {
  const [state, setState] = useState<UseMediaDownloadState>({
    progress: null,
    result: null,
    queue: downloadQueueService.getSnapshot(),
    error: null,
    isDownloading: false
  });

  const controllerRef = useRef<AbortController | null>(null);

  useEffect(
    () =>
      downloadQueueService.subscribe((queue) => {
        setState((current) => ({
          ...current,
          queue,
          isDownloading: queue.downloading > 0 || queue.queued > 0
        }));
      }),
    []
  );

  const download = useCallback(
    async (media: MediaRead) => {
      const controller = new AbortController();
      controllerRef.current = controller;
      setState((current) => ({ ...current, error: null, result: null, isDownloading: true }));
      try {
        const result = await downloadQueueService.enqueue(media, {
          signal: controller.signal,
          onProgress(progress) {
            setState((current) => ({ ...current, progress }));
          }
        });
        setState((current) => ({ ...current, result, isDownloading: false }));
        return result;
      } catch (error) {
        const nextError = error instanceof Error ? error : new Error("Download failed");
        setState((current) => ({ ...current, error: nextError, isDownloading: false }));
        throw nextError;
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
      }
    },
    []
  );

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
  }, []);

  return {
    ...state,
    download,
    cancel,
    clearCompleted: downloadQueueService.clearCompleted.bind(downloadQueueService)
  };
}
