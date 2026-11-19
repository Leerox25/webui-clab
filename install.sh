#!/usr/bin/env bash
set -euo pipefail

# Installation "sur place" : tout se fait dans le dossier du projet.
# Rien n'est écrit en dehors (pas de ~/labs, aucune copie des sources).
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "Installation dans ${ROOT}"

# ---------------------------------------------------------------- dépendances
# Paquets système si apt est disponible, sinon environnement virtuel local.
if python3 -c 'import flask, yaml' >/dev/null 2>&1; then
  echo "Dépendances Python déjà présentes (flask, pyyaml)."
elif [ -x .venv/bin/python ] && ./.venv/bin/python -c 'import flask, yaml' >/dev/null 2>&1; then
  echo "Environnement virtuel local .venv déjà prêt."
elif command -v apt-get >/dev/null 2>&1; then
  echo "Installation des paquets Ubuntu python3-flask et python3-yaml…"
  sudo apt-get update
  sudo apt-get install -y python3 python3-flask python3-yaml
else
  echo "apt-get absent : création d'un environnement virtuel local (.venv)…"
  [ -x .venv/bin/python ] || python3 -m venv .venv
  ./.venv/bin/pip install --quiet --upgrade pip
  ./.venv/bin/pip install --quiet flask pyyaml
fi

# ------------------------------------------------------------------ laboratoire
# Dossier de travail du laboratoire, à côté de l'application.
mkdir -p lab
echo "Dossier du laboratoire : ${ROOT}/lab"

# ----------------------------------------------------------------- image des nœuds
# containerlab ne construit pas cette image : elle doit exister sur l'hôte.
if command -v docker >/dev/null 2>&1; then
  echo "Construction de l'image des nœuds lab01/node:latest…"
  docker build -t lab01/node:latest nodes/
else
  echo "Avertissement : Docker n'est pas détecté dans le PATH." >&2
  echo "  Installez Docker puis relancez : docker build -t lab01/node:latest '${ROOT}/nodes'" >&2
fi

if ! command -v containerlab >/dev/null 2>&1; then
  echo "Avertissement : containerlab n'est pas détecté dans le PATH." >&2
  echo "  Installez-le avant tout déploiement (https://containerlab.dev/install/)." >&2
fi

echo
echo "Installation terminée dans ${ROOT}"
echo "Lancement : ./run.sh"
