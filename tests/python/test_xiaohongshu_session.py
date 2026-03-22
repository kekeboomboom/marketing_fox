from marketing_fox.publishing.xiaohongshu_session import run_xiaohongshu_session


def test_xiaohongshu_session_runner_validates_action() -> None:
    result = run_xiaohongshu_session({"action": "nope"})

    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_request"


def test_xiaohongshu_session_runner_validates_options() -> None:
    result = run_xiaohongshu_session({"action": "check", "options": "bad"})

    assert result["status"] == "failed"
    assert result["error"]["code"] == "invalid_request"
