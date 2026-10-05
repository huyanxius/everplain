from typing import Annotated, Literal, NotRequired, TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator, with_config

AvatarColor = Annotated[str, Field(pattern=r"^#[0-9a-fA-F]{6}$")]


@with_config(ConfigDict(extra="forbid"))
class UserAvatar(TypedDict):
    id: Literal["xiaoping", "mo", "silver", "sand", "cat", "hime"]
    hair: NotRequired[AvatarColor]
    skin: NotRequired[AvatarColor]
    sleeve: NotRequired[AvatarColor]
    blush: NotRequired[Annotated[bool, Field(strict=True)]]


class Questionnaire(BaseModel):
    model_config = ConfigDict(extra="forbid")
    occupation: str = Field(default="", max_length=160)
    industry: str = Field(default="", max_length=160)
    goals: list[str] = Field(default_factory=list, max_length=8)
    interests: list[str] = Field(default_factory=list, max_length=12)
    additional: str = Field(default="", max_length=1000)

    @field_validator("goals", "interests")
    @classmethod
    def short_items(cls, values):
        if any(not x.strip() or len(x) > 60 for x in values):
            raise ValueError("每一项需要1–60个字符")
        return list(dict.fromkeys(x.strip() for x in values))


class AgentProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_version: int = Field(ge=0)
    name: str | None = Field(default=None, min_length=1, max_length=40)
    avatar_id: Literal["cheng", "nian", "qi", "shi", "heng", "ruo", "you"] | None = None
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    speaking_style: Literal["clear", "warm", "rigorous", "curious"] | None = None
    soul_text: str | None = Field(default=None, max_length=8000)
    user_avatar: UserAvatar | None = None
    setup_step: int | None = Field(default=None, ge=0, le=6)
    setup_completed: bool | None = None
    questionnaire: Questionnaire | None = None

    @field_validator("name")
    @classmethod
    def trim_name(cls, value):
        if value is not None and not value.strip():
            raise ValueError("名字不能为空")
        return value.strip() if value else value


class AgentProfileResponse(BaseModel):
    name: str
    avatar_id: str
    color: str
    speaking_style: str
    soul_text: str = ""
    user_avatar: UserAvatar | None = None
    setup_step: int
    setup_completed: bool
    questionnaire: Questionnaire
    version: int
    greeting: str
