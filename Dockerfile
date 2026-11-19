FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Base runtime dependencies (Docker CLI only; the daemon is provided by the host).
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        docker.io \
        iproute2 \
        python3 \
        python3-flask \
        python3-yaml \
        sudo \
    && rm -rf /var/lib/apt/lists/*

# Use the official Containerlab installer in containerlab-only mode. It configures
# Containerlab's official apt repository and installs the package for this Ubuntu
# architecture (amd64/arm64), without installing/replacing the Docker CLI.
RUN set -eu; \
    curl -fsSL https://containerlab.dev/setup -o /tmp/containerlab-setup.sh; \
    bash /tmp/containerlab-setup.sh install-containerlab; \
    rm -f /tmp/containerlab-setup.sh

# Keep this check separate so image builds clearly identify install failures.
RUN containerlab version

WORKDIR /app
COPY app.py /app/app.py
COPY static/ /app/static/

ENV LAB_DIR=/lab \
    CLAB_SUDO=0
EXPOSE 5001
CMD ["python3", "/app/app.py"]
