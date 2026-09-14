# ADR 0001: Separate the project document from the UI session

- Status: Accepted
- Date: 2026-09-15

## Context

The React entry module currently coordinates import confirmation, assay selection, plate switching, well annotations, analysis scope, project restoration, and export. The same behavior is difficult to verify without driving the full browser page, and changes require understanding a large JSX module.

Raw measurements, editable annotations, and presentation state also have different lifecycles. Treating them as independent React state variables makes their invariants implicit.

## Decision

Use two explicit lifecycles behind one workspace interface:

- `PlateProjectDocument` owns plates, immutable measurements, editable annotations, experiment metadata and analysis configuration. Scientific changes increment its revision.
- `PlateWorkspaceSession` owns the active plate, selected wells, selection anchor and selected summary rows. Selection changes never mutate or serialize the project document.

Analysis is an indexed projection of the project document. A project-identity cache reuses projected plates and scientific results until a scientific action creates the next document revision.

## Consequences

- Business transitions can be verified without rendering React.
- React becomes an adapter over the workspace interface rather than the owner of analytical policy.
- Project files serialize the scientific document, never transient selections.
- Selecting wells or summary rows does not rerun baseline analysis.
- Existing tests that only protect internal shallow helpers are replaced when equivalent behavior is covered through the workspace interface.
