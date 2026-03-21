from marketing_fox.publishing.runner import run_publish


def test_runner_returns_serializable_result() -> None:
    result = run_publish(
        {
            "platform": "x",
            "source_idea": "Ship one strong idea to X with a clean hook",
            "mode": "prepare",
        }
    )

    assert result["status"] == "prepared"
    assert result["draft_artifact"]["platform"] == "x"
    assert result["draft_artifact"]["text"]
    assert result["error"] is None


def test_runner_validates_input() -> None:
    result = run_publish({"platform": "x", "mode": "prepare"})

    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_request"
