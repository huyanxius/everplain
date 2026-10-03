"""A user's companion identity and resumable welcome journey."""

from dataclasses import dataclass, field
from typing import Protocol
from uuid import UUID

AVATAR_IDS = ("cheng", "nian", "qi", "shi", "heng", "ruo", "you")
STYLES = {
    "clear": "清晰直接，先给结论，再给必要依据",
    "warm": "温和自然，认真倾听，用具体建议帮助用户",
    "rigorous": "严谨细致，区分事实和推断，引用资料时给出来源",
    "curious": "好奇开放，帮助用户探索关联与不同解释",
}


@dataclass(frozen=True)
class AgentProfile:
    user_id: UUID
    name: str = "Everplain"
    avatar_id: str = "cheng"
    color: str = "#b8bfa6"
    speaking_style: str = "clear"
    setup_step: int = 0
    setup_completed: bool = False
    questionnaire: dict = field(default_factory=dict)
    memory_ids: dict = field(default_factory=dict)
    version: int = 0
    soul_text: str = ""

    def persona(self) -> dict:
        # Raw questionnaire is deliberately absent: forgotten memories stay forgotten.
        persona = {"name": self.name, "style": STYLES[self.speaking_style]}
        if self.soul_text:
            persona["soul_text"] = self.soul_text
        return persona


class ProfileConflict(ValueError):
    pass


class AgentProfileRepository(Protocol):
    def get(self, user_id: UUID) -> AgentProfile: ...
    def save(self, profile: AgentProfile, expected_version: int) -> AgentProfile: ...
