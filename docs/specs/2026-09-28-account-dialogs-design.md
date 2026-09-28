# Account dialogs — design

**Status:** approved · follows `2026-09-27-pin-unlock-design.md`

## Why

Settings → Account showed three forms of bare inputs and a button each, and
reported the outcome as a line of small grey text. Changing a credential should
be a guided, deliberate step with an unmistakable result.

## What the user sees

The Account page lists three actions, each a title, one line of explanation and
one button: **Change PIN…**, **Change password…**, **New recovery key…**.

Each button opens a modal dialog with a step indicator, Back and Cancel:

| Flow | Step 1 | Step 2 | Result |
|---|---|---|---|
| Change PIN | Confirm with password | New PIN + repeat | “PIN changed” |
| Change password | Current password | New password + repeat | “Password changed” |
| New recovery key | Warning (old key stops working) + password | New key, Copy, “I’ve saved it” | “New recovery key saved” |

- Step 1 checks the password immediately, so a typo is caught before the user
  types anything new.
- **Fixable mistakes** (wrong password, entries that don’t match, PIN format)
  show inline on the step.
- **Success** shows an animated check mark, a headline, one line about what
  changes next, and Done.
- **Unexpected failures** (sidecar unreachable, write failed) show a red ✕,
  the reason, and **Try again** (back to the last step) / **Close**.
- The recovery key is generated only after the password step; closing the
  dialog on the key step does not undo it (the old key is already gone), so the
  step says so.

## Components

- `components/Dialog.tsx` — reusable modal on the native `<dialog>` element
  (`showModal()` gives focus containment, Escape and a backdrop). Public
  classes `cord-dialog`, `cord-dialog__title`, `cord-dialog__steps`,
  `cord-dialog__result`.
- `components/settings/account/*` — one flow component per action, sharing a
  step/result scaffold.

## Sidecar

`AuthService.verifyPassword(password)` for the signed-in user; throws
`Wrong password`. Route `POST /auth/verify-password`, Tauri command
`auth_verify_password`, `api.auth.verifyPassword`. The final step still sends
the password with the change, so the sidecar never trusts the earlier check.

## Tests

- `verifyPassword`: right password resolves, wrong one throws, signed out throws.
- IPC parity covers the new command.
- The dialogs are UI and are verified by driving the real app.
