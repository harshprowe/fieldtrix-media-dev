# FieldTrix Web Media Delivery System – Project Overview

## 1. Core Idea

FieldTrix is a field sales platform designed for medical representatives who interact with doctors, pharmacists, and healthcare professionals. A critical part of these interactions is presenting high-quality media (videos, images, PDFs) that explain products, treatments, or research insights.

The core problem being solved:

* Field representatives often operate in **low or unstable network environments**
* Media-heavy presentations suffer from:

  * Buffering
  * Quality degradation
  * Loading delays
* This leads to a **poor and unprofessional experience during client interactions**

### Solution

Build a **web-based offline-first media delivery system** that ensures:

* Media is **pre-downloaded when bandwidth is available**
* Media is **stored locally in the browser**
* Playback is **instant, high-quality, and network-independent**
* Backend is **not involved in media delivery during playback**

---

## 2. Architectural Philosophy

The system is designed around a strict separation:

### Control Plane (Backend)

* Handles:

  * Authentication
  * Metadata (media URLs, versions)
  * Access control
  * Analytics
* Technology:

  * Flask API
  * PostgreSQL

### Data Plane (Media Delivery)

* Handles:

  * Media storage and delivery
* Technology:

  * Cloud Storage (Cloudflare R2)
  * CDN (Cloudflare)

### Client Layer (Web PWA)

* Handles:

  * Media download
  * Local storage
  * Playback
* Technology:

  * React (PWA)
  * Service Worker
  * IndexedDB

### Key Principle

> The backend must **never serve media files**.
> Media is delivered via CDN and consumed directly by the client.

---

## 3. System Goals

1. **Offline-first experience**
2. **Zero buffering during playback**
3. **Consistent media quality (no adaptive streaming)**
4. **Minimal backend load**
5. **Scalable media delivery**
6. **Observable system behavior (via logging & monitoring)**

---

## 4. High-Level Workflow

---

### Phase 1: Media Upload (Admin Side)

1. Admin uploads media through the web interface
2. Backend generates a **pre-signed upload URL**
3. Media is uploaded **directly to Cloudflare R2**
4. CDN (Cloudflare) sits in front of R2 for delivery
5. Backend stores metadata:

   * media_id
   * CDN URL
   * version
   * type (video/image/pdf)

---

### Phase 2: Metadata Sync (Sales Representative)

1. Sales rep logs into the web app

2. App calls backend API:

   ```
   GET /media
   ```

3. Backend returns:

   * Media list
   * CDN URLs
   * Version info

👉 Only lightweight JSON flows through backend

---

### Phase 3: Media Download (Pre-Visit)

1. Rep chooses to download media (manual or auto)

2. Web app downloads media **directly from CDN (backed by R2)**

3. Media is stored locally in:

   * IndexedDB (as Blob)

4. Local mapping is created:

   ```
   media_id → blob
   ```

5. Service Worker may cache responses for redundancy

---

### Phase 4: Offline Playback (During Visit)

1. User selects media

2. App checks local storage:

   * If present → load from IndexedDB
   * Convert to Blob URL
   * Play instantly

3. No:

   * Backend calls
   * CDN calls
   * Network dependency

---

### Phase 5: Fallback (Edge Case)

If media is not downloaded:

* App falls back to CDN (Cloudflare)
* Media is fetched online from R2 via CDN

---

### Phase 6: Analytics & Sync

1. App tracks:

   * Media viewed
   * Duration
   * Interaction

2. Sends to backend:

   ```
   POST /analytics
   ```

---

## 5. Backend Monitoring & Verification

A critical requirement is ensuring:

> Backend is NOT being hit unnecessarily during playback

### Implementation

#### 1. Request Logging Middleware

* Logs every API request:

  * endpoint
  * user
  * timestamp
  * response time

#### 2. Endpoint Categorization

* Metadata endpoints
* Analytics endpoints
* Unexpected endpoints

#### 3. Monitoring Dashboard

* Track:

  * Requests per minute
  * Endpoint distribution
  * Spikes/anomalies

#### 4. Validation Goal

* During playback:

  * **Zero media-related backend hits**
  * Only analytics (optional)

---

## 6. Key Design Decisions

### Why not HLS?

* HLS adapts quality based on bandwidth
* Not acceptable for professional presentations
* Requirement: **consistent, original quality**

---

### Why IndexedDB?

* Only viable persistent storage for large blobs in web
* Allows offline access
* Works with Service Workers

---

### Why CDN instead of backend delivery?

* Removes backend bottleneck
* Reduces latency
* Scales globally
* Works seamlessly with Cloudflare R2

---

## 7. Constraints & Tradeoffs

### Constraints

* Browser storage limits
* Possible data eviction by browser
* No full control over filesystem (unlike mobile)

---

### Tradeoffs

| Decision           | Benefit                 | Cost                       |
| ------------------ | ----------------------- | -------------------------- |
| Offline-first      | Reliable UX             | Storage complexity         |
| Full-quality media | Professional experience | Larger downloads           |
| CDN-based delivery | Scalability             | Slight complexity in setup |

---

## 8. Success Criteria

The system is successful if:

* Media plays **instantly during visits**

* No buffering or quality drop occurs

* Backend load remains minimal

* Logs confirm:

  * No unnecessary API hits

* Users can operate effectively in **low/no network environments**

---

## 9. Summary

This system transforms FieldTrix from a standard web app into:

> A **high-performance, offline-capable media platform for field sales**

It ensures that:

* Preparation happens online
* Execution happens offline
* Experience remains seamless and professional

---
