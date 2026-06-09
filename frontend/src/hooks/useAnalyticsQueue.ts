import { useCallback } from "react";

import type { MediaRead } from "../api/media";
import { analyticsQueue } from "../services/analytics";
import type { TrackAnalyticsInput } from "../services/analytics";
import { registerAnalyticsBackgroundSync } from "../workers/registerServiceWorker";

export function useAnalyticsQueue() {
  const track = useCallback((input: TrackAnalyticsInput) => analyticsQueue.track(input), []);

  const trackAndScheduleSync = useCallback(async (input: TrackAnalyticsInput) => {
    const result = await analyticsQueue.track(input);
    await registerAnalyticsBackgroundSync();
    return result;
  }, []);

  const flush = useCallback((batchSize?: number) => analyticsQueue.flush(batchSize), []);

  const trackViewed = useCallback(
    (media: MediaRead, source: TrackAnalyticsInput["source"] = "unknown") =>
      analyticsQueue.track({ media, eventType: "viewed", source }),
    []
  );

  return {
    track,
    trackAndScheduleSync,
    flush,
    trackViewed
  };
}
