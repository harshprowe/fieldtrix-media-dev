import { useCallback, useState } from "react";

import type { MediaRead, MediaType } from "../api/media";
import { queryClient } from "../services/queryClient";
import {
  mediaUploadService,
  type MediaUploadProgress
} from "../services/mediaUpload";

export type UploadMediaInput = {
  file: File;
  title: string;
  mediaType?: MediaType;
  version?: number;
};

export type MediaUploadState = {
  upload: (input: UploadMediaInput) => Promise<MediaRead>;
  progress: MediaUploadProgress | null;
  isUploading: boolean;
  error: Error | null;
  uploadedMedia: MediaRead | null;
  reset: () => void;
};

export function useMediaUpload(): MediaUploadState {
  const [progress, setProgress] = useState<MediaUploadProgress | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [uploadedMedia, setUploadedMedia] = useState<MediaRead | null>(null);

  const reset = useCallback(() => {
    setProgress(null);
    setError(null);
    setUploadedMedia(null);
  }, []);

  const upload = useCallback(async (input: UploadMediaInput) => {
    setIsUploading(true);
    setError(null);
    setUploadedMedia(null);

    try {
      const media = await mediaUploadService.upload({
        ...input,
        onProgress: setProgress
      });
      setUploadedMedia(media);
      await queryClient.invalidateQueries({ queryKey: ["media"] });
      return media;
    } catch (uploadError) {
      const normalizedError =
        uploadError instanceof Error ? uploadError : new Error("Unable to upload media");
      setError(normalizedError);
      throw normalizedError;
    } finally {
      setIsUploading(false);
    }
  }, []);

  return {
    upload,
    progress,
    isUploading,
    error,
    uploadedMedia,
    reset
  };
}
