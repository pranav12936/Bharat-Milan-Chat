# Original Bharat Milan integration proposal — awaiting source inspection

Status: **do not apply**. The specified repository was not publicly accessible on 18 October 2026, so no source, schema, user-ID format, route, or accepted-status name has been inferred.

## Original project changes made

None. No original repository checkout could be inspected and no file was modified.

## Proposed minimum change after authenticated inspection

One existing **backend-only** route or service method, placed alongside the original project’s current authenticated API layer. Its exact filename and path must be selected only after source access.

- Request, from the chat server only: `{ senderUserId, recipientUserId }`.
- Caller authentication: a server-to-server credential held only in the two backends (or mutual TLS/workload identity where deployed).
- Checks: validate identifiers; locate the real interest record in either direction; accept only the existing accepted status; confirm both users exist; apply the current withdrawal/revocation rule.
- Response: `{ eligible: boolean }` only.
- Failure handling: 401/403 for the caller, 400 invalid IDs, and `eligible: false` for missing/invalid/ineligible records; unavailable dependencies must fail closed.
- Controls: route-level rate limit, no profile payloads, no user-supplied status, secrets redacted from logs.

## Explicitly excluded

- No CSS, Tailwind, assets, layout, components, pages, or frontend routes.
- No auth rewrite.
- No new interest table or interest-data replication.
- No migration until the existing data model is inspected and the user approves it.
- No Chat button. A future button must be proposed separately with its exact existing component and unchanged styling.

## Required source evidence before implementation

1. The Drizzle interest table and the literal accepted status.
2. The existing user ID types and current session/auth middleware.
3. Interest authorization and reject/withdraw semantics.
4. Existing backend route/service conventions and test setup.
5. Deployment configuration for a secret or workload identity.
