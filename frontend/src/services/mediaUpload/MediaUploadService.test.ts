import { describe, expect, it, vi } from "vitest";

import type { MediaCreate, MediaRead, MediaUploadUrlResponse } from "../../api/media";
import { inferMediaType, MediaUploadError, MediaUploadService } from "./MediaUploadService";

function makeFile(
  name = "training.mp4",
  type = "video/mp4",
  content = "media-bytes"
): File {
  return new File([content], name, { type });
}

function makeUploadResponse(overrides: Partial<MediaUploadUrlResponse> = {}): MediaUploadUrlResponse {
  return {
    media_id: "3ff6c9bb-4b7f-42c7-97e7-5a4266c25fa2",
    version: 1,
    upload_url: "https://r2.example.com/signed",
    object_key: "media/3ff6c9bb-4b7f-42c7-97e7-5a4266c25fa2/v1/training.mp4",
    cdn_url: "https://cdn.example.com/media/3ff6c9bb-4b7f-42c7-97e7-5a4266c25fa2/v1/training.mp4",
    expires_in: 900,
    required_headers: { "Content-Type": "video/mp4" },
    ...overrides
  };
}

function makeMedia(payload: MediaCreate): MediaRead {
  return {
    id: payload.id ?? "3ff6c9bb-4b7f-42c7-97e7-5a4266c25fa2",
    title: payload.title,
    media_type: payload.media_type,
    object_key: payload.object_key,
    cdn_url: payload.cdn_url,
    version: payload.version,
    file_size: payload.file_size,
    created_at: "2026-06-09T00:00:00.000Z",
    updated_at: "2026-06-09T00:00:00.000Z"
  };
}

describe("MediaUploadService", () => {
  it("infers media type from content type and filename", () => {
    expect(inferMediaType("image/png", "asset.png")).toBe("image");
    expect(inferMediaType("video/mp4", "asset.mp4")).toBe("video");
    expect(inferMediaType("audio/mpeg", "asset.mp3")).toBe("audio");
    expect(inferMediaType("", "asset.pdf")).toBe("document");
    expect(inferMediaType("application/octet-stream", "asset.bin")).toBe("other");
  });

  it("uploads directly to R2 before saving backend metadata", async () => {
    const calls: string[] = [];
    const uploadResponse = makeUploadResponse();
    const requestUploadUrl = vi.fn(async () => {
      calls.push("request-upload-url");
      return uploadResponse;
    });
    const uploadFile = vi.fn(async () => {
      calls.push("upload-file");
    });
    const saveMedia = vi.fn(async (payload: MediaCreate) => {
      calls.push("save-media");
      return makeMedia(payload);
    });
    const service = new MediaUploadService({
      requestUploadUrl,
      uploadFile,
      saveMedia
    });

    const result = await service.upload({
      file: makeFile(),
      title: "Training Video"
    });

    expect(calls).toEqual(["request-upload-url", "upload-file", "save-media"]);
    expect(requestUploadUrl).toHaveBeenCalledWith({
      filename: "training.mp4",
      content_type: "video/mp4",
      file_size: 11,
      version: 1
    });
    expect(saveMedia).toHaveBeenCalledWith({
      id: uploadResponse.media_id,
      title: "Training Video",
      media_type: "video",
      object_key: uploadResponse.object_key,
      cdn_url: uploadResponse.cdn_url,
      version: uploadResponse.version,
      file_size: 11,
      content_type: "video/mp4"
    });
    expect(result.title).toBe("Training Video");
  });

  it("rejects metadata save when backend does not return a CDN URL", async () => {
    const service = new MediaUploadService({
      requestUploadUrl: vi.fn(async () => makeUploadResponse({ cdn_url: null })),
      uploadFile: vi.fn(),
      saveMedia: vi.fn()
    });

    await expect(
      service.upload({
        file: makeFile(),
        title: "Training Video"
      })
    ).rejects.toMatchObject({
      code: "missing_cdn_url"
    });
  });

  it("validates title before requesting an upload URL", async () => {
    const requestUploadUrl = vi.fn();
    const service = new MediaUploadService({
      requestUploadUrl,
      uploadFile: vi.fn(),
      saveMedia: vi.fn()
    });

    await expect(
      service.upload({
        file: makeFile(),
        title: " "
      })
    ).rejects.toBeInstanceOf(MediaUploadError);
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });
});
