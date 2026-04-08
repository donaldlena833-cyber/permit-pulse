# Legacy Code

This folder contains historical PermitPulse code that is no longer the canonical product path.

Current live paths are:

- `src/App.tsx`
- `src/features/operator-console`
- `src/features/prospect-workspace`
- `worker/permit-pulse`

Archived paths:

- `legacy/monolith`
- `legacy/worker-monolith`
- `legacy/frontend-prototype`

Rules for legacy code:

1. Do not treat it as the live architecture.
2. Do not import from it in new code.
3. Use it only for historical reference while salvaging old business logic.
