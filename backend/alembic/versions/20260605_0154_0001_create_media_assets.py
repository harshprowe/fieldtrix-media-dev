"""create media assets

Revision ID: 0001_create_media_assets
Revises: None
Create Date: 2026-06-05 01:54:00.000000
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001_create_media_assets"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    media_type = postgresql.ENUM(
        "image",
        "video",
        "audio",
        "document",
        "other",
        name="media_type",
        create_type=False,
    )
    media_type.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "media_assets",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("media_type", media_type, nullable=False),
        sa.Column("cdn_url", sa.String(length=2048), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("file_size", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("title", "version", name="uq_media_assets_title_version"),
    )
    op.create_index(op.f("ix_media_assets_title"), "media_assets", ["title"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_media_assets_title"), table_name="media_assets")
    op.drop_table("media_assets")

    media_type = postgresql.ENUM(
        "image",
        "video",
        "audio",
        "document",
        "other",
        name="media_type",
        create_type=False,
    )
    media_type.drop(op.get_bind(), checkfirst=True)
