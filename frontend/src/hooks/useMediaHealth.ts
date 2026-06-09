import { useCallback, useEffect, useState } from "react";

import type { MediaRead } from "../api/media";
import {
  mediaHealthService,
  MediaHealthStatus,
  type MediaHealthResult
} from "../services/mediaHealth";

export type MediaHealthMap = Record<string, MediaHealthResult>;

export function useMediaHealth(media: MediaRead[]) {
  const [healthById, setHealthById] = useState<MediaHealthMap>({});
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    setIsChecking(true);
    setError(null);
    try {
      const results = await Promise.all(media.map((item) => mediaHealthService.verifyMedia(item.id)));
      const next = Object.fromEntries(results.map((result) => [result.mediaId, result]));
      setHealthById(next);
      return next;
    } catch (unknownError) {
      const nextError =
        unknownError instanceof Error ? unknownError : new Error("Unable to verify media cache");
      setError(nextError);
      throw nextError;
    } finally {
      setIsChecking(false);
    }
  }, [media]);

  useEffect(() => {
    if (media.length === 0) {
      setHealthById({});
      return;
    }
    void refresh().catch(() => undefined);
  }, [media, refresh]);

  return {
    healthById,
    isChecking,
    error,
    refresh
  };
}

export function getDisplayHealthStatus(result: MediaHealthResult | undefined): MediaHealthStatus {
  return result?.status ?? MediaHealthStatus.NOT_DOWNLOADED;
}
