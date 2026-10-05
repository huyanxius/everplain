"""用户身份、密码验证与服务端会话边界。"""

from qunxue_api.modules.identity.domain import (
    AccountRole,
    AccountStatus,
    AuthenticatedSession,
    FederatedIdentity,
    RegistrationVerification,
    SessionGrant,
    User,
    UserSession,
)
from qunxue_api.modules.identity.errors import (
    EmailAlreadyRegistered,
    EmailDeliveryUnavailable,
    FederatedIdentityConflict,
    IdentityError,
    InvalidCredentials,
    InvalidEmail,
    InvalidVerificationCode,
    Unauthenticated,
    VerificationCodeRateLimited,
)
from qunxue_api.modules.identity.ports import EmailProvider, IdentityRepository, PasswordHasher
from qunxue_api.modules.identity.service import IdentityService

__all__ = [
    "AccountRole",
    "AccountStatus",
    "AuthenticatedSession",
    "EmailAlreadyRegistered",
    "FederatedIdentity",
    "FederatedIdentityConflict",
    "EmailDeliveryUnavailable",
    "EmailProvider",
    "IdentityError",
    "IdentityRepository",
    "IdentityService",
    "InvalidCredentials",
    "InvalidEmail",
    "InvalidVerificationCode",
    "PasswordHasher",
    "SessionGrant",
    "RegistrationVerification",
    "Unauthenticated",
    "User",
    "UserSession",
    "VerificationCodeRateLimited",
]
