import type { MediaRead } from "../api/media";

const CACHE_ORIGIN = "https://fieldtrix.local";
const CACHE_PATH_PREFIX = "/__fieldtrix_media_cache__";

export function getMediaVersionIdentity(media: Pick<MediaRead, "id" | "version">): string {
  return `${media.id}:v${media.version}`;
}

export function getVersionedMediaCacheKey(
  media: Pick<MediaRead, "id" | "version">
): string {
  return new URL(
    `${CACHE_PATH_PREFIX}/${encodeURIComponent(media.id)}/v${media.version}`,
    CACHE_ORIGIN
  ).toString();
}

export function getVersionedMediaChunkCacheKey(
  media: Pick<MediaRead, "id" | "version">,
  start: number,
  end: number
): string {
  const url = new URL(getVersionedMediaCacheKey(media));
  url.searchParams.set("range", `${start}-${end}`);
  return url.toString();
}
