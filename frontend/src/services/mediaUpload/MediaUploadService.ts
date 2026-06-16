import {
  createMedia,
  requestMediaUploadUrl,
  type MediaCreate,
  type MediaRead,
  type MediaType,
  type MediaUploadUrlResponse
} from "../../api/media";

export type MediaUploadProgress = {
  phase: "requesting_url" | "uploading_to_r2" | "saving_metadata" | "completed";
  uploadedBytes: number;
  totalBytes: number;
  progress: number;
};

export type MediaUploadRequest = {
  file: File;
  title: string;
  mediaType?: MediaType;
  version?: number;
  onProgress?: (progress: MediaUploadProgress) => void;
};

type MediaUploadDependencies = {
  requestUploadUrl: typeof requestMediaUploadUrl;
  saveMedia: typeof createMedia;
  uploadFile: typeof uploadFileToSignedUrl;
};

const CONTENT_TYPE_FALLBACK = "application/octet-stream";

export class MediaUploadError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "invalid_file"
      | "invalid_title"
      | "unsupported_type"
      | "r2_upload_failed"
      | "metadata_save_failed"
  ) {
    super(message);
    this.name = "MediaUploadError";
  }
}

export class MediaUploadService {
  private readonly requestUploadUrl: typeof requestMediaUploadUrl;
  private readonly saveMedia: typeof createMedia;
  private readonly uploadFile: typeof uploadFileToSignedUrl;

  constructor(dependencies: Partial<MediaUploadDependencies> = {}) {
    this.requestUploadUrl = dependencies.requestUploadUrl ?? requestMediaUploadUrl;
    this.saveMedia = dependencies.saveMedia ?? createMedia;
    this.uploadFile = dependencies.uploadFile ?? uploadFileToSignedUrl;
  }

  async upload(request: MediaUploadRequest): Promise<MediaRead> {
    const title = request.title.trim();
    const contentType = request.file.type || CONTENT_TYPE_FALLBACK;
    const mediaType = request.mediaType ?? inferMediaType(contentType, request.file.name);
    const version = request.version ?? 1;

    validateRequest({ file: request.file, title, mediaType, version });
    request.onProgress?.(createProgress("requesting_url", 0, request.file.size));

    const upload = await this.requestUploadUrl({
      filename: request.file.name,
      content_type: contentType,
      file_size: request.file.size,
      version
    });

    await this.uploadFile({
      file: request.file,
      upload,
      contentType,
      onProgress: (uploadedBytes) => {
        request.onProgress?.(createProgress("uploading_to_r2", uploadedBytes, request.file.size));
      }
    });

    request.onProgress?.(createProgress("saving_metadata", request.file.size, request.file.size));

    try {
      const payload: MediaCreate = {
        id: upload.media_id,
        title,
        media_type: mediaType,
        object_key: upload.object_key,
        cdn_url: null,
        version: upload.version,
        file_size: request.file.size,
        content_type: contentType
      };
      const media = await this.saveMedia(payload);
      request.onProgress?.(createProgress("completed", request.file.size, request.file.size));
      return media;
    } catch (error) {
      if (error instanceof Error) {
        throw new MediaUploadError(error.message, "metadata_save_failed");
      }
      throw new MediaUploadError("Unable to save media metadata", "metadata_save_failed");
    }
  }
}

export function inferMediaType(contentType: string, filename: string): MediaType {
  const normalizedContentType = contentType.toLowerCase();
  const normalizedFilename = filename.toLowerCase();

  if (normalizedContentType.startsWith("image/")) {
    return "image";
  }
  if (normalizedContentType.startsWith("video/")) {
    return "video";
  }
  if (normalizedContentType.startsWith("audio/")) {
    return "audio";
  }
  if (
    normalizedContentType === "application/pdf" ||
    normalizedFilename.endsWith(".pdf") ||
    normalizedContentType.includes("document")
  ) {
    return "document";
  }
  return "other";
}

function validateRequest(input: {
  file: File;
  title: string;
  mediaType: MediaType;
  version: number;
}): void {
  if (input.file.size <= 0) {
    throw new MediaUploadError("Choose a non-empty media file.", "invalid_file");
  }
  if (!input.title) {
    throw new MediaUploadError("Enter a title for this media asset.", "invalid_title");
  }
  if (input.version < 1 || !Number.isInteger(input.version)) {
    throw new MediaUploadError("Media version must be a positive whole number.", "invalid_file");
  }
  if (!["image", "video", "audio", "document", "other"].includes(input.mediaType)) {
    throw new MediaUploadError("Choose a valid media type.", "unsupported_type");
  }
}

function createProgress(
  phase: MediaUploadProgress["phase"],
  uploadedBytes: number,
  totalBytes: number
): MediaUploadProgress {
  return {
    phase,
    uploadedBytes,
    totalBytes,
    progress: totalBytes > 0 ? Math.min(uploadedBytes / totalBytes, 1) : 0
  };
}

async function uploadFileToSignedUrl(input: {
  file: File;
  upload: MediaUploadUrlResponse;
  contentType: string;
  onProgress: (uploadedBytes: number) => void;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", input.upload.upload_url);

    const headers = {
      ...input.upload.required_headers,
      "Content-Type": input.contentType
    };
    Object.entries(headers).forEach(([name, value]) => {
      xhr.setRequestHeader(name, value);
    });

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        input.onProgress(event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress(input.file.size);
        resolve();
        return;
      }
      reject(new MediaUploadError(`R2 upload failed with status ${xhr.status}`, "r2_upload_failed"));
    };
    xhr.onerror = () => {
      reject(new MediaUploadError("R2 upload failed. Check bucket CORS and network access.", "r2_upload_failed"));
    };
    xhr.send(input.file);
  });
}

export const mediaUploadService = new MediaUploadService();
