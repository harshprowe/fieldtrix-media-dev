import type { MediaRead } from "../../api/media";
import { PlaybackSource } from "../../services/offlinePlayback";
import { ErrorState } from "../feedback/ErrorState";
import { LoadingState } from "../feedback/LoadingState";
import { useOfflinePlayback } from "../../hooks/useOfflinePlayback";

type OfflineVideoPlayerProps = {
  media: MediaRead;
  controls?: boolean;
  autoPlay?: boolean;
  muted?: boolean;
};

export function OfflineVideoPlayer({
  media,
  controls = true,
  autoPlay = false,
  muted = false
}: OfflineVideoPlayerProps) {
  const playback = useOfflinePlayback(media);

  if (playback.isLoading) {
    return <LoadingState label="Preparing video" />;
  }

  if (playback.error) {
    return <ErrorState title="Video unavailable" message={playback.error.message} />;
  }

  if (!playback.source) {
    return null;
  }

  return (
    <figure className="media-player">
      <video
        src={playback.source.url}
        controls={controls}
        autoPlay={autoPlay}
        muted={muted}
        preload="metadata"
      />
      {import.meta.env.DEV ? (
        <figcaption>
          Source: {playback.source.playback_source}
          {playback.source.playback_source === PlaybackSource.CACHE
            ? " / Playing offline copy"
            : " / Streaming from CDN"}
        </figcaption>
      ) : null}
    </figure>
  );
}
