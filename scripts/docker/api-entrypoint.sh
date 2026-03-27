#!/bin/sh
set -eu

data_dir="${MARKETING_FOX_DATA_DIR:-/data/marketing_fox/service-data}"
artifacts_dir="${MARKETING_FOX_ARTIFACTS_DIR:-/data/marketing_fox/artifacts}"
profile_dir="${XHS_PROFILE_DIR:-/data/marketing_fox/xhs-profile}"

mkdir -p "$data_dir" "$artifacts_dir" "$profile_dir"

if [ "${XHS_HEADLESS:-false}" = "false" ] && [ -z "${DISPLAY:-}" ]; then
  export DISPLAY=:99
  Xvfb "$DISPLAY" -screen 0 "${XHS_XVFB_SCREEN:-1440x1080x24}" -nolisten tcp >/tmp/xvfb.log 2>&1 &
  xvfb_pid=$!

  cleanup_xvfb() {
    kill "$xvfb_pid" 2>/dev/null || true
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
