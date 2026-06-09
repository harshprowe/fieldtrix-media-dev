from __future__ import annotations

from app.core.security import create_access_token, create_refresh_token
from app.schemas.auth import TokenPair


class AuthService:
    async def authenticate(self, *, username: str, password: str) -> TokenPair | None:
        # Placeholder until user repository lookup is implemented.
        if not username or not password:
            return None

        return None

    def create_token_pair(self, *, subject: str) -> TokenPair:
        return TokenPair(
            access_token=create_access_token(subject),
            refresh_token=create_refresh_token(subject),
        )

