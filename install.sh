#!/usr/bin/env bash
set -euo pipefail

# Installe les dépendances Python via les paquets Ubuntu, puis copie l'application.
if ! command -v apt-get >/dev/null 2>&1; then
  echo "Erreur : ce script est prévu pour Ubuntu/Debian (apt-get requis)." >&2
  exit 1
fi
sudo apt-get update
sudo apt-get install -y python3 python3-flask python3-yaml

SRC="$(dirname "$0")"
TARGET="${HOME}/labs/webui"
mkdir -p "${TARGET}/static" "${TARGET}/lab"
cp "${SRC}/app.py" "${TARGET}/app.py"
cp "${SRC}/static/index.html" "${TARGET}/static/index.html"
cp -R "${SRC}/nodes" "${TARGET}/nodes"
chmod 755 "${TARGET}/app.py"
echo "Application installée dans ${TARGET}"

if command -v docker >/dev/null 2>&1; then
  # L'image des nœuds doit exister sur l'hôte : containerlab ne la construit pas.
  echo "Construction de l'image des nœuds lab01/node:latest…"
  docker build -t lab01/node:latest "${TARGET}/nodes"
else
  echo "Avertissement : Docker n'est pas détecté dans le PATH." >&2
  echo "  Installez Docker puis exécutez : docker build -t lab01/node:latest '${TARGET}/nodes'" >&2
fi

if ! command -v containerlab >/dev/null 2>&1; then
  echo "Avertissement : containerlab n'est pas détecté dans le PATH. Installez-le avant le déploiement." >&2
fi

echo "Lancement : cd '${TARGET}' && python3 app.py"
