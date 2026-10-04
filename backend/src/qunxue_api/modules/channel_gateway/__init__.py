"""Transport-neutral identities. Channel input never chooses an Everplain user or resource."""

import hashlib
import json
from dataclasses import asdict, dataclass


class GatewayDenied(Exception):
    pass


class GatewayConflict(Exception):
    pass


class GatewayBusy(Exception):
    pass


@dataclass(frozen=True, slots=True)
class ChannelEvent:
    platform: str
    bot_id: str
    tenant_id: str
    event_id: str
    subject_id: str
    chat_id: str
    thread_id: str
    chat_type: str
    occurred_at: int
    received_at_ms: int
    text: str

    @property
    def gateway_id(self):
        suffix = f":{self.tenant_id}" if self.platform == "feishu" else ""
        return f"{self.platform}:{self.bot_id}{suffix}"

    @property
    def identity_key(self):
        return digest([self.platform, self.bot_id, self.tenant_id, self.subject_id])

    @property
    def event_key(self):
        return digest([self.platform, self.bot_id, self.tenant_id, self.event_id])

    @property
    def payload_hash(self):
        return digest(asdict(self))

    def scope_key(self, binding_id):
        return digest(
            [
                self.platform,
                self.bot_id,
                self.tenant_id,
                binding_id,
                self.subject_id,
                self.chat_type,
                self.chat_id,
                self.thread_id,
            ]
        )


def digest(value):
    return hashlib.sha256(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
