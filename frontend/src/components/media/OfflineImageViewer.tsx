import type { MediaRead } from "../../api/media";
import { useOfflinePlayback } from "../../hooks/useOfflinePlayback";
import { PlaybackSource } from "../../services/offlinePlayback";
import { ErrorState } from "../feedback/ErrorState";
import { LoadingState } from "../feedback/LoadingState";

type OfflineImageViewerProps = {
  media: MediaRead;
  alt?: string;
};

export function OfflineImageViewer({ media, alt }: OfflineImageViewerProps) {
  const playback = useOfflinePlayback(media);

  if (playback.isLoading) {
    return <LoadingState label="Preparing image" />;
  }

  if (playback.error) {
    return <ErrorState title="Image unavailable" message={playback.error.message} />;
  }

  if (!playback.source) {
    return null;
  }

  return (
    <figure className="media-player">
      <img src={playback.source.url} alt={alt ?? media.title} />
      {import.meta.env.DEV ? (
        <figcaption>
          Source: {playback.source.playback_source}
          {playback.source.playback_source === PlaybackSource.CACHE
            ? " / Loaded from local cache"
            : " / Loaded from CDN"}
        </figcaption>
      ) : null}
    </figure>
  );
}
