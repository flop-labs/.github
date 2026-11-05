# Public triage

Each participating FLOP Labs repository runs this action daily with its repository token. A manual dispatch previews the same decisions by default. Run logs list the item number, proposed label, canonical issue or documentation URL. The action reads open issues and PRs from GitHub and never checks out a contributor's code.

- The action visits up to 48 items per run, rotating through the open backlog, with a maximum of five issue closures. Labels are additive. It uses an existing local bug, feature, documentation or question label. A removed label stays removed.
- Conventional titles such as `fix(parser): ...` supply a label directly. With a `TYPESAFE_API_KEY` Actions secret, Jev reviews eligible PRs, question-prefixed issues and items without a recognized prefix. Its input includes the item type, title, body and, for PRs, changed filenames. It abstains on incomplete file lists, more than 100 files, or PR context above 32,000 bytes. It classifies the actual change, treats regression-test-only coverage as `other`, and routes reports of contradictory documentation to the documentation label. Only public metadata and text are sent. The action validates typed answers and abstains on uncertain judgments. Without the key, title rules, simple repost detection and the curated FAQ still work.
- A duplicate must point directly to an older open defect in the same repository. Matching subject and body qualify, allowing a redundant `bug:` or `fix:` prefix or outer whitespace. Paraphrases require overlapping text, a shared literal code identifier and a high-confidence Jev judgment that both defects have the same trigger, behavior and full resolution. Shared subject matter alone leaves the issue open. GitHub records the canonical issue in the duplicate closure.
- Individual access requests, protected items, assigned or discussed defects and reopened issues are excluded from automatic closure. PRs can receive a label. The action only closes issues.
- A documentation closure requires a complete match to a curated question, a matching passage in the repository's current public docs, and an answer with a link. The initial entries cover the devnet explorer URL in `network` and how to report a typo in `yellowpaper`. A report that adds a failure or follow-up stays open.

Use a pinned commit of `flop-labs/.github/public-triage` from a default-branch schedule or manual dispatch. Grant `contents: read`, `issues: write` and `pull-requests: write` to the job. Use a dedicated, spend-limited TypeSafe key if enabling Jev.

To stop future writes, disable the caller workflow in that repository. Remove an unwanted label or reopen an issue. GitHub's timeline retains the original action and the canonical link. Remove an obsolete FAQ comment if appropriate.

Run the offline suite with `node --test public-triage/triage.test.mjs`. To preview live public data with an authenticated GitHub CLI, run `GITHUB_REPOSITORY=flop-labs/network node public-triage/triage.mjs`.
