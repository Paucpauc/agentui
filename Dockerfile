# Multi-stage Dockerfile for Agent Web UI

# Stage 1: Base image with Python & system runtime
FROM debian:bookworm-slim AS base

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8

# Install Python, locales, and terminal utilities
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    locales \
    procps \
    bash \
    ca-certificates \
    curl \
    git \
    && sed -i -e 's/# en_US.UTF-8 UTF-8/en_US.UTF-8 UTF-8/' /etc/locale.gen \
    && dpkg-reconfigure --frontend=noninteractive locales \
    && rm -rf /var/lib/apt/lists/*

# Create virtualenv and app user
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: Test image
FROM base AS test
COPY . /app
ENV WORKSPACE_BASE=/tmp/workspaces \
    PYTHONPATH=/app
RUN pytest tests/

# Stage 3: Production runtime image
FROM base AS production

# Dedicated unprivileged container account, independent of the host account
RUN groupadd --gid 1002 appuser && \
    useradd --uid 1001 --gid appuser --create-home --shell /bin/bash appuser

WORKDIR /app
COPY . /app
COPY workspaces/AGENTS.md /usr/local/share/agent-webui/AGENTS.md

# Prepare directories
RUN mkdir -p /workspaces /home/appuser/.gemini /home/appuser/.local/bin && \
    chown -R appuser:appuser /workspaces /home/appuser

ENV WORKSPACE_BASE=/workspaces \
    AGENT_BIN=/home/appuser/.local/bin/agy \
    HOME=/home/appuser \
    AGY_AUTO_UPDATE=1

ENV PATH="${HOME}/.local/bin:${PATH}"
RUN chmod +x /app/docker-entrypoint.sh

USER appuser:appuser

EXPOSE 8080

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
