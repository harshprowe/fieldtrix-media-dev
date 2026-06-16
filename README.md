# FieldTrix Media Delivery System

FieldTrix is an offline-first media delivery system. The backend stores media metadata and generates Cloudflare R2 presigned URLs. The browser uploads and downloads media directly from R2/CDN, then caches downloaded media locally for offline playback.

## Architecture

```text
Frontend
  React + Vite + TypeScript
  React Query
  IndexedDB metadata
  Cache API media storage
  Workbox service worker

Backend
  FastAPI
  Async SQLAlchemy
  Alembic
  PostgreSQL / Neon
  JWT auth skeleton
  Prometheus metrics

Storage
  Private Cloudflare R2
  Short-lived signed playback URLs
```

Core rules:

- FastAPI never proxies media files.
- Uploads go directly from browser to R2 using presigned URLs.
- Playback uses local cache first, then a short-lived signed R2 URL fallback.
- PostgreSQL stores metadata only.
- Offline playback must not call backend APIs.

## Project Structure

```text
backend/
  app/
    api/
    core/
    db/
    models/
    repositories/
    schemas/
    services/
  alembic/
  scripts/
  tests/

frontend/
  src/
    api/
    components/
    hooks/
    pages/
    services/
    storage/
    workers/

cloudflare/
  r2-cors.dev.json
```

## Reusing In An Existing Codebase

FieldTrix is split so the media delivery workflow can be embedded into another application without using this demo app shell.

### Backend Integration

For an existing FastAPI backend, mount only the media API:

```python
from fastapi import FastAPI
from app.integration import mount_fieldtrix_media

app = FastAPI()

mount_fieldtrix_media(
    app,
    prefix="/api/v1/media",
)
```

If your company already has its own database/session/storage wiring, provide a custom service factory:

```python
from sqlalchemy.ext.asyncio import AsyncSession
from app.integration import mount_fieldtrix_media
from app.repositories.media_repository import MediaRepository
from app.services.media_service import MediaService
from app.services.r2_storage_service import R2StorageService

def create_company_media_service(session: AsyncSession) -> MediaService:
    return MediaService(
        repository=MediaRepository(session),
        storage_service=R2StorageService(),
    )

mount_fieldtrix_media(
    app,
    prefix="/api/media",
    media_service_factory=create_company_media_service,
)
```

The reusable backend boundary is:

```text
app.integration.mount_fieldtrix_media
app.services.media_service.MediaService
app.repositories.media_repository.MediaRepository
app.services.r2_storage_service.R2StorageService
```

### Frontend Integration

Existing React apps can use the FieldTrix provider and hooks without using this repository's router/layout:

```tsx
import {
  FieldTrixMediaProvider,
  useMediaList,
  useMediaUpload,
  useMediaDownload,
} from "./fieldtrix";

function CompanyApp() {
  return (
    <FieldTrixMediaProvider
      api={{
        apiBaseUrl: "https://api.company.com/api/v1",
        getAccessToken: () => companyAuth.getAccessToken(),
      }}
    >
      <CompanyMediaPage />
    </FieldTrixMediaProvider>
  );
}
```

The reusable frontend boundary is:

```text
frontend/src/fieldtrix.tsx
frontend/src/api/*
frontend/src/hooks/*
frontend/src/services/media*
frontend/src/storage/mediaStorageService.ts
frontend/src/components/media/*
```

The host application owns:

- authentication UX
- route layout
- design system
- API base URL
- token provider
- production deployment

## Requirements

- Python 3.12 recommended
- Node.js 20+
- PostgreSQL database, Neon supported
- Cloudflare R2 bucket
- Wrangler CLI for R2 CORS setup

## Backend Setup

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Create `backend/.env` from `backend/.env.example` and configure:

```env
APP_ENV=local
DEBUG=true
API_V1_PREFIX=/api/v1
BACKEND_CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173

DATABASE_URL=postgresql+asyncpg://<user>:<password>@<host>/<db>?ssl=require

JWT_SECRET_KEY=<random-secret>
JWT_ALGORITHM=HS256

R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=<bucket-name>
R2_REGION_NAME=auto
```

Generate a JWT secret:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

Run migrations:

```powershell
cd backend
$env:DEBUG='true'
.\.venv\Scripts\alembic.exe upgrade head
```

Start the backend with `.env` reload support:

```powershell
cd backend
.\scripts\dev.ps1
```

Backend URL:

```text
http://127.0.0.1:8000
```

API base URL:

```text
http://127.0.0.1:8000/api/v1
```

## Frontend Setup

```powershell
cd frontend
npm install
```

Create `frontend/.env`:

```env
VITE_APP_NAME=FieldTrix
VITE_API_BASE_URL=http://localhost:8000/api/v1
VITE_ENABLE_PWA=true
```

Start frontend:

```powershell
cd frontend
npm run dev
```

Frontend URL:

```text
http://localhost:5173
```

## Cloudflare R2 Setup

Create an R2 bucket, for example:

```text
fieldtrix-media-dev
```

Create an R2 Account API token with object read/write access scoped to that bucket.

Apply browser upload CORS:

```powershell
npx wrangler login
npx wrangler r2 bucket cors set fieldtrix-media-dev --file cloudflare/r2-cors.dev.json
npx wrangler r2 bucket cors list fieldtrix-media-dev
```

## Media Upload Flow

The frontend automates the full upload workflow:

1. User selects a media file in the browser.
2. Frontend calls `POST /media/upload-url`.
3. Backend generates a presigned R2 `PUT` URL.
4. Browser uploads the file directly to R2.
5. Frontend calls `POST /media`.
6. Backend validates the R2 object and stores metadata in PostgreSQL.
7. Media appears in the frontend library.

Versioned object keys are immutable:

```text
media/{media_id}/v{version}/{filename}
```

## Offline Playback

The media table supports:

- `Open`: preview/play media.
- `Download`: cache the original media file locally.

Playback behavior:

- If downloaded, playback source is local cache.
- If not downloaded, frontend requests a short-lived signed playback URL.
- FastAPI is not called during playback.
- FastAPI is only called to issue the signed URL for uncached online playback/download.

Original-quality playback at low bandwidth requires downloading the file first. CDN streaming preserves the original asset, but low bandwidth may buffer.

## Protected Media Model

For protected media without DRM:

- Keep the R2 bucket private.
- Do not enable public `r2.dev` access for production.
- Do not store permanent CDN URLs in IndexedDB.
- Use `POST /media/{media_id}/playback-url` for temporary playback URLs.
- Downloaded offline media is still accessible to a user who controls the browser profile.

This prevents permanent URL sharing, but it is not DRM. If the user can play media, the browser can access the bytes.

## Tests

Backend:

```powershell
cd backend
.\.venv\Scripts\pytest.exe
```

Frontend:

```powershell
cd frontend
npm test
```

Focused upload service test:

```powershell
cd frontend
npm test -- --run src/services/mediaUpload/MediaUploadService.test.ts
```

Build:

```powershell
cd frontend
npm run build
```

Note: the current full frontend build may still report pre-existing TypeScript issues in `HealthPage`, `MediaDownloadManager`, and `serviceWorker`. The media upload service tests pass.

## Common Issues

### Missing R2 Configuration

If upload fails with:

```text
Missing required R2 configuration
```

Restart backend after editing `backend/.env`:

```powershell
cd backend
.\scripts\dev.ps1
```

### R2 CORS Failure

If browser upload fails with:

```text
No Access-Control-Allow-Origin header
```

Apply R2 CORS:

```powershell
npx wrangler r2 bucket cors set fieldtrix-media-dev --file cloudflare/r2-cors.dev.json
```

### DEBUG Validation Error

If Pydantic reports:

```text
debug: Input should be a valid boolean
```

Your shell has a conflicting `DEBUG` value. Use:

```powershell
$env:DEBUG='true'
```

The backend dev script already sets this.

## Security Notes

- Do not commit `.env` files.
- R2 secret access key is visible only once when created.
- Use bucket-scoped R2 credentials.
- Use custom domain/CDN settings for production.
- Rotate JWT and R2 secrets if they are exposed.
