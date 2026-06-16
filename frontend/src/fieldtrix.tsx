import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";

import { configureFieldTrixApi, type FieldTrixApiConfig } from "./api/config";
import { queryClient as defaultQueryClient } from "./services/queryClient";

export type FieldTrixMediaProviderProps = {
  children: ReactNode;
  api?: Partial<FieldTrixApiConfig>;
  queryClient?: QueryClient;
};

export function FieldTrixMediaProvider({
  children,
  api,
  queryClient
}: FieldTrixMediaProviderProps) {
  const resolvedQueryClient = useMemo(() => queryClient ?? defaultQueryClient, [queryClient]);

  useEffect(() => {
    if (api) {
      configureFieldTrixApi(api);
    }
  }, [api]);

  return <QueryClientProvider client={resolvedQueryClient}>{children}</QueryClientProvider>;
}

export { configureFieldTrixApi, type FieldTrixApiConfig } from "./api/config";
export {
  createMedia,
  listMedia,
  requestMediaPlaybackUrl,
  requestMediaUploadUrl,
  type MediaCreate,
  type MediaList,
  type MediaPlaybackUrlResponse,
  type MediaRead,
  type MediaType,
  type MediaUploadUrlRequest,
  type MediaUploadUrlResponse
} from "./api/media";
export { useMediaList } from "./hooks/useMedia";
export { useMediaDownload } from "./hooks/useMediaDownload";
export { useMediaHealth } from "./hooks/useMediaHealth";
export { useMediaSync } from "./hooks/useMediaSync";
export { useMediaUpload } from "./hooks/useMediaUpload";
export { useOfflinePlayback } from "./hooks/useOfflinePlayback";
export { useStorageManager } from "./hooks/useStorageManager";
export { OfflineImageViewer, OfflinePdfViewer, OfflineVideoPlayer } from "./components/media";
export { mediaDownloadManager } from "./services/mediaDownload";
export { mediaHealthService } from "./services/mediaHealth";
export { mediaSyncEngine } from "./services/mediaSync";
export { mediaStorageService } from "./storage/mediaStorageService";
