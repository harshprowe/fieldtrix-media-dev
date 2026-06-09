You are building FieldTrix Media Delivery System.

Tech Stack:

Frontend:
- React
- Vite
- TypeScript
- React Query
- IndexedDB
- Service Worker
- PWA

Backend:
- FastAPI
- PostgreSQL
- SQLAlchemy
- Alembic
- JWT Authentication

Storage:
- Cloudflare R2

Delivery:
- Cloudflare CDN

Architecture Rules:

1. Backend never serves media files.
2. Media is uploaded directly to R2 using presigned URLs.
3. Media playback must never hit backend APIs.
4. Playback must work fully offline after download.
5. Metadata comes from FastAPI.
6. Media files come only from CDN.
7. Analytics are sent asynchronously.
8. Code must be production-grade.
9. Use clean architecture.
10. Write tests for critical functionality.

Always explain architecture decisions before coding.
Always generate code incrementally.