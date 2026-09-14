# Shared preview media persistence

Run `supabase/preview_media_library.sql` in the same Supabase project used by the
platform before deploying this change. It requires `admin_projects_rls.sql` and
can be run repeatedly without clearing the library. No R2 objects are moved.

The `preview_media_library` singleton stores the complete shared media manifest,
including `folder`, `logicalFolder`, stable media IDs, folder lists and set/category
tags. The image files remain under the existing `skill-preview/` R2 prefix.
This migration does not change project or template media storage.

The manifest is readable by anonymous and authenticated clients because it is the
platform's public preview library. Only platform admins can save it, using
`save_preview_media_library`; direct client writes are denied. Each save must
provide the revision it read. A stale save fails without overwriting newer data.

The management page waits for the cloud record before mounting the editable
library. After successful saves it uses the returned revision. A failed save
keeps the previous state and offers a cloud reload. An unavailable database or
missing migration never opens an editable browser-only fallback.

On the first initialization only (revision zero), the browser's existing
`sp-preview-media-library-config` supplies legacy folder names and tags. The
library's R2 refresh or next successful change saves these to the cloud. Once a
cloud revision exists, legacy browser settings are ignored. Previous per-image
moves that were never persisted cannot be reconstructed from folder names alone.

Read-only previews use the saved manifest, with the original R2 listing as a
fallback before initialization or during a read failure. This fallback never
writes data. Project imports read the saved organization and tags; if metadata
cannot be read, the import stops instead of silently using the original folder
layout. Imports also reject colliding destination paths before copying files.

Verification covers new-browser reads, nested/root moves, failed saves, revision
conflicts, legacy-config migration, preview/import consumers and same-name files.
The SQL was additionally executed in isolated PostgreSQL (PGlite) to verify
repeatability, read/write privileges, payload validation and compare-and-swap.
