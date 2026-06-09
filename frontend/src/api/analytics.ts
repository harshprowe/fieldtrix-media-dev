import { apiRequest } from "./client";

export type AnalyticsEventType =
  | "viewed"
  | "playback_started"
  | "playback_completed"
  | "duration_watched";

export type AnalyticsEventPayload = {
  id: string;
  media_id: string;
  media_version: number;
  event_type: AnalyticsEventType;
  occurred_at: string;
  duration_seconds: number | null;
  playback_position_seconds: number | null;
  source: "cache" | "cdn" | "unknown";
  metadata: Record<string, string | number | boolean | null>;
};

export type AnalyticsBatchRequest = {
  events: AnalyticsEventPayload[];
};

export type AnalyticsBatchResponse = {
  accepted: number;
};

export function uploadAnalyticsBatch(payload: AnalyticsBatchRequest) {
  return apiRequest<AnalyticsBatchResponse>("/analytics/events", {
    method: "POST",
    body: payload
  });
}

