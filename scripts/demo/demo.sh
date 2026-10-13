#!/usr/bin/env bash
# cc-cost demo: two Claude accounts on one machine, sharing through an SSH server. See README.md.
#   demo.sh up               create the demo machines, sample transcripts and the SSH server, which then
#                            starts with Docker by itself
#   demo.sh demo-pc <args>   run cc-cost as machine "demo-pc" (two accounts: ~/.claude and ~/.claude-work)
#   demo.sh demo-mac <args>  run cc-cost as machine "demo-mac" (one account)
#   demo.sh server           list the files on the SSH server
#   demo.sh server-stop      stop the SSH server, to see how cc-cost copes without it
#   demo.sh server-start     start it again, with its files and host key
#   demo.sh down             stop the server and delete the demo folder
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
DEMO="${TMPDIR:-/tmp}/cc-cost-demo"
PORT="${CC_COST_DEMO_PORT:-2222}"
IMAGE=lscr.io/linuxserver/openssh-server:10.3_p1-r1-ls239
CONTAINER=cc-cost-demo-sshd

# Every path cc-cost looks at points inside the demo machine's home. CC_COST_TASK keeps a schedule
# installed or removed here away from the real "cc-cost" task.
as() {
    local h="$DEMO/$1"; shift
    PATH="$h/bin:$PATH" HOME="$h" USERPROFILE="$h" APPDATA="$h/AppData/Roaming" LOCALAPPDATA="$h/AppData/Local" \
        XDG_CONFIG_HOME="$h/.config" XDG_STATE_HOME="$h/.local/state" OneDrive= OneDriveConsumer= OneDriveCommercial= \
        CLAUDE_CONFIG_DIR= CC_COST_TASK=cc-cost-demo "$@"
}

# Windows may leave system folders (INetCache) in the demo home that rm cannot delete
wipe() {
    rm -rf "$DEMO" 2>/dev/null || MSYS2_ARG_CONV_EXCL="*" cmd /c rmdir /s /q "$(cygpath -w "$DEMO")"
}

# The server holds the public keys of both demo machines. "unless-stopped" brings it back with Docker
# itself (Docker Desktop starting, a reboot), keeping its files and host key; only server-stop keeps it down.
new_server() {
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    docker run -d --restart unless-stopped --name "$CONTAINER" -p "$PORT:2222" -e USER_NAME=pi \
        -e PUBLIC_KEY="$(cat "$DEMO"/*/.ssh/id_ed25519.pub)" "$IMAGE" >/dev/null
    # A new container has a new host key, so each machine's known_hosts starts empty and cc-cost records
    # the key on first contact (StrictHostKeyChecking=accept-new)
    for m in demo-pc demo-mac; do : > "$DEMO/$m/.ssh/known_hosts"; done
    wait_server
}

wait_server() {
    echo "waiting for the SSH server..."
    for _ in $(seq 60); do ssh-keyscan -p "$PORT" 127.0.0.1 >/dev/null 2>&1 && return; sleep 1; done
    echo "the SSH server did not start; see: docker logs $CONTAINER"
    exit 1
}

transcript() { # <claude dir> <model> <calls> <output tokens per call>
    node -e '
        const [dir, model, n, out] = process.argv.slice(1);
        const fs = require("fs"), path = require("path");
        const p = path.join(dir, "projects", "demo-app");
        fs.mkdirSync(p, { recursive: true });
        const now = Date.now(), lines = [];
        for (let i = 0; i < +n; i++) lines.push(JSON.stringify({
            type: "assistant", requestId: `req-${model}-${i}`, sessionId: `s-${model}`, cwd: "/work/demo-app",
            timestamp: new Date(now - i * 36e5).toISOString(),
            message: { id: `msg-${path.basename(dir)}-${model}-${i}`, model, usage: { input_tokens: 2000, output_tokens: +out, cache_read_input_tokens: 50000 } },
        }));
        fs.writeFileSync(path.join(p, `${model}.jsonl`), lines.join("\n") + "\n");
    ' "$@"
}

case "${1:-}" in
up)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    wipe
    for m in demo-pc demo-mac; do
        h="$DEMO/$m"
        mkdir -p "$h/.ssh" "$h/AppData/Roaming/cc-cost" "$h/.config/cc-cost" "$h/bin"
        ssh-keygen -q -t ed25519 -N "" -f "$h/.ssh/id_ed25519"
        # Both demo machines run on this computer, so they would share its hostname as the machine name
        for d in "$h/AppData/Roaming/cc-cost" "$h/.config/cc-cost"; do printf '{"machine":"%s"}\n' "$m" > "$d/config.json"; done
    done
    transcript "$DEMO/demo-pc/.claude" claude-opus-5 12 3000            # personal account
    transcript "$DEMO/demo-pc/.claude-work" claude-sonnet-5 30 1500     # work account
    transcript "$DEMO/demo-mac/.claude" claude-haiku-4-5 40 800
    # Logins, the way Claude Code records them (ids and plan only): demo-pc's ~/.claude is a Max account,
    # its ~/.claude-work and demo-mac's ~/.claude are the same Team seat, so that account spans both machines.
    # The default folder's login sits next to it in ~/.claude.json, another folder's inside it.
    max='{"oauthAccount":{"accountUuid":"demo-max","organizationUuid":"demo-max-org","organizationType":"claude_max","organizationRateLimitTier":"default_claude_max_5x"}}'
    team='{"oauthAccount":{"accountUuid":"demo-team","organizationUuid":"demo-team-org","organizationType":"claude_team","seatTier":"team_tier_1","organizationRateLimitTier":"default_raven","userRateLimitTier":"default_claude_max_5x"}}'
    echo "$max" > "$DEMO/demo-pc/.claude.json"
    echo "$team" > "$DEMO/demo-pc/.claude-work/.claude.json"
    echo "$team" > "$DEMO/demo-mac/.claude.json"
    for m in demo-pc demo-mac; do
        h="$DEMO/$m"
        # "demo-pi" stands for pi@raspberrypi.local and carries the port; the key and known_hosts apply to any
        # address, so ssh://pi@127.0.0.1:2222/cc-cost works as well
        printf 'Host demo-pi\n  HostName 127.0.0.1\n  Port %s\n  User pi\nHost *\n  IdentityFile "%s"\n  UserKnownHostsFile "%s"\n' \
            "$PORT" "$h/.ssh/id_ed25519" "$h/.ssh/known_hosts" > "$h/.ssh/config"
        # ssh on macOS and Linux finds ~/.ssh through the user database, not $HOME: point it at the demo config
        for tool in ssh scp; do
            printf '#!/bin/sh\nexec %s -F "%s" "$@"\n' "$(command -v $tool)" "$h/.ssh/config" > "$h/bin/$tool"
            chmod +x "$h/bin/$tool"
        done
    done
    new_server
    echo "ready: $DEMO"
    ;;
# A schedule would run outside the demo, on your real config and transcripts, so setup never installs one here
demo-pc | demo-mac)
    m=$1; shift
    if [ "${1:-}" = setup ]; then set -- "$@" --no-schedule; fi
    as "$m" node "$REPO/src/cli.ts" "$@"
    ;;
server) as demo-pc ssh -o StrictHostKeyChecking=accept-new demo-pi 'ls -la cc-cost/machines' ;;
server-stop)
    docker stop "$CONTAINER" >/dev/null
    echo "SSH server stopped; it stays down until server-start, Docker restarts included"
    ;;
server-start)
    [ -d "$DEMO/demo-pc" ] || { echo "run: demo.sh up"; exit 1; }
    # the same container, files and host key; a new one only if it was removed
    if docker container inspect "$CONTAINER" >/dev/null 2>&1; then docker start "$CONTAINER" >/dev/null; wait_server; else new_server; fi
    echo "SSH server running on 127.0.0.1:$PORT (demo-pi)"
    ;;
down)
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    # the demo hooks and a cc-cost-demo schedule left by an older version of this script
    [ -d "$DEMO/demo-pc" ] && as demo-pc node "$REPO/src/cli.ts" setup --remove --yes --no-color || true
    wipe
    echo "removed"
    ;;
*) sed -n '2,10p' "$0" ;;
esac
