from dataclasses import replace
from uuid import UUID

from qunxue_api.modules.agent_profile import AgentProfileRepository, ProfileConflict


class AgentProfileApplication:
    def __init__(self, repository: AgentProfileRepository, memories):
        self.repository = repository
        self.memories = memories

    def get(self, user_id):
        return self.repository.get(user_id)

    def update(self, user_id, *, expected_version, changes, request_key):
        current = self.get(user_id)
        if current.version != expected_version:
            raise ProfileConflict("档案已更新，请刷新后重试")
        memory_ids = dict(current.memory_ids)
        questionnaire = changes.get("questionnaire")
        if questionnaire is not None and questionnaire != current.questionnaire:
            existing = {str(m.memory_id): m for m in self.memories.available(user_id, None)}
            for field, label in [
                ("occupation", "我的工作或学习"),
                ("industry", "我所在的领域"),
                ("goals", "希望助手帮忙"),
                ("interests", "我的兴趣"),
            ]:
                answer = questionnaire.get(field, "")
                if isinstance(answer, list):
                    answer = "、".join(answer)
                if not answer:
                    continue
                old_id = memory_ids.get(field)
                old = existing.get(old_id) if old_id else None
                if old_id and old is None:
                    # Respect deletion and disabled recall; a profile edit cannot undo either.
                    continue
                content = f"{label}：{answer}"
                if old and old.content == content:
                    continue
                saved = self.memories.save(
                    user_id=user_id,
                    task_id=None,
                    key=f"onboarding.{field}",
                    content=content,
                    origin="explicit",
                    idempotency_key=f"{request_key}:{field}",
                    memory_id=UUID(old_id) if old_id else None,
                    expected_version=old.version if old else None,
                    source_quote=f"引导问卷 · {label}：{answer}",
                )
                memory_ids[field] = str(saved.memory_id)
        return self.repository.save(
            replace(current, **changes, memory_ids=memory_ids), expected_version
        )

    def greeting(self, user_id):
        profile = self.get(user_id)
        goals = next(
            (
                m.content
                for m in self.memories.available(user_id, None)
                if m.key == "onboarding.goals"
            ),
            "",
        )
        suffix = (
            f"我们可以先从你提到的「{goals.split('：', 1)[-1]}」开始。"
            if goals
            else "想先聊聊什么？"
        )
        return f"你好，我是{profile.name}。{suffix}"
