import { useCallback, useRef } from "react";

import type { MediaRead } from "../api/media";
import { analyticsQueue } from "../services/analytics";
import type { TrackAnalyticsInput } from "../services/analytics";

type PlaybackAnalyticsOptions = {
  media: MediaRead;
  source?: TrackAnalyticsInput["source"];
};

export function usePlaybackAnalytics({ media, source = "unknown" }: PlaybackAnalyticsOptions) {
  const startedAtRef = useRef<number | null>(null);
  const lastPositionRef = useRef<number>(0);
  const hasStartedRef = useRef(false);

  const trackViewed = useCallback(() => {
    void analyticsQueue.track({ media, eventType: "viewed", source });
  }, [media, source]);

  const trackPlaybackStarted = useCallback(
    (positionSeconds: number = 0) => {
      if (hasStartedRef.current) {
        return;
      }
      hasStartedRef.current = true;
      startedAtRef.current = Date.now();
      lastPositionRef.current = positionSeconds;
      void analyticsQueue.track({
        media,
        eventType: "playback_started",
        source,
        playbackPositionSeconds: positionSeconds
      });
    },
    [media, source]
  );

  const trackDurationWatched = useCallback(
    (positionSeconds: number) => {
      const previousPosition = lastPositionRef.current;
      const delta = Math.max(positionSeconds - previousPosition, 0);
      lastPositionRef.current = positionSeconds;

      if (delta <= 0) {
        return;
      }

      void analyticsQueue.track({
        media,
        eventType: "duration_watched",
        source,
        durationSeconds: delta,
        playbackPositionSeconds: positionSeconds
      });
    },
    [media, source]
  );

  const trackPlaybackCompleted = useCallback(
    (positionSeconds: number, durationSeconds?: number) => {
      void analyticsQueue.track({
        media,
        eventType: "playback_completed",
        source,
        durationSeconds: durationSeconds ?? null,
        playbackPositionSeconds: positionSeconds
      });
    },
    [media, source]
  );

  return {
    trackViewed,
    trackPlaybackStarted,
    trackDurationWatched,
    trackPlaybackCompleted
  };
}

