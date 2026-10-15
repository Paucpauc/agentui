# Agent Web UI

A full-featured WebUI for interacting with the **agent** CLI in your browser.

## Features
- **Full-featured interactive in-browser TTY**: powered by xterm.js + WebSockets + Python pseudo-terminal (pty), with support for ANSI colors, interactive shortcuts, and window resize handling.
- **IDE-style two-pane interface**:
  - **Left pane**: workspace selector, create new workspace, create new file button (`+ File`), auto-refresh, and project file tree.
  - **Right pane**: tab management system.
    - The first tab is always pinned as an interactive terminal running `agent`.
    - **File editing**: text files and raw Markdown (`.md`) open in an embedded editor with save via the `💾 Save` button or `Ctrl+S` / `Cmd+S`, `Tab` indentations, unsaved changes indicator (`●`), and a confirmation warning when closing unsaved tabs.
    - **Markdown mode (Source & Preview)**: instant toggling between raw editing (`Source`) and formatted rendered view with HTML sanitization (`Preview`) for `.md` files.
- **Direct links and URL synchronization with Workspace**: the current workspace is reflected in the browser URL (via `/?workspace=<name>` or `/workspace/<name>`), supporting direct links, browser history navigation (Back / Forward buttons), and instant project loading.
- **Automatic permissions for agent**: the terminal runs with the `--dangerously-skip-permissions` flag (configurable via the `AGENT_ARGS` environment variable), allowing the agent to automatically execute terminal commands, create, and edit files without additional confirmation prompts.
- **Login and password authentication (.env)**:
  - Configure username and password via `AUTH_USERNAME` and `AUTH_PASSWORD` in `.env` (template in `.env.example`).
  - Full-featured Atom One Dark-styled login page (`/login`), protection of pages and static assets, session `HttpOnly` cookies with cryptographic HMAC signing.
  - Protection of terminal PTY and file update WebSocket connections.
  - Login form (`/login`) for the web interface and Bearer tokens for scripts (Basic Auth disabled).
  - Current user display and log out button (`🚪 Log out`) in the top bar.
  - When credentials are not set, authentication is automatically disabled (backwards compatibility).
- **Quota & Limits monitoring**:
  - Display of 5-hour and weekly remaining quota (`5h` and `Week`) directly in the top header bar.
  - Periodic background updates every 20 minutes within the Python application (`agent --output-format json --print "/usage"`).
  - Instant manual refresh button (`🔄`) next to the limits calling the API (`POST /api/limits/refresh`).
  - Interactive dropdown with detailed breakdown by model family (Gemini, Claude, GPT), progress bars, and quota reset timestamps.
- **Public File Links**:
  - Generate direct public links to workspace files without requiring authentication for viewing or downloading.
  - Cryptographic stateless SHA-256 HMAC signature (`PUBLIC_LINK_SECRET` in `.env`), eliminating the need for a database to store links.
  - Expiration time limit support (expiration time is passed in parameters and signed as part of the token).
  - Convenient link generation interface in the file context menu and editor header (`🔗 Share`).
  - Option for forced download (`download=1`) or inline viewing in the browser.
- **Docker containerization**:
  - Multi-stage `Dockerfile`: base image, automated testing stage (`test`), and production image (`production`).
  - `docker-compose.yml` for instant startup with configuration mounts, `.env`, and the `agent` binary.

## Quick Start

### 1. Configure Environment Variables (.env)
Copy the example configuration file or edit `.env`:
```bash
cp .env.example .env
```
Set username and password in `.env`:
```env
AUTH_USERNAME=admin
AUTH_PASSWORD=your_secure_password
```

### 2. Run with Docker Compose (Production)
```bash
docker compose up -d --build
```
The web interface will be available at: [http://localhost:8080](http://localhost:8080)

### 3. Run Tests in Docker
```bash
docker build --target test -t agent-webui:test .
```

### 4. Stop
```bash
docker compose down
```
