# Security Specification (`security_spec.md`)

## 1. Data Invariants

1. **Zero PII Exposure**: No collection (`saves`, `shops`, `chats`) may contain PII fields (`email`, `phone`, `address`).
2. **Strict Identity Ownership (`saves/{userId}`)**:
   - Only a verified authenticated user (`request.auth != null && request.auth.token.email_verified == true`) whose `request.auth.uid == userId` AND `incoming().uid == request.auth.uid` can read, create, update, or delete `/saves/{userId}`.
   - `saves` cannot be listed (`allow list` is omitted/denied).
   - `uid` and `createdAt` are immutable on updates.
   - `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
3. **Public Shop Integrity (`shops/{userId}`)**:
   - Single-document `get` requires `isSignedIn() && isValidId(userId)`.
   - `list` queries require `isSignedIn() && resource.data.uid is string && resource.data.uid.size() >= 1 && resource.data.uid.size() <= 128`.
   - `create` requires `isVerifiedUser() && isValidId(userId) && userId == request.auth.uid && isValidPublicShop(incoming()) && incoming().createdAt == request.time && incoming().updatedAt == request.time`.
   - `update` must satisfy `isVerifiedUser() && isValidId(userId) && isValidPublicShop(incoming()) && incoming().uid == existing().uid && incoming().createdAt == existing().createdAt && incoming().updatedAt == request.time` and follow one of two named actions:
     - **Action: OwnerSync**: `userId == request.auth.uid && incoming().diff(existing()).affectedKeys().hasOnly(['shopName', 'playerName', 'level', 'xpTotal', 'day', 'money', 'fame', 'decor', 'likes', 'skinScore', 'skinCount', 'houseLevel', 'snapshot', 'updatedAt'])`
     - **Action: LikeShop**: `userId != request.auth.uid && incoming().diff(existing()).affectedKeys().hasOnly(['likes', 'updatedAt']) && incoming().likes == existing().likes + 1`
4. **World Chat Integrity (`chats/{messageId}`)**:
   - `get` requires `isSignedIn() && isValidId(messageId)`.
   - `list` requires `isSignedIn() && resource.data.uid is string && resource.data.uid.size() >= 1 && resource.data.uid.size() <= 128`.
   - `create` requires `isVerifiedUser() && isValidId(messageId) && isValidChatMessage(incoming()) && incoming().uid == request.auth.uid && incoming().hearts == 0 && incoming().createdAt == request.time && incoming().updatedAt == request.time`.
   - `update` (Action: HeartMessage) requires `isVerifiedUser() && isValidId(messageId) && isValidChatMessage(incoming()) && incoming().uid == existing().uid && incoming().createdAt == existing().createdAt && incoming().updatedAt == request.time && incoming().diff(existing()).affectedKeys().hasOnly(['hearts', 'updatedAt']) && incoming().hearts == existing().hearts + 1`.

## 2. The "Dirty Dozen" Payloads

1. **Unverified Email Write**: Attempt to create `/saves/user_1` with `email_verified: false`. -> `PERMISSION_DENIED`
2. **Identity Spoofing on Save Create**: Authenticated `user_1` attempts to create `/saves/user_1` with `uid: "user_2"`. -> `PERMISSION_DENIED`
3. **Cross-User Save Read**: Authenticated `user_2` attempts `get` on `/saves/user_1`. -> `PERMISSION_DENIED`
4. **Shadow Field Injection on Save Create**: Authenticated `user_1` includes `{ isAdmin: true }` in `/saves/user_1`. -> `PERMISSION_DENIED`
5. **Immutable Field Mutation (`createdAt`)**: Authenticated `user_1` attempts to change `createdAt` during an update to `/saves/user_1`. -> `PERMISSION_DENIED`
6. **Client Timestamp Spoofing (`updatedAt`)**: Authenticated `user_1` sends a forged past/future timestamp for `updatedAt` instead of `request.time`. -> `PERMISSION_DENIED`
7. **Denial-of-Wallet Oversized String**: Authenticated `user_1` attempts to set `shopName` to a 500-character string (exceeding `maxLength: 80`). -> `PERMISSION_DENIED`
8. **ID Poisoning Attack**: Authenticated `user_1` attempts to create `/chats/invalid$id!with@spaces` failing `^[a-zA-Z0-9_\-]+$`. -> `PERMISSION_DENIED`
9. **Unauthorized Shop Tampering**: Authenticated `user_2` attempts to update `money` on `/shops/user_1`. -> `PERMISSION_DENIED`
10. **Arbitrary Like Inflation**: Authenticated `user_2` attempts to increment `likes` by +100 on `/shops/user_1` in a single update. -> `PERMISSION_DENIED`
11. **Chat Message Content Tampering**: Authenticated `user_1` attempts to edit `text` of an existing `/chats/msg_1` document after creation. -> `PERMISSION_DENIED`
12. **Unauthenticated List Scraping**: Unauthenticated client attempts `list` on `/shops` or `/chats`. -> `PERMISSION_DENIED`
