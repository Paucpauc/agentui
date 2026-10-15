from typing import Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class CreateDirRequest(BaseModel):
    name: str


class RenameWorkspaceRequest(BaseModel):
    old_name: str
    new_name: str


class CreateFileRequest(BaseModel):
    workspace: str
    path: str
    content: Optional[str] = ""


class SaveFileRequest(BaseModel):
    workspace: str
    path: str
    content: str
    encoding: Optional[str] = None


class RenameFileRequest(BaseModel):
    workspace: str
    old_path: str
    new_path: str


class DeleteFileRequest(BaseModel):
    workspace: str
    path: str


class CreatePublicLinkRequest(BaseModel):
    workspace: str
    path: str
    expires_in: Optional[int] = None
    expires: Optional[int] = None
    download: Optional[bool] = False
    base_url: Optional[str] = None
