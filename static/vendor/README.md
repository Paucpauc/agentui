# Vendored browser dependencies

These files are served directly from `/static/vendor/`; no Node.js build or CDN
access is required at runtime. The production Docker image includes this directory.

`manifest.json` records the original download URLs, pinned versions and SHA-256
checksums. Marked was previously unversioned and is now pinned to 15.0.12, the
version returned by the original CDN URL when these assets were vendored.
Other library versions are unchanged.

Ace includes the complete `src-min-noconflict` distribution from ace-builds 1.36.2
so that dynamically requested language modes, extensions and workers are local.
KaTeX includes its fonts in their original paths relative to the stylesheet.
Licenses are stored alongside each library.

To update a library, replace its assets with the desired upstream version,
preserve its license and any dynamically loaded resources, update the references
in `static/index.html` (and the Ace base path in `static/js/editor.js` when updating
Ace), and refresh the version, source and checksums in `manifest.json`.
