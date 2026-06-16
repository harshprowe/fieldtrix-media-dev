import "fake-indexeddb/auto";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { MediaRead } from "../../api/media";
import { AnalyticsQueue } from "./AnalyticsQueue";
import type { AnalyticsApiPort } from "./types";

function makeMedia(overrides: Partial<MediaRead> = {}): MediaRead {
  return {
    id: "media-1",
    title: "Launch Screen",
    media_type: "video",
    version: 1,
    file_size: 1024,
    created_at: "2026-06-05T00:00:00.000Z",
    updated_at: "2026-06-05T00:00:00.000Z",
    ...overrides
  };
}

class FakeAnalyticsApi implements AnalyticsApiPort {
  uploadedBatches: unknown[] = [];
  shouldFail = false;

  async uploadBatch(payload: Parameters<AnalyticsApiPort["uploadBatch"]>[0]) {
    if (this.shouldFail) {
      throw new Error("Network unavailable");
    }
    this.uploadedBatches.push(payload);
    return { accepted: payload.events.length };
  }
}

describe("AnalyticsQueue", () => {
  const api = new FakeAnalyticsApi();
  const queue = new AnalyticsQueue("fieldtrix-analytics-test", api);

  afterEach(async () => {
    api.uploadedBatches = [];
    api.shouldFail = false;
    await queue.clearForTests();
  });

  it("stores analytics events locally first", async () => {
    const result = await queue.track({
      media: makeMedia(),
      eventType: "viewed",
      source: "cache"
    });

    expect(result.ok).toBe(true);
    const pending = await queue.listPending();
    expect(pending.ok && pending.data).toHaveLength(1);
  });

  it("flushes pending events in batches", async () => {
    await queue.track({ media: makeMedia({ id: "media-1" }), eventType: "viewed" });
    await queue.track({ media: makeMedia({ id: "media-2" }), eventType: "playback_started" });

    const summary = await queue.flush(2);

    expect(summary.ok).toBe(true);
    expect(api.uploadedBatches).toHaveLength(1);
    expect(api.uploadedBatches[0]).toMatchObject({
      events: expect.arrayContaining([
        expect.objectContaining({ event_type: "viewed" }),
        expect.objectContaining({ event_type: "playback_started" })
      ])
    });
  });

  it("keeps events pending when upload fails", async () => {
    api.shouldFail = true;
    await queue.track({ media: makeMedia(), eventType: "duration_watched", durationSeconds: 10 });

    const summary = await queue.flush();
    const pending = await queue.listPending();

    expect(summary.ok).toBe(true);
    expect(pending.ok && pending.data).toHaveLength(1);
    if (pending.ok) {
      expect(pending.data[0].attempts).toBe(1);
      expect(pending.data[0].last_error).toBe("Network unavailable");
    }
  });

  it("clears uploaded events after successful upload", async () => {
    await queue.track({ media: makeMedia(), eventType: "playback_completed" });
    await queue.flush();

    const cleared = await queue.clearUploaded();
    const pending = await queue.listPending();

    expect(cleared.ok).toBe(true);
    expect(pending.ok && pending.data).toEqual([]);
  });

  it("coalesces repeated duration events into one aggregate event", async () => {
    for (let index = 0; index < 100; index += 1) {
      await queue.track({
        media: makeMedia(),
        eventType: "duration_watched",
        durationSeconds: 1,
        playbackPositionSeconds: index,
        source: "cache"
      });
    }

    const pending = await queue.listPending(1000);
    const metrics = await queue.getMetrics();

    expect(pending.ok).toBe(true);
    if (pending.ok) {
      expect(pending.data).toHaveLength(1);
      expect(pending.data[0].duration_seconds).toBe(100);
      expect(pending.data[0].playback_position_seconds).toBe(99);
      expect(pending.data[0].metadata.coalesced_count).toBe(100);
    }
    expect(metrics.ok && metrics.data.droppedEvents).toBe(99);
  });

  it("keeps at most 1000 events and removes oldest events first", async () => {
    vi.useFakeTimers();
    try {
      for (let index = 0; index < 1005; index += 1) {
        vi.setSystemTime(new Date(Date.UTC(2026, 5, 6, 0, 0, index)));
        await queue.track({
          media: makeMedia({ id: `media-${index}` }),
          eventType: "viewed"
        });
      }

      const pending = await queue.listPending(1100);
      const metrics = await queue.getMetrics();

      expect(pending.ok).toBe(true);
      if (pending.ok) {
        expect(pending.data).toHaveLength(1000);
        expect(pending.data[0].media_id).toBe("media-5");
      }
      expect(metrics.ok && metrics.data).toMatchObject({
        totalEvents: 1000,
        droppedEvents: 5
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("drops events older than seven days", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));
      await queue.track({ media: makeMedia({ id: "old" }), eventType: "viewed" });

      vi.setSystemTime(new Date("2026-06-09T00:00:00.000Z"));
      await queue.track({ media: makeMedia({ id: "new" }), eventType: "playback_started" });

      const pending = await queue.listPending(10);
      const metrics = await queue.getMetrics();

      expect(pending.ok).toBe(true);
      if (pending.ok) {
        expect(pending.data.map((event) => event.media_id)).toEqual(["new"]);
      }
      expect(metrics.ok && metrics.data).toMatchObject({
        totalEvents: 1,
        droppedEvents: 1
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports queue metrics", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-06-06T00:00:00.000Z"));
      await queue.track({ media: makeMedia({ id: "media-1" }), eventType: "viewed" });
      vi.setSystemTime(new Date("2026-06-06T00:00:05.000Z"));
      await queue.track({ media: makeMedia({ id: "media-2" }), eventType: "playback_started" });

      const metrics = await queue.getMetrics();

      expect(metrics.ok).toBe(true);
      if (metrics.ok) {
        expect(metrics.data.totalEvents).toBe(2);
        expect(metrics.data.oldestEventAgeMs).toBe(5000);
        expect(metrics.data.droppedEvents).toBe(0);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
