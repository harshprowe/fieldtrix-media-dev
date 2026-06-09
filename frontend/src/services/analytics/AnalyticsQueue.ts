import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";

import { uploadAnalyticsBatch } from "../../api/analytics";
import type { AnalyticsEventPayload } from "../../api/analytics";
import type {
  AnalyticsApiPort,
  AnalyticsFlushSummary,
  AnalyticsQueueEvent,
  AnalyticsQueueMetrics,
  AnalyticsQueueResult,
  TrackAnalyticsInput
} from "./types";

const DEFAULT_DB_NAME = "fieldtrix-analytics";
const DB_VERSION = 2;
const DEFAULT_BATCH_SIZE = 50;
const MAX_EVENTS = 1000;
const MAX_EVENT_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DROPPED_EVENTS_KEY = "dropped_events";

interface FieldTrixAnalyticsDB extends DBSchema {
  analytics_events: {
    key: string;
    value: AnalyticsQueueEvent;
    indexes: {
      by_status: string;
      by_queued_at: string;
    };
  };
  analytics_metrics: {
    key: string;
    value: {
      key: string;
      value: number;
    };
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function timestampMs(value: string): number {
  return new Date(value).getTime();
}

function toFailure(error: unknown, fallback: string): AnalyticsQueueResult<never> {
  return {
    ok: false,
    error: {
      message: error instanceof Error ? error.message : fallback
    }
  };
}

function createEventId(): string {
  if ("crypto" in globalThis && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

class DefaultAnalyticsApi implements AnalyticsApiPort {
  async uploadBatch(payload: { events: AnalyticsEventPayload[] }): Promise<{ accepted: number }> {
    return uploadAnalyticsBatch(payload);
  }
}

export class AnalyticsQueue {
  private databasePromise: Promise<IDBPDatabase<FieldTrixAnalyticsDB>> | null = null;

  constructor(
    private readonly databaseName: string = DEFAULT_DB_NAME,
    private readonly api: AnalyticsApiPort = new DefaultAnalyticsApi()
  ) {}

  async track(input: TrackAnalyticsInput): Promise<AnalyticsQueueResult<AnalyticsQueueEvent>> {
    try {
      const timestamp = nowIso();
      const event: AnalyticsQueueEvent = {
        id: createEventId(),
        media_id: input.media.id,
        media_version: input.media.version,
        event_type: input.eventType,
        occurred_at: timestamp,
        duration_seconds: input.durationSeconds ?? null,
        playback_position_seconds: input.playbackPositionSeconds ?? null,
        source: input.source ?? "unknown",
        metadata: input.metadata ?? {},
        queue_status: "pending",
        attempts: 0,
        last_error: null,
        queued_at: timestamp,
        updated_at: timestamp
      };

      const db = await this.getDatabase();
      const coalesced = await this.coalesceDurationEvent(db, event);
      await this.enforceQueueProtection(db);
      return { ok: true, data: coalesced };
    } catch (error) {
      return toFailure(error, "Unable to queue analytics event");
    }
  }

  async listPending(limit: number = DEFAULT_BATCH_SIZE): Promise<AnalyticsQueueResult<AnalyticsQueueEvent[]>> {
    try {
      const db = await this.getDatabase();
      await this.enforceQueueProtection(db);
      const pending = await db.getAllFromIndex("analytics_events", "by_status", "pending");
      pending.sort((left, right) => left.queued_at.localeCompare(right.queued_at));
      return { ok: true, data: pending.slice(0, limit) };
    } catch (error) {
      return toFailure(error, "Unable to read pending analytics events");
    }
  }

  async flush(batchSize: number = DEFAULT_BATCH_SIZE): Promise<AnalyticsQueueResult<AnalyticsFlushSummary>> {
    try {
      const pendingResult = await this.listPending(batchSize);
      if (!pendingResult.ok) {
        return pendingResult;
      }

      const pending = pendingResult.data;
      if (pending.length === 0) {
        return { ok: true, data: { uploaded: 0, failed: 0, remaining: 0 } };
      }

      await this.markUploading(pending);

      let uploaded = 0;
      let failed = 0;
      try {
        const payloadEvents = pending.map(this.toPayload);
        const response = await this.api.uploadBatch({ events: payloadEvents });
        uploaded = response.accepted;
        failed = pending.length - response.accepted;
        await this.markUploaded(pending.slice(0, response.accepted));
        if (response.accepted < pending.length) {
          await this.markFailed(
            pending.slice(response.accepted),
            "Analytics endpoint accepted a partial batch"
          );
        }
      } catch (error) {
        failed = pending.length;
        await this.markFailed(pending, error instanceof Error ? error.message : "Upload failed");
      }

      const remaining = await this.listPending(batchSize);
      return {
        ok: true,
        data: {
          uploaded,
          failed,
          remaining: remaining.ok ? remaining.data.length : 0
        }
      };
    } catch (error) {
      return toFailure(error, "Unable to flush analytics queue");
    }
  }

  async clearUploaded(): Promise<AnalyticsQueueResult<void>> {
    try {
      const db = await this.getDatabase();
      const uploaded = await db.getAllFromIndex("analytics_events", "by_status", "uploaded");
      const transaction = db.transaction("analytics_events", "readwrite");
      await Promise.all(uploaded.map((event) => transaction.store.delete(event.id)));
      await transaction.done;
      return { ok: true, data: undefined };
    } catch (error) {
      return toFailure(error, "Unable to clear uploaded analytics events");
    }
  }

  async getMetrics(): Promise<AnalyticsQueueResult<AnalyticsQueueMetrics>> {
    try {
      const db = await this.getDatabase();
      await this.enforceQueueProtection(db);
      const events = await db.getAll("analytics_events");
      events.sort((left, right) => left.queued_at.localeCompare(right.queued_at));
      const oldest = events[0] ?? null;
      const dropped = await this.getDroppedEvents(db);
      return {
        ok: true,
        data: {
          totalEvents: events.length,
          oldestEventAgeMs: oldest ? Math.max(Date.now() - timestampMs(oldest.queued_at), 0) : null,
          droppedEvents: dropped
        }
      };
    } catch (error) {
      return toFailure(error, "Unable to read analytics queue metrics");
    }
  }

  async clearForTests(): Promise<void> {
    const database = await this.databasePromise;
    database?.close();
    this.databasePromise = null;
    await deleteDB(this.databaseName);
  }

  private async markUploading(events: AnalyticsQueueEvent[]): Promise<void> {
    await this.updateEvents(events, (event) => ({
      ...event,
      queue_status: "uploading",
      updated_at: nowIso()
    }));
  }

  private async markUploaded(events: AnalyticsQueueEvent[]): Promise<void> {
    await this.updateEvents(events, (event) => ({
      ...event,
      queue_status: "uploaded",
      last_error: null,
      updated_at: nowIso()
    }));
  }

  private async markFailed(events: AnalyticsQueueEvent[], message: string): Promise<void> {
    await this.updateEvents(events, (event) => ({
      ...event,
      queue_status: "pending",
      attempts: event.attempts + 1,
      last_error: message,
      updated_at: nowIso()
    }));
  }

  private async updateEvents(
    events: AnalyticsQueueEvent[],
    update: (event: AnalyticsQueueEvent) => AnalyticsQueueEvent
  ): Promise<void> {
    const db = await this.getDatabase();
    const transaction = db.transaction("analytics_events", "readwrite");
    await Promise.all(events.map((event) => transaction.store.put(update(event))));
    await transaction.done;
  }

  private async coalesceDurationEvent(
    db: IDBPDatabase<FieldTrixAnalyticsDB>,
    event: AnalyticsQueueEvent
  ): Promise<AnalyticsQueueEvent> {
    if (event.event_type !== "duration_watched") {
      await db.put("analytics_events", event);
      return event;
    }

    const pending = await db.getAllFromIndex("analytics_events", "by_status", "pending");
    const existing = pending
      .filter(
        (candidate) =>
          candidate.event_type === "duration_watched" &&
          candidate.media_id === event.media_id &&
          candidate.media_version === event.media_version &&
          candidate.source === event.source
      )
      .sort((left, right) => left.queued_at.localeCompare(right.queued_at))[0];

    if (!existing) {
      await db.put("analytics_events", event);
      return event;
    }

    const coalesced: AnalyticsQueueEvent = {
      ...existing,
      occurred_at: event.occurred_at,
      duration_seconds: (existing.duration_seconds ?? 0) + (event.duration_seconds ?? 0),
      playback_position_seconds:
        event.playback_position_seconds ?? existing.playback_position_seconds,
      metadata: {
        ...existing.metadata,
        ...event.metadata,
        coalesced_count: Number(existing.metadata.coalesced_count ?? 1) + 1
      },
      updated_at: event.updated_at
    };
    await db.put("analytics_events", coalesced);
    await this.incrementDroppedEvents(db, 1);
    return coalesced;
  }

  private async enforceQueueProtection(db: IDBPDatabase<FieldTrixAnalyticsDB>): Promise<void> {
    const events = await db.getAll("analytics_events");
    const cutoff = Date.now() - MAX_EVENT_AGE_MS;
    const expired = events.filter((event) => timestampMs(event.queued_at) < cutoff);
    if (expired.length > 0) {
      await this.deleteEvents(db, expired);
      await this.incrementDroppedEvents(db, expired.length);
    }

    const remaining = (await db.getAll("analytics_events")).sort((left, right) =>
      left.queued_at.localeCompare(right.queued_at)
    );
    const overflow = Math.max(remaining.length - MAX_EVENTS, 0);
    if (overflow > 0) {
      await this.deleteEvents(db, remaining.slice(0, overflow));
      await this.incrementDroppedEvents(db, overflow);
    }
  }

  private async deleteEvents(
    db: IDBPDatabase<FieldTrixAnalyticsDB>,
    events: AnalyticsQueueEvent[]
  ): Promise<void> {
    const transaction = db.transaction("analytics_events", "readwrite");
    await Promise.all(events.map((event) => transaction.store.delete(event.id)));
    await transaction.done;
  }

  private async getDroppedEvents(db: IDBPDatabase<FieldTrixAnalyticsDB>): Promise<number> {
    return (await db.get("analytics_metrics", DROPPED_EVENTS_KEY))?.value ?? 0;
  }

  private async incrementDroppedEvents(
    db: IDBPDatabase<FieldTrixAnalyticsDB>,
    count: number
  ): Promise<void> {
    if (count <= 0) {
      return;
    }
    const current = await this.getDroppedEvents(db);
    await db.put("analytics_metrics", {
      key: DROPPED_EVENTS_KEY,
      value: current + count
    });
  }

  private toPayload(event: AnalyticsQueueEvent): AnalyticsEventPayload {
    return {
      id: event.id,
      media_id: event.media_id,
      media_version: event.media_version,
      event_type: event.event_type,
      occurred_at: event.occurred_at,
      duration_seconds: event.duration_seconds,
      playback_position_seconds: event.playback_position_seconds,
      source: event.source,
      metadata: event.metadata
    };
  }

  private async getDatabase(): Promise<IDBPDatabase<FieldTrixAnalyticsDB>> {
    if (!("indexedDB" in globalThis)) {
      throw new Error("IndexedDB is not available in this environment");
    }

    this.databasePromise ??= openDB<FieldTrixAnalyticsDB>(this.databaseName, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains("analytics_events")) {
          const eventStore = database.createObjectStore("analytics_events", { keyPath: "id" });
          eventStore.createIndex("by_status", "queue_status");
          eventStore.createIndex("by_queued_at", "queued_at");
        }
        if (!database.objectStoreNames.contains("analytics_metrics")) {
          database.createObjectStore("analytics_metrics", { keyPath: "key" });
        }
      }
    });

    return this.databasePromise;
  }
}

export const analyticsQueue = new AnalyticsQueue();
