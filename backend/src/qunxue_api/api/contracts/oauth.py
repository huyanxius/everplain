from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

OAuthProvider = Literal["google", "github"]


class OAuthProvidersResponse(BaseModel):
    providers: list[OAuthProvider]


class OAuthStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    return_path: str = Field(default="/app", min_length=1, max_length=2048)


class OAuthStartResponse(BaseModel):
    authorization_url: str
