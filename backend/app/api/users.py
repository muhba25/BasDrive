from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.database import get_db
from app.models import User
from app.schemas import UserSearchOut

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/search", response_model=list[UserSearchOut])
def search_users(q: str = Query(min_length=1), db: Session = Depends(get_db), user: User = Depends(current_user)):
    term = f"%{q.strip()}%"
    rows = db.scalars(
        select(User)
        .where(User.is_active.is_(True), User.id != user.id, or_(User.username.ilike(term), User.email.ilike(term), User.display_name.ilike(term)))
        .limit(12)
    ).all()
    return [
        UserSearchOut(id=row.id, username=row.username, display_name=row.display_name or row.username, email=row.email)
        for row in rows
    ]
