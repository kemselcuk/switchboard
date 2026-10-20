#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="switchboard-smoke"
PORT="3101"
BASE_URL="http://127.0.0.1:${PORT}"
TOKEN="smoke-token"

COMPOSE=(docker compose -p "$PROJECT_NAME")

# The smoke test must never use the real token from .env. Exported variables
# take precedence over .env values during Compose interpolation.
export ADMIN_TOKEN="$TOKEN"
export PORT
export POSTGRES_PORT="55433"
export POSTGRES_PASSWORD="smoke-postgres"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

cleanup() {
  local status=$?
  trap - EXIT

  if (( status != 0 )); then
    echo
    echo "FAIL: smoke test exited with ${status}; container logs:"
    "${COMPOSE[@]}" logs --no-color || true
  fi

  echo
  echo "\$ docker compose -p ${PROJECT_NAME} down -v"
  "${COMPOSE[@]}" down -v || true

  exit "$status"
}
trap cleanup EXIT

run() {
  echo "\$ $*"
  "$@"
}

health_check() {
  node --input-type=module -e '
    const response = await fetch(process.argv[1]);
    if (!response.ok) {
      process.exit(1);
    }
  ' "$BASE_URL/healthz" 2>/dev/null
}

wait_for_health() {
  local deadline=$((SECONDS + 30))

  until health_check; do
    if (( SECONDS >= deadline )); then
      echo "FAIL: /healthz did not become healthy within 30s" >&2
      return 1
    fi
    sleep 1
  done

  local body
  body=$(node --input-type=module -e '
    const response = await fetch(process.argv[1]);
    process.stdout.write(await response.text());
  ' "$BASE_URL/healthz")
  echo "health: ${body}"
}

request() {
  local method=$1
  local path=$2
  local body=${3:-}

  node --input-type=module -e '
    const [method, url, token, body] = process.argv.slice(1);
    const headers = { authorization: `Bearer ${token}` };

    if (body) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(url, {
      method,
      headers,
      body: body || undefined,
    });
    const text = await response.text();

    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${text}`);
      process.exit(1);
    }

    console.log(text);
  ' "$method" "$BASE_URL$path" "$TOKEN" "$body"
}

json_value() {
  node -e '
    const data = JSON.parse(process.argv[1]);
    const value = process.argv[2]
      .split(".")
      .reduce((current, key) => (current == null ? undefined : current[key]), data);
    process.stdout.write(String(value ?? ""));
  ' "$1" "$2"
}

expect_equal() {
  local label=$1
  local expected=$2
  local actual=$3

  if [[ "$expected" != "$actual" ]]; then
    echo "FAIL: ${label}: expected ${expected}, got ${actual}" >&2
    return 1
  fi

  echo "OK: ${label} = ${actual}"
}

evaluate_user() {
  request POST /api/evaluate '{"flagKey":"smoke-flag","userId":"user-123"}'
}

ofrep_evaluate() {
  node --input-type=module -e '
    const [base, key, flag, user] = process.argv.slice(1);
    const response = await fetch(`${base}/ofrep/v1/evaluate/flags/${flag}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
      },
      body: JSON.stringify({ context: { targetingKey: user } }),
    });
    const text = await response.text();

    if (!response.ok) {
      console.error(`HTTP ${response.status}: ${text}`);
      process.exit(1);
    }

    console.log(text);
  ' "$BASE_URL" "$1" "$2" "$3"
}

echo "Switchboard Docker smoke test"
echo "Project: ${PROJECT_NAME}"
echo "Base URL: ${BASE_URL}"
echo "Token: smoke-only (${TOKEN})"

echo
echo "== 1. Clean start =="
run "${COMPOSE[@]}" down -v

echo
echo "== 2. Build and start =="
run "${COMPOSE[@]}" up -d --build

echo
echo "== 3. Wait for health =="
wait_for_health

echo
echo "== 4. Create flag =="
create_response=$(request POST /api/flags \
  '{"key":"smoke-flag","description":"Docker smoke test","enabled":true,"rolloutPercentage":20}')
echo "create: ${create_response}"
expect_equal "create.key" "smoke-flag" "$(json_value "$create_response" key)"
expect_equal "create.enabled" "true" "$(json_value "$create_response" enabled)"
expect_equal "create.rolloutPercentage" "20" "$(json_value "$create_response" rolloutPercentage)"

echo
echo "== 5. Evaluate user-123 =="
first_evaluation=$(evaluate_user)
echo "evaluate: ${first_evaluation}"
first_bucket=$(json_value "$first_evaluation" bucket)
first_enabled=$(json_value "$first_evaluation" enabled)
first_reason=$(json_value "$first_evaluation" reason)
echo "bucket=${first_bucket} enabled=${first_enabled} reason=${first_reason}"

echo
echo "== 6. Create v2 project/environment/flag/key =="
v2_project=$(request POST /api/v1/projects \
  '{"key":"smoke-project","name":"Smoke project"}')
v2_environment=$(request POST /api/v1/projects/smoke-project/environments \
  '{"key":"production","name":"Production"}')
v2_flag=$(request POST /api/v1/projects/smoke-project/environments/production/flags \
  '{"key":"smoke-v2-flag","description":"Smoke v2 flag","enabled":true,"rolloutPercentage":100}')
v2_key_response=$(request POST /api/v1/projects/smoke-project/environments/production/api-keys \
  '{"name":"smoke server"}')
v2_key=$(json_value "$v2_key_response" key)
echo "v2 project: ${v2_project}"
echo "v2 environment: ${v2_environment}"
echo "v2 flag: ${v2_flag}"
echo "v2 key prefix: $(json_value "$v2_key_response" prefix)"
expect_equal "v2.flag.key" "smoke-v2-flag" "$(json_value "$v2_flag" key)"
expect_equal "v2.flag.enabled" "true" "$(json_value "$v2_flag" enabled)"

echo
echo "== 7. Evaluate v2 via OFREP =="
v2_first=$(ofrep_evaluate "$v2_key" "smoke-v2-flag" "user-123")
echo "v2 ofrep: ${v2_first}"
v2_first_value=$(json_value "$v2_first" value)
expect_equal "v2.first.value" "true" "$v2_first_value"

echo
echo "== 8. Restart and re-evaluate =="
run "${COMPOSE[@]}" restart
wait_for_health

restart_flag=$(request GET /api/flags/smoke-flag)
echo "flag after restart: ${restart_flag}"
expect_equal "restart.enabled" "true" "$(json_value "$restart_flag" enabled)"
expect_equal "restart.rolloutPercentage" "20" "$(json_value "$restart_flag" rolloutPercentage)"

restart_evaluation=$(evaluate_user)
echo "evaluate after restart: ${restart_evaluation}"
expect_equal "restart.bucket" "$first_bucket" "$(json_value "$restart_evaluation" bucket)"
expect_equal "restart.enabled" "$first_enabled" "$(json_value "$restart_evaluation" enabled)"
expect_equal "restart.reason" "$first_reason" "$(json_value "$restart_evaluation" reason)"

v2_restart=$(ofrep_evaluate "$v2_key" "smoke-v2-flag" "user-123")
echo "v2 after restart: ${v2_restart}"
expect_equal "v2.restart.value" "true" "$(json_value "$v2_restart" value)"

echo
echo "== 9. down (volume kept) + up and re-evaluate =="
run "${COMPOSE[@]}" down
run "${COMPOSE[@]}" up -d
wait_for_health

recreated_flag=$(request GET /api/flags/smoke-flag)
echo "flag after down/up: ${recreated_flag}"
expect_equal "down-up.enabled" "true" "$(json_value "$recreated_flag" enabled)"
expect_equal "down-up.rolloutPercentage" "20" "$(json_value "$recreated_flag" rolloutPercentage)"

recreated_evaluation=$(evaluate_user)
echo "evaluate after down/up: ${recreated_evaluation}"
expect_equal "down-up.bucket" "$first_bucket" "$(json_value "$recreated_evaluation" bucket)"
expect_equal "down-up.enabled" "$first_enabled" "$(json_value "$recreated_evaluation" enabled)"
expect_equal "down-up.reason" "$first_reason" "$(json_value "$recreated_evaluation" reason)"

v2_recreated=$(ofrep_evaluate "$v2_key" "smoke-v2-flag" "user-123")
echo "v2 after down/up: ${v2_recreated}"
expect_equal "v2.down-up.value" "true" "$(json_value "$v2_recreated" value)"

echo
echo "Smoke test passed: legacy and v2 flags survived restart and down/up."

echo
echo "== 10. Clean up (down -v via EXIT trap) =="
