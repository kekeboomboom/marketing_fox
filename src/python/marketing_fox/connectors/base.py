from dataclasses import dataclass


@dataclass(frozen=True)
class ConnectorDescriptor:
    key: str
    display_name: str
    primary_content_type: str
