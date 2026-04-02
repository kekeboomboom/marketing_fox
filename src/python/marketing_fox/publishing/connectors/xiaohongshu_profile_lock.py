from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import fcntl
import json
import os
from pathlib import Path
import socket
from typing import Any, Iterator, Literal

ProfileAction = Literal["check", "login", "publish"]


@dataclass(frozen=True)
class XiaohongshuProfileLease:
    profile_dir: Path
    lock_path: Path
    action: ProfileAction
    holder_host: str | None
    holder_pid: int | None
    current_host: str
    current_pid: int


class XiaohongshuProfileBusyError(RuntimeError):
    def __init__(self, lease: XiaohongshuProfileLease):
        holder = []
        if lease.holder_host:
            holder.append(f"host={lease.holder_host}")
        if lease.holder_pid is not None:
            holder.append(f"pid={lease.holder_pid}")
        holder_text = f" ({', '.join(holder)})" if holder else ""
        message = (
            "Another browser session is already using the Xiaohongshu profile directory "
            f"{lease.profile_dir}.{holder_text}"
        )
        super().__init__(message)
        self.lease = lease


@dataclass(frozen=True)
class ChromiumSingletonState:
    profile_dir: Path
    lock_path: Path
    exists: bool
    raw_target: str
    holder_host: str | None
    holder_pid: int | None
    current_host: str


def acquire_xiaohongshu_profile_lease(profile_dir: Path, action: ProfileAction) -> Iterator[XiaohongshuProfileLease]:
    return _acquire_profile_lease(profile_dir, action)


@contextmanager
def _acquire_profile_lease(profile_dir: Path, action: ProfileAction) -> Iterator[XiaohongshuProfileLease]:
    profile_dir.mkdir(parents=True, exist_ok=True)
    lock_path = profile_dir / ".marketing_fox_profile.lock"
    current_host = socket.gethostname()
    current_pid = os.getpid()
    handle = lock_path.open("a+", encoding="utf-8")

    try:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            lease = _read_profile_lease(lock_path, profile_dir=profile_dir, action=action)
            raise XiaohongshuProfileBusyError(lease) from error

        payload = {
            "action": action,
            "host": current_host,
            "pid": current_pid,
            "profile_dir": str(profile_dir),
            "acquired_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        }
        handle.seek(0)
        handle.truncate()
        handle.write(json.dumps(payload, ensure_ascii=False))
        handle.flush()
        os.fsync(handle.fileno())

        yield XiaohongshuProfileLease(
            profile_dir=profile_dir,
            lock_path=lock_path,
            action=action,
            holder_host=current_host,
            holder_pid=current_pid,
            current_host=current_host,
            current_pid=current_pid,
        )
    finally:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
        except OSError:
            pass
        handle.close()


def read_xiaohongshu_profile_lease(profile_dir: Path, action: ProfileAction) -> XiaohongshuProfileLease:
    lock_path = profile_dir / ".marketing_fox_profile.lock"
    return _read_profile_lease(lock_path, profile_dir=profile_dir, action=action)


def _read_profile_lease(lock_path: Path, *, profile_dir: Path, action: ProfileAction) -> XiaohongshuProfileLease:
    holder_host: str | None = None
    holder_pid: int | None = None

    try:
        payload = json.loads(lock_path.read_text(encoding="utf-8") or "{}")
    except (OSError, json.JSONDecodeError):
        payload = {}

    raw_host = payload.get("host")
    if isinstance(raw_host, str) and raw_host.strip():
        holder_host = raw_host.strip()

    raw_pid = payload.get("pid")
    try:
        holder_pid = int(raw_pid) if raw_pid is not None else None
    except (TypeError, ValueError):
        holder_pid = None

    return XiaohongshuProfileLease(
        profile_dir=profile_dir,
        lock_path=lock_path,
        action=action,
        holder_host=holder_host,
        holder_pid=holder_pid,
        current_host=socket.gethostname(),
        current_pid=os.getpid(),
    )


def inspect_chromium_singleton(profile_dir: Path) -> ChromiumSingletonState:
    lock_path = profile_dir / "SingletonLock"
    raw_target = _read_singleton_lock_target(lock_path)
    holder_host, holder_pid = _parse_singleton_lock_target(raw_target)
    return ChromiumSingletonState(
        profile_dir=profile_dir,
        lock_path=lock_path,
        exists=lock_path.exists() or lock_path.is_symlink(),
        raw_target=raw_target,
        holder_host=holder_host,
        holder_pid=holder_pid,
        current_host=socket.gethostname(),
    )


def classify_xiaohongshu_profile_error(
    error: Exception,
    *,
    action: ProfileAction,
    profile_dir: Path,
    stale_lock_removed: bool,
    default_code: str,
) -> tuple[str, str, list[str]]:
    if isinstance(error, XiaohongshuProfileBusyError):
        lease = error.lease
        message = (
            "Another browser session is already using the Xiaohongshu profile directory. "
            "Wait for the active check, login, or publish run to finish before retrying."
        )
        logs = [
            f"Xiaohongshu profile lease is busy for action={action}.",
            f"profile_dir={lease.profile_dir}",
            f"lease_lock_path={lease.lock_path}",
            f"lease_holder_host={lease.holder_host or '<unknown>'}",
            f"lease_holder_pid={lease.holder_pid if lease.holder_pid is not None else '<unknown>'}",
            f"lease_current_host={lease.current_host}",
            f"lease_current_pid={lease.current_pid}",
        ]
        return "profile_busy", message, logs

    text = str(error)
    if "ProcessSingleton" not in text and "SingletonLock" not in text:
        return default_code, text, []

    singleton = inspect_chromium_singleton(profile_dir)
    logs = [
        "Chromium reported a ProcessSingleton conflict while opening the Xiaohongshu profile.",
        f"profile_dir={profile_dir}",
        f"stale_singleton_removed={'true' if stale_lock_removed else 'false'}",
        f"singleton_lock_exists={'true' if singleton.exists else 'false'}",
        f"singleton_lock_path={singleton.lock_path}",
        f"singleton_lock_host={singleton.holder_host or '<unknown>'}",
        f"singleton_lock_pid={singleton.holder_pid if singleton.holder_pid is not None else '<unknown>'}",
        f"singleton_current_host={singleton.current_host}",
    ]
    if singleton.raw_target:
        logs.append(f"singleton_lock_target={singleton.raw_target}")

    message = (
        "Chromium could not open the Xiaohongshu profile directory because another Chromium process "
        "appears to be using it. Stop the competing process and retry."
    )
    return "profile_busy", message, logs


def clear_stale_profile_singleton(profile_dir: Path) -> bool:
    lock_path = profile_dir / "SingletonLock"
    cookie_path = profile_dir / "SingletonCookie"
    socket_path = profile_dir / "SingletonSocket"

    if not lock_path.exists() and not lock_path.is_symlink():
        return False

    raw_target = _read_singleton_lock_target(lock_path)
    lock_host, lock_pid = _parse_singleton_lock_target(raw_target)
    current_host = socket.gethostname()

    if lock_host and lock_host == current_host and lock_pid is not None:
        try:
            os.kill(lock_pid, 0)
            return False
        except OSError:
            pass

    for path in (lock_path, cookie_path, socket_path):
        try:
            path.unlink()
        except FileNotFoundError:
            continue
        except OSError:
            continue

    return True


def _read_singleton_lock_target(lock_path: Path) -> str:
    if lock_path.is_symlink():
        try:
            return os.readlink(lock_path)
        except OSError:
            return ""

    try:
        return lock_path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def _parse_singleton_lock_target(raw_target: str) -> tuple[str | None, int | None]:
    normalized = raw_target.strip()
    if not normalized:
        return None, None

    if "-" not in normalized:
        return None, None

    host, pid_raw = normalized.rsplit("-", 1)
    try:
        pid = int(pid_raw)
    except ValueError:
        return host or None, None

    return host or None, pid
