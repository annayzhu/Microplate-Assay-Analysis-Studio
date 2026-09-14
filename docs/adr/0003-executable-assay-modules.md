# ADR 0003: Assay modules are executable capabilities

- Status: Accepted
- Date: 2026-09-15

## Context

The assay selector previously changed labels and guidance while the analysis path remained implicitly tied to cell-viability logic. Metadata alone cannot prevent an unsupported assay from reaching the wrong computation.

## Decision

Register each assay as a definition plus an executable function. Execution returns one of three explicit results:

- a cell-viability analysis result;
- a structured measurement preview for endpoint, kinetic, spectrum or standard-curve data;
- a planned capability with no computation.

The workspace consumes this result and only exposes cell-viability summaries when the selected module actually produced them.

## Consequences

- Module selection changes behavior, not only copy.
- Unsupported calculations fail closed without discarding imported measurements.
- Future BCA, ELISA or luciferase analysis can be added behind the same registry contract.
