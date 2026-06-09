import type { MediaRead } from "../../api/media";
import { useOfflinePlayback } from "../../hooks/useOfflinePlayback";
import { PlaybackSource } from "../../services/offlinePlayback";
import { ErrorState } from "../feedback/ErrorState";
import { LoadingState } from "../feedback/LoadingState";

type OfflinePdfViewerProps = {
  media: MediaRead;
  title?: string;
};

export function OfflinePdfViewer({ media, title }: OfflinePdfViewerProps) {
  const playback = useOfflinePlayback(media);

  if (playback.isLoading) {
    return <LoadingState label="Preparing document" />;
  }

  if (playback.error) {
    return <ErrorState title="Document unavailable" message={playback.error.message} />;
  }

  if (!playback.source) {
    return null;
  }

  return (
    <figure className="media-player media-player-pdf">
      <iframe src={playback.source.url} title={title ?? media.title} />
      {import.meta.env.DEV ? (
        <figcaption>
          Source: {playback.source.playback_source}
          {playback.source.playback_source === PlaybackSource.CACHE
            ? " / Viewing offline document"
            : " / Viewing from CDN"}
        </figcaption>
      ) : null}
    </figure>
  );
}
