# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/cord-note/cord/security/advisories/new).
That opens a private advisory visible only to me.

Please include what you need to reproduce it — the version or commit, your OS,
and the steps. A proof of concept helps but is not required to report something.

You should get an acknowledgement within a week. Cord is written by one person,
so a fix may take longer than that; you will be told where it stands rather than
left waiting.

## What is in scope

Cord is a local-first desktop app. It has no server, no accounts and no network
calls — everything lives in a SQLite database on your machine. That shapes what
counts as a vulnerability here:

**In scope**

- Anything that lets one user's vault be read or modified by another user of the
  same machine.
- Weaknesses in how the account password is stored or checked.
- Code execution triggered by opening or importing a note — a malicious
  document, a pasted payload, a crafted `body_json`.
- Escapes from the Tauri webview into the host, or IPC commands that do more
  than they should.
- Anything that lets the Bun sidecar be reached or driven by something other
  than the app itself.

**Not in scope**

- Access to the database by someone who already has your OS user account.
  Cord's data is protected by your machine's login, not against it.
- The absence of at-rest encryption for note content. It is a known limitation,
  not a vulnerability — see below.
- Denial of service against your own local app.
- Findings from automated scanners with no demonstrated impact.

## Known limitations

These are deliberate and documented rather than oversights:

- **Note content is not encrypted at rest.** The password gates the UI and is
  stored as a bcrypt hash; it does not encrypt the database. Anyone with
  filesystem access can read `cord.db` directly. Encryption is a candidate for a
  later release and is tracked as a feature, not a fix.
- **Cord has no sync and makes no network requests.** If you observe it talking
  to the network, that is a bug worth reporting.

## Supported versions

Cord is pre-1.0 and under active development. Only the latest `main` is
supported; there are no backports to earlier tags.
