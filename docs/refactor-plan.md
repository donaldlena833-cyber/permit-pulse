# Refactor Plan

## Objective

Turn PermitPulse into the cleanest possible version of its current real job:

an internal MetroGlass operator system for lead intelligence and outreach, with workspace-ready boundaries that make later commercialization easier.

## What This Refactor Does

### 1. Declare one canonical system

- frontend lives under `src/App.tsx`, `src/features/operator-console`, and `src/features/prospect-workspace`
- worker lives under `worker/permit-pulse`
- database lives on the `v2_*` schema and workspace-aware migrations

### 2. Isolate legacy paths

- move older monolith code into `legacy/*`
- stop treating legacy code as the active product path
- document legacy as historical context only

### 3. Normalize product naming

- keep MetroGlass in the presentation layer where useful
- remove MetroGlass-specific naming from the core architecture path where it creates confusion

### 4. Keep workspace readiness practical

- keep workspace/account/config boundaries
- do not push full SaaS rollout work
- keep onboarding and mailbox setup honest about current manual steps

### 5. Strengthen operator trust

- better lead-state explanation
- real opt-out path for permit leads
- clearer settings surfaces
- safer outbound defaults

## Implemented In This Pass

- archived legacy frontend and worker code into `legacy/*`
- renamed live feature paths toward operator-console and prospect-workspace
- disabled self-serve Gmail connect by default for new workspaces
- hid self-serve billing from the active product surface
- added workspace capability flags so UI behavior matches real deployment maturity
- added permit-lead opt-out handling
- improved explainability in lead list and lead detail
- rewrote repo docs and README around the real product

## Intentionally Deferred

- public self-serve commercialization work
- billing-first productization
- generalized customer onboarding optimization
- deep schema surgery beyond what is needed for current safe operation
- major UI redesign work that does not improve operator throughput

## Future Follow-Ups

1. Add a true CLI or local script for triggering scans outside the UI if it becomes part of the daily workflow again.
2. Continue migrating remaining MetroGlass-specific copy toward clearer operator language where it improves maintainability.
3. Decide whether owner signup should remain available or be reduced to a purely internal provisioning flow.
4. Consider a dedicated suppression model for permit leads if opt-out and do-not-contact handling grows more complex.
