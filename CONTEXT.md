# Domain glossary

## Assay module

An experiment-specific interpretation of microplate measurements. An assay module defines what the signal represents and which analysis is scientifically appropriate; it does not define how instrument files are decoded.

## Import batch

One import operation containing one or more source plates. A batch preserves source provenance and may require the user to confirm which assay module should interpret the measurements.

## Source plate

A plate as acquired or manually entered. Its physical well positions and raw measurements are immutable. A source plate may contain multiple measurement series, such as wavelengths, kinetic steps, spectra, or sequential luminescence measurements.

## Plate workspace

The current analytical working state for an import batch. It combines source plates with editable plate names, well annotations, exclusion decisions, the selected assay module, and the active analysis scope. Transient presentation state such as zoom, open dialogs, notices, and scroll position is not part of the plate workspace.

## Well annotation

Editable experimental meaning attached to a physical well, including role, group, sample identity, treatment, concentration, time point, biological replicate, technical replicate, note, and exclusion decision. A well annotation never replaces or mutates the raw measurement.

## Analysis scope

The subset of annotated, non-excluded biological observations currently included in analysis and export. The complete source measurements remain available regardless of scope.

## Technical replicate

Repeated measurements of the same biological experimental unit. Technical replicates are summarized before inferential statistics and do not independently increase the biological sample size.

## Biological replicate

An independently defined biological experimental unit. Biological replicate labels may occur on the same physical plate when the experimental design supports that interpretation; inferential statistics operate on biological-replicate summaries rather than individual technical wells.

## Reproducible artifact

A versioned export that records the analytical data, provenance, annotations, scope, and calculation context needed to understand or resume an analysis. Transient presentation state is not part of a reproducible artifact.
