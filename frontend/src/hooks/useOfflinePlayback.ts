import { useEffect, useState } from "react";

import type { MediaRead } from "../api/media";
import {
  offlinePlaybackService,
  type ResolvedPlaybackSource
} from "../services/offlinePlayback";

export type OfflinePlaybackState = {
  source: ResolvedPlaybackSource | null;
  isLoading: boolean;
  error: Error | null;
};

export function useOfflinePlayback(media: MediaRead | null): OfflinePlaybackState {
  const [state, setState] = useState<OfflinePlaybackState>({
    source: null,
    isLoading: false,
    error: null
  });

  useEffect(() => {
    let isActive = true;
    let sourceToRevoke: ResolvedPlaybackSource | null = null;

    if (!media) {
      setState({ source: null, isLoading: false, error: null });
      return () => undefined;
    }

    setState({ source: null, isLoading: true, error: null });

    offlinePlaybackService
      .resolvePlaybackSource(media)
      .then((source) => {
        if (!isActive) {
          source.revoke();
          return;
        }
        sourceToRevoke = source;
        setState({ source, isLoading: false, error: null });
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }
        setState({
          source: null,
          isLoading: false,
          error: error instanceof Error ? error : new Error("Unable to prepare playback")
        });
      });

    return () => {
      isActive = false;
      sourceToRevoke?.revoke();
    };
  }, [media]);

  return state;
}
