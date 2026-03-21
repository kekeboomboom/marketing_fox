from __future__ import annotations

import json
import mimetypes
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class HttpResponse:
    status_code: int
    payload: dict[str, Any]


class HttpClient(Protocol):
    def get_json(self, url: str, params: dict[str, Any] | None = None) -> HttpResponse: ...

    def post_json(
        self, url: str, payload: dict[str, Any], params: dict[str, Any] | None = None
    ) -> HttpResponse: ...

    def post_multipart(
        self,
        url: str,
        files: dict[str, str],
        fields: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
    ) -> HttpResponse: ...


class StdlibHttpClient:
    def get_json(self, url: str, params: dict[str, Any] | None = None) -> HttpResponse:
        final_url = self._with_params(url, params)
        request = Request(final_url, method="GET")
        return self._send(request)

    def post_json(
        self, url: str, payload: dict[str, Any], params: dict[str, Any] | None = None
    ) -> HttpResponse:
        final_url = self._with_params(url, params)
        body = json.dumps(payload).encode("utf-8")
        request = Request(
            final_url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        return self._send(request)

    def post_multipart(
        self,
        url: str,
        files: dict[str, str],
        fields: dict[str, str] | None = None,
        params: dict[str, Any] | None = None,
    ) -> HttpResponse:
        final_url = self._with_params(url, params)
        boundary = f"marketing-fox-{uuid.uuid4().hex}"
        body = bytearray()

        for key, value in (fields or {}).items():
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(
                f'Content-Disposition: form-data; name="{key}"\r\n\r\n{value}\r\n'.encode(
                    "utf-8"
                )
            )

        for field_name, file_path in files.items():
            path = Path(file_path)
            mime_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
            file_bytes = path.read_bytes()
            body.extend(f"--{boundary}\r\n".encode("utf-8"))
            body.extend(
                (
                    f'Content-Disposition: form-data; name="{field_name}"; '
                    f'filename="{path.name}"\r\n'
                    f"Content-Type: {mime_type}\r\n\r\n"
                ).encode("utf-8")
            )
            body.extend(file_bytes)
            body.extend(b"\r\n")

        body.extend(f"--{boundary}--\r\n".encode("utf-8"))
        request = Request(
            final_url,
            data=bytes(body),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
            method="POST",
        )
        return self._send(request)

    def _with_params(self, url: str, params: dict[str, Any] | None) -> str:
        if not params:
            return url
        return f"{url}?{urlencode(params, doseq=True)}"

    def _send(self, request: Request) -> HttpResponse:
        try:
            with urlopen(request) as response:
                payload = _parse_json_bytes(response.read())
                return HttpResponse(status_code=response.status, payload=payload)
        except HTTPError as error:
            payload = _parse_json_bytes(error.read())
            return HttpResponse(status_code=error.code, payload=payload)
        except URLError as error:
            return HttpResponse(
                status_code=599,
                payload={"errcode": "network_error", "errmsg": str(error.reason)},
            )


def _parse_json_bytes(raw_payload: bytes) -> dict[str, Any]:
    try:
        decoded = raw_payload.decode("utf-8")
        payload = json.loads(decoded)
        if isinstance(payload, dict):
            return payload
    except (UnicodeDecodeError, json.JSONDecodeError):
        pass
    return {"errcode": "invalid_json_response", "errmsg": "Upstream did not return JSON."}
