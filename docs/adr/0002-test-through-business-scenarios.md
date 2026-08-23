# ADR 0002: Test through business scenarios

- Status: Accepted
- Date: 2026-08-23

## Context

The main browser smoke test is a long sequential script that mixes fixture creation, browser setup, selectors, assertions, screenshots, and optional local files. Several unit tests build overlapping plate fixtures, while local demo tests can be silently skipped.

## Decision

Use named acceptance scenarios as the stable test vocabulary. Run state transitions directly through the Plate workspace interface in Vitest. Keep a small number of browser scenarios for integration evidence, using shared fixtures and a configurable browser adapter. Missing optional vendor fixtures must be reported explicitly rather than making the default suite appear to validate them.

## Consequences

- The workspace interface and test surface remain aligned.
- Browser failures identify a specific business scenario.
- Synthetic fixtures and redistributable fixtures are centralized.
- Local proprietary demo validation remains a separate, explicit command.
