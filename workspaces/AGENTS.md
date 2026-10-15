# WebUI Environment Rules

You are operating inside the WebUI opened in the user's browser.

## 1. File and Project Layout
- **Strict Rule**: Create all files, documents, work plans, scripts, and artifacts **exclusively inside the current project directory (workspace)**.
- Never create files outside the project directory (in system root, `/tmp`, parent folders, etc.). All paths must be relative to the root of the current project.
- If you need to provide a publicly accessible web resource, place it in `public/`. Automatic index fallback (`index.html`) is supported.

## 2. WebUI Components
The user interacts with you through the browser using the following components:
1. **File Explorer (left sidebar)**:
   - Displays the file and folder tree of the current project.
   - The user can select files to view, create, rename, download, delete them, and share them via public links.
2. **Built-in Code Editor**:
   - Selecting a file in the tree opens it in a source code editor tab.
   - Supports syntax highlighting, autosave / `Ctrl+S` saving, and an unsaved changes indicator.
3. **Preview**:
   - **Markdown (.md)**: rich text rendering, support for **Mermaid** diagrams (flowchart, sequence, class, state, er, etc.) and **Flowchart.js**, **LaTeX / KaTeX** math formulas (`$inline$` and `$$block$$`), checkboxes, and code syntax highlighting. Relative links within `.md` automatically open corresponding files in editor tabs.
   - **HTML / SVG**: safe markup preview (scripts disabled for HTML).
   - **Images**: image viewing (PNG, JPG, JPEG, GIF, WEBP, BMP, ICO, TIFF, AVIF, SVG).
   - **Microsoft 365 / Office Documents**: direct preview of Word documents (`.docx`, `.doc`, `.odt`, `.rtf`), Excel spreadsheets (`.xlsx`, `.xls`, `.ods`), and PowerPoint presentations (`.pptx`, `.ppt`, `.odp`). The Python environment provides `pandas`, `openpyxl`, and `python-docx` for generation and processing.
   - **PDF Documents**: built-in `.pdf` file preview.
   - **Fullscreen Mode**: ability to expand preview to full screen via the Fullscreen button (with a floating exit button).
4. **Run (Run ▶)**:
   - The **Run** mode in the UI is designed for interactive execution of web pages and scripts directly in the browser:
     - For **HTML**: runs the page with JavaScript enabled inside an isolated sandbox (iframe sandbox). Ideal for showcasing interactive UI components, canvas, games, and web apps.
     - For **JS**: executes JavaScript code with an integrated interactive output console directly in the tab.
   - For HTML and JS files, a **Run** button/mode is available in the tab header next to Preview.
5. **Public Links (Share / Public Links)**:
   - Any workspace file can be made available for external viewing or download without authentication via the `🔗 Share` button in the tab header or the file's context menu (cryptographically signed links with expiration).
6. **Agent Terminal (TTY)**:
   - The first console tab where the current conversation with the agent takes place.

## 3. Agent Recommendations
- For web pages and web applications, create an entry point (e.g. `index.html`), letting the user know they can open it in **Preview** (safe layout preview) or click **Run** (to run application scripts and logic).
- For JavaScript code, let the user know they can check the result via the **Run** button.
- For reports, diagrams, and documentation, actively utilize Markdown with **Mermaid** diagrams, **LaTeX** formulas, and relative links to project source files.
- For reports and spreadsheets, you can generate Office documents (`.docx`, `.xlsx`) or PDFs when appropriate — they are supported by the built-in preview.
- Refer to the application interface (file tree on the left, editor tabs, Preview, Run, Share buttons). Do not suggest external desktop IDEs (VS Code, etc.) to the user.

## 4. Workflow Rules
- If the task involves multiple steps, create a `PLAN.md` and track progress after each step.
- Organize workspace content into folders when appropriate and when there are sufficient files.
- When creating a new project, add an `AGENTS.md` referencing `../AGENTS.md` (`@../AGENTS.md`).

## 5. Links
- Within Markdown, you can use relative links like **[detail data](details/data.md)** **[root readme](README.md)**. Never use absolute paths to files inside the workspace. Clicking a relative link in the WebUI will automatically open the file in a new tab.
- Use external links to other resources as needed.
