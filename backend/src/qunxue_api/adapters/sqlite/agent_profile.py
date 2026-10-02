from dataclasses import asdict, replace
from uuid import UUID

from sqlalchemy import JSON, Boolean, ForeignKey, Integer, String, update
from sqlalchemy.dialects.sqlite import insert
from sqlalchemy.orm import Mapped, mapped_column

from qunxue_api.modules.agent_profile import AgentProfile, ProfileConflict

from .base import Base


class AgentProfileRow(Base):
    __tablename__ = "agent_profiles"
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.user_id", ondelete="CASCADE"), primary_key=True
    )
    name: Mapped[str] = mapped_column(String(40))
    avatar_id: Mapped[str] = mapped_column(String(16))
    color: Mapped[str] = mapped_column(String(7))
    speaking_style: Mapped[str] = mapped_column(String(16))
    setup_step: Mapped[int] = mapped_column(Integer)
    setup_completed: Mapped[bool] = mapped_column(Boolean)
    questionnaire: Mapped[dict] = mapped_column(JSON)
    memory_ids: Mapped[dict] = mapped_column(JSON)
    version: Mapped[int] = mapped_column(Integer)


class SqliteAgentProfileRepository:
    def __init__(self, session):
        self.session = session

    def get(self, user_id: UUID) -> AgentProfile:
        row = self.session.get(AgentProfileRow, str(user_id), populate_existing=True)
        if row is None:
            return AgentProfile(user_id)
        return AgentProfile(
            **{
                key: getattr(row, key)
                for key in AgentProfile.__dataclass_fields__
                if key != "user_id"
            },
            user_id=user_id,
        )

    def save(self, profile: AgentProfile, expected_version: int) -> AgentProfile:
        saved = replace(profile, version=expected_version + 1)
        values = asdict(saved) | {"user_id": str(saved.user_id)}
        if expected_version == 0:
            result = self.session.execute(
                insert(AgentProfileRow).values(**values).on_conflict_do_nothing()
            )
        else:
            result = self.session.execute(
                update(AgentProfileRow)
                .where(
                    AgentProfileRow.user_id == str(saved.user_id),
                    AgentProfileRow.version == expected_version,
                )
                .values(**values)
            )
        if result.rowcount != 1:
            raise ProfileConflict("档案已更新，请刷新后重试")
        self.session.flush()
        return saved
