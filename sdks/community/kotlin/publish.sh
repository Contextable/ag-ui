#!/usr/bin/env bash

set -euo pipefail

SCRIPT_NAME=$(basename "${BASH_SOURCE[0]}")
REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
LIBRARY_DIR="$REPO_ROOT/library"
GRADLEW="$LIBRARY_DIR/gradlew"

FORCE=false
SKIP_TESTS=false
DRY_RUN=false
EXTRA_ARGS=()

SONATYPE_CENTRAL_NAMESPACE="${SONATYPE_CENTRAL_NAMESPACE:-com.ag-ui.community}"
SONATYPE_CENTRAL_ENDPOINT="${SONATYPE_CENTRAL_ENDPOINT:-https://ossrh-staging-api.central.sonatype.com}"

print_usage() {
    cat <<EOF
Usage: ./publish.sh [options] [-- <extra Gradle args>]

Options:
  --dry-run       Run publishToMavenLocal instead of publishing to OSSRH.
  --skip-tests    Skip the pre-flight "./gradlew clean check".
  --force         Skip the dirty worktree check.
  -h, --help      Show this help message.

Any arguments after "--" are forwarded directly to Gradle.
EOF
}

on_error() {
    local exit_code=$?
    printf '[publish] ERROR: %s failed (exit code %s)\n' "$SCRIPT_NAME" "$exit_code" >&2
    printf '[publish] Inspect the logs above for details.\n' >&2
    exit "$exit_code"
}

trap on_error ERR
trap 'printf "\n[publish] Interrupted.\n" >&2; exit 130' INT

log() {
    printf '[publish] %s\n' "$1"
}

warn() {
    printf '[publish] WARNING: %s\n' "$1" >&2
}

fail() {
    printf '[publish] ERROR: %s\n' "$1" >&2
    exit 1
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run)
            DRY_RUN=true
            ;;
        --skip-tests)
            SKIP_TESTS=true
            ;;
        --force)
            FORCE=true
            ;;
        -h|--help)
            print_usage
            exit 0
            ;;
        --)
            shift
            EXTRA_ARGS+=("$@")
            break
            ;;
        *)
            fail "Unknown option: $1 (run with --help for usage)"
            ;;
    esac
    shift
done

[[ -d "$LIBRARY_DIR" ]] || fail "library directory not found at $LIBRARY_DIR"
[[ -x "$GRADLEW" ]] || fail "Gradle wrapper missing at $GRADLEW (did you clone the repository recursively?)"

ensure_git_clean() {
    if $FORCE; then
        return
    fi

    if ! command -v git >/dev/null 2>&1; then
        warn "git not found; skipping worktree cleanliness check."
        return
    fi

    if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
        git -C "$REPO_ROOT" status --short
        fail "Worktree has uncommitted changes. Commit/stash them or pass --force."
    fi
}

detect_version() {
    local version_file="$REPO_ROOT/build.gradle.kts"
    if [[ -f "$version_file" ]]; then
        local line
        line=$(grep -E '^[[:space:]]*version[[:space:]]*=' "$version_file" | head -n1 || true)
        if [[ -n "$line" ]]; then
            echo "$line" | sed -E 's/.*version[[:space:]]*=[[:space:]]*"([^"]+)".*/\1/'
            return
        fi
    fi

    echo "unknown"
}

require_credentials() {
    if $DRY_RUN; then
        warn "Dry-run selected; skipping OSSRH credential check."
        return
    fi

    local required_vars=(
        ORG_GRADLE_PROJECT_signingKey
        ORG_GRADLE_PROJECT_signingPassword
        ORG_GRADLE_PROJECT_ossrhUsername
        ORG_GRADLE_PROJECT_ossrhPassword
    )
    local missing=()

    for var in "${required_vars[@]}"; do
        if [[ -z "${!var:-}" ]]; then
            missing+=("$var")
        fi
    done

    if ((${#missing[@]} > 0)); then
        printf '[publish] The following environment variables are required:\n' >&2
        for var in "${missing[@]}"; do
            printf '  - %s\n' "$var" >&2
        done
        printf '[publish] Set them via your shell or GitHub Actions secrets. Refer to library/gradle.properties for the expected values.\n' >&2
        exit 1
    fi
}

run_gradle() {
    (cd "$LIBRARY_DIR" && "$GRADLEW" "$@")
}

notify_sonatype_central() {
    if ! command -v curl >/dev/null 2>&1; then
        warn "curl not found; cannot notify Sonatype Central. Upload will remain pending."
        return
    fi

    local username="${OSSRH_USERNAME:-${ORG_GRADLE_PROJECT_ossrhUsername:-}}"
    local password="${OSSRH_PASSWORD:-${ORG_GRADLE_PROJECT_ossrhPassword:-}}"

    if [[ -z "$username" || -z "$password" ]]; then
        warn "OSSRH credentials missing; cannot notify Sonatype Central. Set OSSRH_USERNAME/OSSRH_PASSWORD."
        return
    fi

    local search_url="${SONATYPE_CENTRAL_ENDPOINT%/}/manual/search/repositories?ip=any&profile_id=${SONATYPE_CENTRAL_NAMESPACE}"
    log "Querying Sonatype for open repository (GET ${search_url})"

    local curl_output curl_exit
    set +e
    curl_output=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" -u "$username:$password" "$search_url" 2>&1)
    curl_exit=$?
    set -e

    if [[ $curl_exit -ne 0 ]]; then
        warn "Repository search failed (exit $curl_exit). Raw output:"
        printf '%s\n' "$curl_output"
        return
    fi

    local body status repo_key
    status=$(echo "$curl_output" | awk -F'HTTP_STATUS:' 'NF>1 {print $2}' | tail -n1)
    body=$(echo "$curl_output" | sed -e 's/HTTP_STATUS:.*//')

    log "Repository search status: ${status:-unknown}"
    if [[ -n "${body// }" ]]; then
        log "Repository search response body:"
        printf '%s\n' "$body"
    fi

    if [[ "$status" != "200" ]]; then
        warn "Unexpected status from repository search ($status); aborting notification."
        return
    fi

    repo_key=$(echo "$body" | jq -r 'first(.repositories[] | select(.state == "open" and .key)) | .key')
    printf '%s\n' "$repo_key"

    if [[ -z "$repo_key" ]]; then
        warn "No open repository found for namespace ${SONATYPE_CENTRAL_NAMESPACE}; upload may require manual completion."
        return
    fi

    local notify_url="${SONATYPE_CENTRAL_ENDPOINT%/}/manual/upload/repository/${repo_key}"
    log "Notifying Sonatype to finalize repository ${repo_key} (POST ${notify_url})"

    #Note : This *should* automatically publish the artifacts.  Change publishing_type to 'user_managed' if you want to review before publishing.
    # I say *should* because it doesn't actually seem to work that way; it leaves the artifacts in a "Validated" state and
    # someone still needs to login to Maven Central and publish them manually.
    set +e
    curl_output=$(curl -sS -w "\nHTTP_STATUS:%{http_code}" -u "$username:$password" -X POST "$notify_url" -H "Content-Type: application/json" -d '{"publishing_type":"automatic"}' 2>&1)
    curl_exit=$?
    set -e

    if [[ $curl_exit -ne 0 ]]; then
        warn "Repository finalize request failed (exit $curl_exit). Raw output:"
        printf '%s\n' "$curl_output"
        return
    fi

    status=$(echo "$curl_output" | awk -F'HTTP_STATUS:' 'NF>1 {print $2}' | tail -n1)
    body=$(echo "$curl_output" | sed -e 's/HTTP_STATUS:.*//')

    log "Repository finalize status: ${status:-unknown}"
    if [[ -n "${body// }" ]]; then
        log "Repository finalize response body:"
        printf '%s\n' "$body"
    fi

    if [[ "$status" == "200" || "$status" == "204" ]]; then
        log "Sonatype Central upload marked complete for repository ${repo_key}."
    else
        warn "Sonatype finalize returned unexpected status $status. Please verify manually."
    fi
}

ensure_git_clean
require_credentials

VERSION=$(detect_version)
log "Preparing to publish version $VERSION"

GRADLE_BASE_ARGS=(--stacktrace --no-daemon)

if ! $SKIP_TESTS; then
    log "Running verification: ./gradlew clean check"
    run_gradle "${GRADLE_BASE_ARGS[@]}" clean check
else
    warn "Skipping clean check (requested via --skip-tests)."
fi

if $DRY_RUN; then
    log "Dry-run enabled: executing publishToMavenLocal"
    PUBLISH_TASK="publishToMavenLocal"
else
    PUBLISH_TASK="publish"
fi

if [[ ${#EXTRA_ARGS[@]} -gt 0 ]]; then
    log "Running ./gradlew $PUBLISH_TASK ${EXTRA_ARGS[*]}"
    run_gradle "${GRADLE_BASE_ARGS[@]}" "$PUBLISH_TASK" "${EXTRA_ARGS[@]}"
else
    log "Running ./gradlew $PUBLISH_TASK"
    run_gradle "${GRADLE_BASE_ARGS[@]}" "$PUBLISH_TASK"
fi

if $DRY_RUN; then
    log "Dry-run complete. Artifacts available in your local Maven cache."
else
    log "Publish complete. Check Sonatype staging repositories to release version $VERSION."
    notify_sonatype_central
fi
