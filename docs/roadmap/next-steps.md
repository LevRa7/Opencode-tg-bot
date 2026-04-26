# Next Steps Roadmap

## Purpose

This note collects the next major product directions that were raised for the bot. The list is intentionally broader than a single implementation ticket: it separates user-facing configuration, runtime topology, remote deployment, and security concerns so the work can be planned in a sensible order.

## 1. User-facing setup on first launch

- Add a first-run flow that asks the user to choose the bot interface language instead of reading a single global language from `.env`.
- Store the language per user, not globally.
- Extend the same onboarding flow so the user can decide which optional features are enabled for their account.
- Keep the defaults conservative so existing users continue to work after upgrade.

## 2. Per-user feature toggles

- Add commands or settings flows that let users enable and disable features that are currently controlled globally.
- Treat each toggle as a user preference unless there is a strong operational reason to keep it admin-only.
- Review which existing flags should remain global because they affect server safety, billing, or host-wide policy.

## 3. Connection to OpenCode API

- Add a `/connect` command so users can connect their own OpenCode models and runtime settings.
- Support different connection profiles for local and remote environments.
- Make the stored connection data user-specific and separate from Telegram auth data.

## 4. SSH-based deployment and remote host setup

- Add an SSH onboarding mode for users who want the bot container deployed on their own server.
- The setup should accept user connection details, connect to the remote machine, and bootstrap Docker plus required dependencies.
- Account for different Linux distributions and macOS where possible.
- Keep this flow explicit about what is installed remotely and what credentials are stored.

## 5. Host and runtime switching

### 5.1 `/host` for SSH users

- If a user selected SSH mode, `/host` should let them switch between the container runtime and the host runtime.
- When switching to the host, stop launching `opencode serve` inside the container if it is no longer needed.
- When switching back, restore the container runtime.

### 5.2 Admin host control

- For admins, `/host` should offer three targets: `Host`, `Container`, and `ssh`.
- For regular users, the command should offer the same runtime switching except for the admin-only host option where needed by policy.
- Keep the selection state visible in `/status` so users know which runtime is active.

### 5.3 SSH history

- When a user chooses SSH mode, show previously connected servers.
- Reuse saved connection entries when possible to reduce re-entry and make switching less error-prone.

## 6. Agent activity in Telegram threads

- When a subagent is activated during a session, create a dedicated Telegram thread named like `Agent: Builder`.
- Forward the agent actions that the user has enabled in settings into that thread.
- Keep the thread focused on agent activity, then remove the topic when the agent finishes.
- Send a text-file report back to the main chat with the full log of messages sent in the thread.

## 7. Pinned question threads

- When the user asks a question, pin the corresponding thread while the bot is working on the answer.
- Unpin it when the bot finishes replying.
- Keep this behavior consistent with the existing pinned status logic so question threads do not fight with session status updates.

## 8. Shared OpenCode server optimization

- Evaluate whether a single OpenCode server can be shared by multiple users to reduce duplication.
- Compare the cost savings against the isolation and safety model currently needed for per-user runtimes.
- Treat this as an optimization study first, not an automatic architecture change.

## 9. Security and workspace limits

- Enforce a default workspace limit of 10 GB for users working on the host, or another value if the plan/tier specifies it.
- Design the limit model so different plans can use different quotas.
- Keep host-facing users as restricted as possible, especially when file access and runtime control are enabled.

## 10. Credentials and status visibility

- Replace the shared default OpenCode credentials with per-user credentials.
- Set the login automatically to `tg_id`.
- Let the user choose a password manually or generate one randomly.
- Expose the login, password, external address, and port in `/status` so the user can connect through the web UI.

## 11. External reachability and TLS

- Investigate how to expose user ports to the internet when there is no public IP.
- Decide whether this should use tunneling, reverse proxying, NAT traversal, or a hosted relay.
- Add SSL certificate support for running the mini app from a local machine.

## 12. MiniApp web access

- Add a button that opens the web version of OpenCode inside Telegram MiniApp.
- Support auto-login using stored OpenCode serve credentials where appropriate.
- For remote SSH setups, keep the credential flow separate from local container credentials.
- Evaluate a web UI similar to `openchamber` as the front-end model for the mini app.

## Dependencies and ordering

1. First-run language selection and user preferences should come before feature toggles, because they define the account-scoped settings model.
2. `/connect`, SSH onboarding, and `/host` switching depend on the runtime and credential model being designed first.
3. Agent threads and pinned question threads depend on the existing topic/thread infrastructure staying stable.
4. Shared-server optimization should wait until the per-user isolation model is well understood and measurable.
5. Internet exposure, TLS, and mini app web access should be designed after the connection and deployment model is settled.

## Risks

- Mixing global and per-user settings can create confusing behavior if the ownership of a setting is not obvious.
- SSH bootstrap flows are high-risk because they can execute remote setup commands on user-owned machines.
- Host runtime switching can accidentally leave services running in the wrong place if lifecycle rules are not explicit.
- Exposing ports without a public IP may require infrastructure that is outside the bot itself.
- MiniApp web login adds more credential handling and should be treated as a sensitive boundary.

## Open Questions

- Which of the current global feature flags should become per-user preferences, and which should remain admin-only?
- Should `/connect` manage only OpenCode runtime settings, or also related deployment credentials?
- What minimum SSH bootstrap targets must be supported in the first version: Ubuntu, Debian, Fedora, Arch, macOS, or all of them?
- Should the host/container/ssh choice be per user, per session, or per runtime profile?
- What is the first acceptable implementation for exposing user ports without a public IP?
- Do we want MiniApp web access to be read-only at first, or fully interactive from day one?
