#!/bin/sh
set -eu
cd "$(dirname "$0")"
export PWD="$(pwd)"
mkdir -p lab

# L'image des nœuds n'est pas construite par containerlab : elle doit exister
# sur l'hôte avant le déploiement. La construction se fait pour l'architecture
# native (arm64 sur Apple Silicon, amd64 sur Intel).
docker build -t lab01/node:latest nodes/

exec docker compose up --build
