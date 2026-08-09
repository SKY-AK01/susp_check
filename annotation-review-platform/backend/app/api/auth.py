"""Authentication endpoints."""
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.auth.jwt import create_access_token, hash_password, verify_password
from app.auth.rbac import get_current_user, require_admin
from app.database import get_db
from app.models.user import User, UserRole
from app.schemas.auth import TokenOut, UserCreate, PublicUserCreate, UserOut

router = APIRouter(prefix="/api/auth", tags=["auth"])

ORCHVATE_INVITE_CODE = "ORCHVATE@2026"


@router.post("/register-public", response_model=UserOut, status_code=201)
async def register_public(
    body: PublicUserCreate,
    db: AsyncSession = Depends(get_db),
):
    """Self-registration: open to anyone who has the invite code."""
    if body.invite_code != ORCHVATE_INVITE_CODE:
        raise HTTPException(status_code=403, detail="Invalid invite code")
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email,
        name=body.name,
        hashed_password=hash_password(body.password),
        role=UserRole.supervisor,   # new self-registered users get supervisor role
    )
    db.add(user)
    await db.flush()
    return user


@router.post("/register", response_model=UserOut, status_code=201)
async def register(
    body: UserCreate,
    db: AsyncSession = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin-only: create a new user."""
    existing = await db.execute(select(User).where(User.email == body.email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")
    user = User(
        email=body.email,
        name=body.name,
        hashed_password=hash_password(body.password),
        role=body.role,
    )
    db.add(user)
    await db.flush()
    return user


@router.post("/token", response_model=TokenOut)
async def login(
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.email == form.username, User.is_active == True))
    user = result.scalar_one_or_none()
    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Incorrect credentials")
    token = create_access_token(str(user.id), user.role.value)
    return {"access_token": token, "token_type": "bearer"}


@router.get("/me", response_model=UserOut)
async def me(current_user: User = Depends(get_current_user)):
    return current_user
