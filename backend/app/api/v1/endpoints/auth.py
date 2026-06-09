from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm

from app.api.deps import get_current_token_payload
from app.schemas.auth import TokenPair, TokenPayload
from app.services.auth_service import AuthService

router = APIRouter()


@router.post("/login", response_model=TokenPair)
async def login(form_data: OAuth2PasswordRequestForm = Depends()) -> TokenPair:
    auth_service = AuthService()
    token_pair = await auth_service.authenticate(
        username=form_data.username,
        password=form_data.password,
    )

    if token_pair is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return token_pair


@router.get("/me", response_model=TokenPayload)
async def read_current_subject(
    payload: TokenPayload = Depends(get_current_token_payload),
) -> TokenPayload:
    return payload

