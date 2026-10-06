from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.api.deps import current_user
from app.api.items import resolve_readable
from app.database import get_db
from app.models import Item, User
from app.schemas import ArchiveDownloadIn, PrepareDownloadOut
from app.services.files import materialize_download, touch_access
from app.services.tickets import get_ticket, issue_ticket, ticket_payload

router = APIRouter(prefix="/downloads", tags=["downloads"])


@router.post("/prepare", response_model=PrepareDownloadOut)
def prepare_download(payload: ArchiveDownloadIn, db: Session = Depends(get_db), user: User = Depends(current_user)):
    seen: set[str] = set()
    items: list[Item] = []
    for item_id in payload.item_ids:
        if item_id in seen:
            continue
        seen.add(item_id)
        item, perm = resolve_readable(db, user, item_id)
        if perm == "view":
            raise HTTPException(status_code=403, detail="Akses ini hanya untuk melihat")
        items.append(item)
        touch_access(item)
    if not items:
        raise HTTPException(status_code=400, detail="Tidak ada item untuk diunduh")
    db.commit()
    path, filename, media_type, delete_after = materialize_download(db, items)
    return PrepareDownloadOut(**ticket_payload(issue_ticket(path, filename, media_type, delete_after)))


@router.get("/{ticket}")
def claim_download(ticket: str):
    info = get_ticket(ticket)
    return FileResponse(
        info["path"],
        filename=info["filename"],
        media_type=info["media_type"],
        content_disposition_type="attachment",
    )
