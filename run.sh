#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

VENV=".venv"
DEPS=("flask" "pyyaml")

command -v python3 >/dev/null || { echo "python3 introuvable" >&2; exit 1; }

# Crée le venv s'il n'existe pas
[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"

PY="$VENV/bin/python"

# Installe uniquement ce qui manque
missing=()
for pkg in "${DEPS[@]}"; do
  "$PY" -m pip show "$pkg" >/dev/null 2>&1 || missing+=("$pkg")
done
if [ "${#missing[@]}" -gt 0 ]; then
  echo ">> Installation : ${missing[*]}"
  "$PY" -m pip install --quiet "${missing[@]}"
fi

exec "$PY" app.py
