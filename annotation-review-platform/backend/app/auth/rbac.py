"""
RBAC enforcement — §16.3.
All authorization is server-side; roles are read from the JWT, not trusted from client.
"""
from __future__ import annotations
from functools import lru_cache
import uuid

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.jwt import decode_token, oauth2_scheme
from app.database import get_db
from app.models.user import User, UserRole


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    payload = decode_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token subject")
    result = await db.execute(select(User).where(User.id == uuid.UUID(user_id), User.is_active == True))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    return user


def require_roles(*roles: UserRole):
    """Dependency factory — enforces that the calling user has one of the given roles."""
    async def _check(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Required role: {[r.value for r in roles]}",
            )
        return current_user
    return _check


# Convenience dependencies
require_admin = require_roles(UserRole.admin)
require_supervisor_or_above = require_roles(UserRole.admin, UserRole.supervisor)
require_any = require_roles(UserRole.admin, UserRole.supervisor, UserRole.viewer)
