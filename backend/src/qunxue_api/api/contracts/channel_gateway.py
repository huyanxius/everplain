from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class ChannelContract(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class ChannelGatewayInfoResponse(ChannelContract):
    gateway_id: str
    platform: Literal["telegram", "feishu"]
    name: str
    bot_url: str | None = None


class ChannelLinkCodeRequest(ChannelContract):
    gateway_id: str = Field(min_length=1, max_length=200)
    acknowledge_private_data_and_usage: Literal[True]


class ChannelLinkCodeResponse(ChannelContract):
    code: str
    expires_at: int
    gateway_id: str


class ChannelBindingResponse(ChannelContract):
    binding_id: UUID
    gateway_id: str
    subject_id: str
    created_at: int


class ChannelDispatchRequest(ChannelContract):
    platform: Literal["telegram", "feishu"]
    bot_id: str = Field(min_length=1, max_length=100)
    tenant_id: str = Field(default="", max_length=100)
    event_id: str = Field(min_length=1, max_length=200)
    subject_id: str = Field(min_length=1, max_length=200)
    chat_id: str = Field(min_length=1, max_length=200)
    thread_id: str = Field(default="", max_length=200)
    chat_type: Literal["private", "group"]
    occurred_at: int = Field(ge=0, strict=True)
    received_at_ms: int = Field(ge=0, strict=True)
    text: str = Field(min_length=1, max_length=16000)

    @model_validator(mode="after")
    def validate_tenant(self):
        if (self.platform == "feishu" and not self.tenant_id) or (
            self.platform == "telegram" and self.tenant_id
        ):
            raise ValueError("Feishu needs an explicit tenant; Telegram must have none")
        return self


class ChannelDispatchResponse(ChannelContract):
    event_key: str
    text: str | None = None
    state: Literal["complete", "processing", "retryable"] = "complete"
    cursor: int = Field(default=0, ge=0)


class ChannelDeliveryResponse(ChannelContract):
    allowed: bool
