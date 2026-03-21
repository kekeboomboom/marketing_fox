from dataclasses import dataclass

from marketing_fox.config import AuthStrategy, PublishTransport


@dataclass(frozen=True)
class ConnectorDescriptor:
    key: str
    display_name: str
    primary_content_type: str
    publish_transport: PublishTransport
    auth_strategy: AuthStrategy
