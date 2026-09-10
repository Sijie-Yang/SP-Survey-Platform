# Analysis workflow polish — 2026-09-10

## Coverage diagnostics

- Annotation × perception coverage counts now open searchable, paginated media lists. Lists distinguish missing annotation, pending review, missing scores, missing selected features, and unmatched historical media.
- Export the currently searched list as CSV, inspect the source media, or locate a matched image in the annotation editor. Navigation uses the stable media ID, clears conflicting filters, opens the correct folder/page, and focuses the requested image.
- Unmatched historical media cannot jump to a same-name file. Missing scores require collecting answers to the corresponding question; the diagnostic does not create data.
- Score diagnostics require a selected question. Feature diagnostics respect the current review scope; valid zero values remain valid observations.

## Language and editing safeguards

- Annotation controls, label settings, Researcher Practice, and advanced analysis controls follow the administrator's Chinese/English setting. Common feature and model headings use readable names. Researcher-defined labels and stored field IDs remain unchanged.
- Custom Skill editing now blocks dirty route navigation, including browser Back/Forward. Cancelling keeps the mounted editor and its draft. Refresh/close protection remains in place, and successful creation navigates after clearing the dirty state.
- Routing uses React Router's data router and official `useBlocker`; existing route destinations are unchanged. See https://reactrouter.com/api/hooks/useBlocker.

## Validation

- Full frontend suite: 87 suites, 412 tests passed; production build passed with existing warnings.
- Read-only browser check: coverage → search → locate opened the exact requested image (10/500), including after the annotation panel mounted. Corrected an initial-selection effect that had overridden this target.
- Checked the diagnostic dialog at a 390 × 844 viewport: long filenames and IDs wrap, and source/location actions remain accessible.
- Checked the real Skill editor: Back prompts; Keep editing preserves the typed name; Discard changes exits. Test draft was not saved.
- Browser checks did not submit research responses or alter annotations. Restored the administrator language to English and reset the viewport.

This batch needs no SQL migration or backend configuration change. It has not been pushed or deployed.
