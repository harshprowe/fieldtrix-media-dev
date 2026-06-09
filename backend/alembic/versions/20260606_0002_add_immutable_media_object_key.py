"""add immutable media object key

Revision ID: 20260606_0002
Revises: 0001_create_media_assets
Create Date: 2026-06-06 00:00:00.000000
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20260606_0002"
down_revision = "0001_create_media_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "media_assets",
        sa.Column("object_key", sa.String(length=1024), nullable=True),
    )
    op.execute(
        """
        UPDATE media_assets
        SET object_key = 'media/' || id::text || '/v' || version::text || '/' || id::text
        WHERE object_key IS NULL
        """
    )
    op.alter_column("media_assets", "object_key", nullable=False)
    op.create_unique_constraint(
        "uq_media_assets_object_key",
        "media_assets",
        ["object_key"],
    )


def downgrade() -> None:
    op.drop_constraint("uq_media_assets_object_key", "media_assets", type_="unique")
    op.drop_column("media_assets", "object_key")
