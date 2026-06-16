import { apiRequest } from "./client";

export type MediaType = "image" | "video" | "audio" | "document" | "other";

export type MediaRead = {
  id: string;
  title: string;
  media_type: MediaType;
  version: number;
  file_size: number;
  created_at: string;
  updated_at: string;
};

export type MediaList = {
  items: MediaRead[];
  total: number;
  limit: number;
  offset: number;
};

export type MediaUploadUrlRequest = {
  media_id?: string;
  version?: number;
  filename: string;
  content_type: string;
  file_size: number;
};

export type MediaUploadUrlResponse = {
  media_id: string;
  version: number;
  upload_url: string;
  object_key: string;
  expires_in: number;
  required_headers: Record<string, string>;
};

export type MediaCreate = {
  id?: string;
  title: string;
  media_type: MediaType;
  object_key: string;
  cdn_url?: string | null;
  version: number;
  file_size: number;
  content_type: string;
};

export type MediaPlaybackUrlResponse = {
  media_id: string;
  version: number;
  playback_url: string;
  expires_in: number;
};

export function listMedia(params: { limit?: number; offset?: number } = {}) {
  const searchParams = new URLSearchParams();
  if (params.limit !== undefined) {
    searchParams.set("limit", String(params.limit));
  }
  if (params.offset !== undefined) {
    searchParams.set("offset", String(params.offset));
  }
  const query = searchParams.toString();
  return apiRequest<MediaList>(`/media${query ? `?${query}` : ""}`);
}

export function requestMediaUploadUrl(payload: MediaUploadUrlRequest) {
  return apiRequest<MediaUploadUrlResponse>("/media/upload-url", {
    method: "POST",
    body: payload
  });
}

export function createMedia(payload: MediaCreate) {
  return apiRequest<MediaRead>("/media", {
    method: "POST",
    body: payload
  });
}

export function requestMediaPlaybackUrl(mediaId: string) {
  return apiRequest<MediaPlaybackUrlResponse>(`/media/${mediaId}/playback-url`, {
    method: "POST"
  });
}
