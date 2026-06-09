import type { AnalyticsEventPayload, AnalyticsEventType } from "../../api/analytics";
import type { MediaRead } from "../../api/media";

export type AnalyticsQueueStatus = "pending" | "uploading" | "uploaded" | "failed";

export type AnalyticsQueueEvent = AnalyticsEventPayload & {
  queue_status: AnalyticsQueueStatus;
  attempts: number;
  last_error: string | null;
  queued_at: string;
  updated_at: string;
};

export type TrackAnalyticsInput = {
  media: MediaRead;
  eventType: AnalyticsEventType;
  durationSeconds?: number | null;
  playbackPositionSeconds?: number | null;
  source?: "cache" | "cdn" | "unknown";
  metadata?: Record<string, string | number | boolean | null>;
};

export type AnalyticsQueueResult<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export type AnalyticsFlushSummary = {
  uploaded: number;
  failed: number;
  remaining: number;
};

export type AnalyticsQueueMetrics = {
  totalEvents: number;
  oldestEventAgeMs: number | null;
  droppedEvents: number;
};

export interface AnalyticsApiPort {
  uploadBatch(payload: { events: AnalyticsEventPayload[] }): Promise<{ accepted: number }>;
}

export interface AnalyticsQueuePort {
  track(input: TrackAnalyticsInput): Promise<AnalyticsQueueResult<AnalyticsQueueEvent>>;
  flush(batchSize?: number): Promise<AnalyticsQueueResult<AnalyticsFlushSummary>>;
  listPending(limit?: number): Promise<AnalyticsQueueResult<AnalyticsQueueEvent[]>>;
  getMetrics(): Promise<AnalyticsQueueResult<AnalyticsQueueMetrics>>;
}
