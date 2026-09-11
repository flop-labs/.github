# Security

This is the default policy for FLOP Labs repositories that do not publish their own. A repository with
its own `SECURITY.md` overrides this one — read that instead.

## Reporting a vulnerability

Open a private security advisory from the repository's **Security** tab → *Report a vulnerability*. It
keeps the report private until there is a fix, and it is the channel that reaches us fastest. Please do
not open a public issue for anything exploitable.

Filing one needs a GitHub account, signed in. Without one — or to send PGP — mail
<security@flop.finance>.

If the Security tab offers no *Report a vulnerability* button, private reporting is not enabled on that
repository. Use the email address above. As a last resort, open a public issue saying exactly that and
**nothing about the finding** — that reports a broken channel, not the bug.

## What to include

What you did, what you expected, and what happened instead. A reproduction we can run — a `curl`, a
failing test, a transaction — is usually the whole report. Tell us the commit or release you tested.

Expect an acknowledgement within a few working days. There is no bounty programme.

## Scope

Anything in a FLOP Labs repository. Note that several repositories are forks of upstream projects
(`zkVerify`, `rusty-kaspa`, `dstack`); if the bug is in unmodified upstream code, please report it
upstream as well, and say so — it helps us judge urgency.

Devnet and testnet deployments carry no value and are expected to be unstable. Findings there are still
welcome, but treat availability issues as low severity.
