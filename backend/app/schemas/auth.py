from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: Literal["bearer"] = "bearer"


class TokenPayload(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    subject: str
    token_type: Literal["access", "refresh"]
    issued_at: datetime
    expires_at: datetime

