"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2025-01-01 00:00:00.000000

This migration is intentionally left as a marker.
The actual schema is managed by SQLModel's create_all() at startup,
which creates all tables defined in app/models/__init__.py.

To use Alembic for schema changes going forward:
  1. Make changes to models in app/models/__init__.py
  2. Run: alembic revision --autogenerate -m "describe your change"
  3. Review the generated migration in migrations/versions/
  4. Run: alembic upgrade head
"""
from alembic import op
import sqlalchemy as sa

revision = '0001_initial'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Schema is created by SQLModel.metadata.create_all() at startup.
    # This migration exists as a baseline marker so future autogenerate
    # migrations have a revision to depend on.
    pass


def downgrade() -> None:
    pass
