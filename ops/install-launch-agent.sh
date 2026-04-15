#!/bin/bash
set -euo pipefail

LABEL="com.ryan.cli-claw"
CWD="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="${HOME}/.cli-claw/ops/launchd"
STDOUT_PATH="${LOG_DIR}/cli-claw.stdout.log"
STDERR_PATH="${LOG_DIR}/cli-claw.stderr.log"
SUBCOMMAND="install"

build_launch_path() {
  local current_path="${PATH:-/usr/bin:/bin:/usr/sbin:/sbin}"
  local -a current_segments=()
  local -a merged_segments=()
  local -a deduped_segments=()
  local segment
  local existing

  IFS=':' read -r -a current_segments <<< "${current_path}"
  merged_segments=(
    "${current_segments[@]}"
    "${HOME}/.bun/bin"
    "/opt/homebrew/bin"
    "/usr/local/bin"
  )

  for segment in "${merged_segments[@]}"; do
    [[ -n "${segment}" ]] || continue
    local duplicate=0
    if [[ ${#deduped_segments[@]} -gt 0 ]]; then
      for existing in "${deduped_segments[@]}"; do
        if [[ "${existing}" == "${segment}" ]]; then
          duplicate=1
          break
        fi
      done
    fi
    [[ ${duplicate} -eq 1 ]] && continue
    deduped_segments+=("${segment}")
  done

  if [[ ${#deduped_segments[@]} -eq 0 ]]; then
    printf '%s' "${current_path}"
    return
  fi

  local joined=""
  for segment in "${deduped_segments[@]}"; do
    if [[ -n "${joined}" ]]; then
      joined="${joined}:"
    fi
    joined="${joined}${segment}"
  done
  printf '%s' "${joined}"
}

xml_escape() {
  local value="$1"
  value="${value//&/&amp;}"
  value="${value//</&lt;}"
  value="${value//>/&gt;}"
  value="${value//\"/&quot;}"
  value="${value//\'/&apos;}"
  printf '%s' "$value"
}

usage() {
  cat <<'EOF'
Usage:
  ops/install-launch-agent.sh install [--label LABEL] [--cwd DIR] [--stdout PATH] [--stderr PATH] [-- COMMAND [ARGS...]]
  ops/install-launch-agent.sh status [--label LABEL]
  ops/install-launch-agent.sh uninstall [--label LABEL]

Defaults:
  install without COMMAND uses: $(command -v bun) src/index.ts

Examples:
  ops/install-launch-agent.sh install -- /Users/ryan/.bun/bin/bun src/index.ts
  ops/install-launch-agent.sh status
  ops/install-launch-agent.sh uninstall
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    install|status|uninstall)
      SUBCOMMAND="$1"
      shift
      ;;
    --label)
      LABEL="$2"
      shift 2
      ;;
    --cwd)
      CWD="$2"
      shift 2
      ;;
    --stdout)
      STDOUT_PATH="$2"
      shift 2
      ;;
    --stderr)
      STDERR_PATH="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    --)
      shift
      break
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

PLIST_PATH="${HOME}/Library/LaunchAgents/${LABEL}.plist"
SERVICE_NAME="gui/$(id -u)/${LABEL}"
LAUNCH_PATH="$(build_launch_path)"

print_status() {
  if [[ ! -f "${PLIST_PATH}" ]]; then
    echo "LaunchAgent not installed: ${PLIST_PATH}"
    exit 1
  fi

  echo "Plist: ${PLIST_PATH}"
  launchctl print "${SERVICE_NAME}" | sed -n '1,80p'
}

if [[ "${SUBCOMMAND}" == "status" ]]; then
  print_status
  exit 0
fi

if [[ "${SUBCOMMAND}" == "uninstall" ]]; then
  launchctl bootout "${SERVICE_NAME}" >/dev/null 2>&1 || true
  rm -f "${PLIST_PATH}"
  echo "Removed ${PLIST_PATH}"
  exit 0
fi

mkdir -p "${HOME}/Library/LaunchAgents" "${LOG_DIR}"

if [[ $# -eq 0 ]]; then
  if ! command -v bun >/dev/null 2>&1; then
    echo "bun not found in PATH; pass an explicit launch command after --" >&2
    exit 2
  fi
  PROGRAM_ARGS=("$(command -v bun)" "src/index.ts")
else
  PROGRAM_ARGS=("$@")
fi

TMP_PLIST="$(mktemp "${TMPDIR:-/tmp}/cli-claw-launchd.XXXXXX.plist")"
{
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "${LABEL}")</string>
  <key>ProgramArguments</key>
  <array>
EOF
  for arg in "${PROGRAM_ARGS[@]}"; do
    printf '    <string>%s</string>\n' "$(xml_escape "${arg}")"
  done
  cat <<EOF
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "${CWD}")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "${LAUNCH_PATH}")</string>
    <key>CLI_CLAW_LAUNCHD_SERVICE_NAME</key>
    <string>$(xml_escape "${SERVICE_NAME}")</string>
  </dict>
  <key>StandardOutPath</key>
  <string>$(xml_escape "${STDOUT_PATH}")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "${STDERR_PATH}")</string>
</dict>
</plist>
EOF
} > "${TMP_PLIST}"

mv "${TMP_PLIST}" "${PLIST_PATH}"

launchctl bootout "${SERVICE_NAME}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "${PLIST_PATH}"
launchctl kickstart -k "${SERVICE_NAME}"

echo "Installed ${PLIST_PATH}"
print_status
