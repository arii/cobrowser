#!/bin/sh
# Container entrypoint: supervise the CDP forwarder next to Chromium so a
# container restart (restart: unless-stopped) never leaves DevTools reachable
# on loopback only. Chromium ignores --remote-debugging-address; the forwarder
# re-exposes 127.0.0.1:9222 on 0.0.0.0:9223. Flags arrive via compose command.
set -eu
nohup python3 /opt/cdp-forward.py >/tmp/cdp-forward.log 2>&1 &
exec /usr/bin/chromium "$@"
