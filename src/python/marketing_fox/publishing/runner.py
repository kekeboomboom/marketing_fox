from __future__ import annotations

import json
import sys

from .models import DraftArtifact, PublishError, PublishIntent, PublishResult
from .service import PublishingService


def run_publish(payload: dict[str, object]) -> dict[str, object]:
    try:
        intent = PublishIntent.from_dict(payload)
    except ValueError as error:
        platform = str(payload.get("platform", "x"))
        if platform not in {"x", "xiaohongshu", "wechat_official_account"}:
            platform = "x"

        mode = str(payload.get("mode", "prepare"))
        if mode not in {"prepare", "draft", "publish"}:
            mode = "prepare"

        result = PublishResult(
            platform=platform,
            mode=mode,
            status="failed",
            draft_artifact=DraftArtifact(platform=platform),
            logs=[f"Rejected publish payload during validation: {error}"],
            screenshots=[],
            error=PublishError(code="invalid_request", message=str(error)),
        )
        return result.to_dict()

    service = PublishingService()
    return service.run(intent).to_dict()


def main() -> None:
    raw_payload = sys.stdin.read().strip()
    payload = json.loads(raw_payload) if raw_payload else {}
    result = run_publish(payload)
    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
