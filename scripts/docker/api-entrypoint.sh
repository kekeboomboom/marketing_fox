#!/bin/sh
set -eu

data_dir="${MARKETING_FOX_DATA_DIR:-/data/marketing_fox/service-data}"
artifacts_dir="${MARKETING_FOX_ARTIFACTS_DIR:-/data/marketing_fox/artifacts}"
profile_dir="${XHS_PROFILE_DIR:-/data/marketing_fox/xhs-profile}"

mkdir -p "$data_dir" "$artifacts_dir" "$profile_dir"

if [ "${XHS_HEADLESS:-false}" = "false" ] && [ -z "${DISPLAY:-}" ]; then
  display_num="${XHS_XVFB_DISPLAY_NUM:-99}"
  lock_file="/tmp/.X${display_num}-lock"
  xvfb_pid=""
  export DISPLAY=":${display_num}"

  if [ -f "$lock_file" ]; then
    lock_pid="$(cat "$lock_file" 2>/dev/null || true)"
    if [ -n "$lock_pid" ] && kill -0 "$lock_pid" 2>/dev/null; then
      echo "Reusing existing X display $DISPLAY (pid $lock_pid)." >&2
    else
      echo "Removing stale X lock $lock_file before starting Xvfb." >&2
      rm -f "$lock_file"
    fi
  fi

  if [ ! -f "$lock_file" ]; then
    Xvfb "$DISPLAY" -screen 0 "${XHS_XVFB_SCREEN:-1440x1080x24}" -nolisten tcp >/tmp/xvfb.log 2>&1 &
    xvfb_pid=$!
    sleep 1

    if ! kill -0 "$xvfb_pid" 2>/dev/null; then
      echo "Failed to start Xvfb on $DISPLAY." >&2
      if [ -f /tmp/xvfb.log ]; then
        tail -n 50 /tmp/xvfb.log >&2
      fi
      exit 1
    fi
  fi

  echo "Using X display $DISPLAY for Xiaohongshu browser automation." >&2

  cleanup_xvfb() {
    if [ -n "${xvfb_pid:-}" ]; then
      kill "$xvfb_pid" 2>/dev/null || true
    fi
  }
fi

"$@" &
app_pid=$!

terminate() {
  # Forward shutdown to the real app process, then clean up Xvfb.
  kill -TERM "$app_pid" 2>/dev/null || true
  wait "$app_pid" 2>/dev/null || true
  if [ -n "${xvfb_pid:-}" ]; then
    cleanup_xvfb
  fi
}

trap terminate INT TERM

wait "$app_pid"
exit_code=$?

if [ -n "${xvfb_pid:-}" ]; then
  cleanup_xvfb
fi

exit "$exit_code"
