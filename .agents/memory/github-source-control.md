---
name: GitHub source-control access
description: Distinguishes connector API access from native Git push authentication in this workspace.
---

Do not assume GitHub pushes are blocked just because the connected API integration provides no sandbox connection. Native Git can use Replit's authenticated GitHub proxy without exposing tokens.

**Why:** The GitHub connector returned no usable sandbox credentials, but an authorized native Git push to the user's selected repository succeeded.

**How to apply:** For an explicitly requested push, use the selected repository URL, inspect existing remote branches, preserve the backup remote, avoid force-pushing, and confirm the remote branch matches the intended local commit. Never read or print credentials.
