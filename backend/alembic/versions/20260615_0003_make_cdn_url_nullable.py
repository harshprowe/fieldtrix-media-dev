"""make cdn url nullable

Revision ID: 20260615_0003
Revises: 20260606_0002
Create Date: 2026-06-15 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260615_0003"
down_revision = "20260606_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "media_assets",
        "cdn_url",
        existing_type=sa.String(length=2048),
        nullable=True,
    )


def downgrade() -> None:
    op.execute("UPDATE media_assets SET cdn_url = '' WHERE cdn_url IS NULL")
    op.alter_column(
        "media_assets",
        "cdn_url",
        existing_type=sa.String(length=2048),
        nullable=False,
    )
