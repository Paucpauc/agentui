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

# Create user and group matching host user
ARG USERNAME=jill
ARG GROUPNAME=jill
ARG UID=1001
ARG GID=1002
RUN (groupadd -g ${GID} ${GROUPNAME} || groupadd ${GROUPNAME} || true) && \
    (useradd -u ${UID} -g ${GID} -m -s /bin/bash ${USERNAME} || useradd -m -s /bin/bash ${USERNAME} || true)

WORKDIR /app
COPY . /app

# Prepare directories
RUN mkdir -p /workspaces /home/${USERNAME}/.gemini && \
    chown -R ${UID}:${GID} /app /workspaces /home/${USERNAME} /opt/venv

ENV WORKSPACE_BASE=/workspaces \
    AGENT_BIN=/usr/local/bin/agent \
    HOME=/home/jill

USER ${USERNAME}:${GROUPNAME}

EXPOSE 8080

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
