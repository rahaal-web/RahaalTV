# RahaL TV Security Specification (Phase 0)

## 1. Data Invariants
1. **Default Deny**: All unspecified Firestore paths return `PERMISSION_DENIED`.
2. **Media Integrity**: Only verified administrators (`isAdmin()`) may create, update, or delete `/media/{mediaId}` entries. Public visitors have read-only access.
3. **RBAC Anti-Escalation**: A regular signed-in user registering `/users/{userId}` MUST set `role == 'member'` and cannot elevate their own role or write to `/admins/{adminUid}`.
4. **PII Isolation**: User email is isolated in `/users/{userId}/private/info` and readable only by `isOwner(userId)` or `isAdmin()`.
5. **Email Verification Guard**: Any admin check on runtime email (`rahalahmed348@gmail.com`) strictly requires `request.auth.token.email_verified == true`.
6. **Temporal Integrity**: All `createdAt` and `updatedAt` timestamps on creates and updates must equal `request.time`, and `createdAt` is immutable on update.

7. **Rating Ownership & Bounded Range**: Users may only create or update `/ratings/{mediaId}__{uid}` documents matching their own `request.auth.uid`, with integer `stars` strictly between `1` and `5`, and immutable `mediaId`, `userId`, and `createdAt`.

## 2. The "Dirty Dozen" Attack Payloads
1. Unauthenticated write to `/media/fake-movie` -> DENIED.
2. Non-admin verified user attempting to create or delete `/media/running-man` -> DENIED.
3. Spoofed admin email with `email_verified: false` attempting admin write -> DENIED.
4. Non-admin user creating `/users/{uid}` with `role: 'admin'` -> DENIED.
5. Non-admin user updating `/users/{uid}` to change `role` -> DENIED.
6. User A attempting `get` on `/users/userB/private/info` -> DENIED.
7. User injecting a 1,500-character document ID (`isValidId` guard) -> DENIED.
8. Payload with shadow field (`isSuper: true`) -> DENIED (`hasOnly` strict key enforcement).
9. Visitor request created with `status: 'approved'` instead of `'pending'` -> DENIED.
10. Visitor request created with `userId` belonging to another UID -> DENIED.
11. Updating `/media/{id}` with forged past `createdAt` timestamp -> DENIED.
12. Non-admin attempting `list` on `/requests` without `userId == request.auth.uid` filter -> DENIED.
13. Rating payload with `stars: 10` or `stars: 4.5` or spoofed `userId` -> DENIED.

