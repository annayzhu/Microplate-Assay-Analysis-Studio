# ADR 0001: Plate workspace owns analytical working state

- Status: Accepted
- Date: 2026-08-23

## Context

The React entry module currently coordinates import confirmation, assay selection, plate switching, well annotations, analysis scope, project restoration, and export. The same behavior is difficult to verify without driving the full browser page, and changes require understanding a large JSX module.

Raw measurements, editable annotations, and presentation state also have different lifecycles. Treating them as independent React state variables makes their invariants implicit.

## Decision

Introduce a deep Plate workspace module. Its interface is the test surface for analytical state transitions. It owns source plates, editable annotations, assay selection, active plate, and analysis scope. Raw measurements remain immutable. Browser-only effects and transient presentation state stay outside the module behind browser adapters.

## Consequences

- Business transitions can be verified without rendering React.
- React becomes an adapter over the workspace interface rather than the owner of analytical policy.
- Project and export modules consume explicit workspace snapshots.
- Existing tests that only protect internal shallow helpers are replaced when equivalent behavior is covered through the workspace interface.
