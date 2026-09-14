# Workflow rules

This repository takes pull requests from anyone. When it is public, anyone can fork it,
open a pull request, and CI will run on that pull request, so CI runs code and text
written by strangers. The rules below keep that from becoming a way in. They are the same
rules `rasputin-app-catalog` enforces, for the same reason. `zizmor` enforces them as the
`workflows` job in `ci.yml`, so nobody has to remember them.

## 1. Untrusted text reaches a script as data, never as source

```yaml
# NO — this is remote code execution
run: echo "${{ github.event.pull_request.title }}"

# YES
env:
  TITLE: ${{ github.event.pull_request.title }}
run: echo "$TITLE"
```

A `${{ }}` expression is pasted into the script *before* the shell runs, so a value
containing `$(...)` or a backtick executes on the runner. This applies to anything someone
outside the repository influences: pull-request titles and bodies, comment text, branch
names (`github.head_ref` and `github.base_ref` look innocent and are not), dispatch inputs,
and step outputs derived from any of them. Every workflow here passes values through `env:`
even where the value is trusted today, because a gate that has exceptions is not a gate.

## 2. Permissions start empty

Every workflow sets `permissions: {}` at the top, and each job grants itself only what it
uses. `ci.yml` and `gitleaks.yml` need `contents: read`, and `codeql.yml` adds `security-events: write` to
upload results. Only the publish job in `release.yml` holds `contents: write`, which it
needs to create the release.

Ask what a total compromise of the job would yield. If the answer is worse than "a failed
check", the grant is too wide.

## 3. Actions and tools are pinned to a hash

```yaml
uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

A tag can be moved: whoever controls the action can repoint `v7` at any code, and CI runs
that code with whatever permissions the job holds. The trailing comment keeps it readable,
and Dependabot (`.github/dependabot.yml`) proposes hash updates the same way it proposes
version bumps. Pin the tool as well as the action: `zizmor==1.29.0`, not `zizmor`.

## 4. Checkout does not leave the token behind

`persist-credentials: false` on every checkout. Otherwise the token stays in
`.git/config`, where any later step can read it. The release job publishes with `gh`,
which reads `GH_TOKEN` from its own step's environment, so it does not need the token
persisted either.

## 5. No shared cache in a job that publishes

`setup-node` runs with `package-manager-cache: false`. A cache is written by one run and
read by another, so a poisoned cache entry would end up inside a published release. The
dependency tree is two packages; the cache was saving seconds.

## What a fork's pull request can reach

| Workflow | Runs for a fork's pull request? | Token it gets | Secrets it gets |
|---|---|---|---|
| `ci.yml` | Yes, on `pull_request` | read-only | None. GitHub passes no secrets to a fork's `pull_request` run. |
| `codeql.yml` | Yes, on `pull_request` | read-only (GitHub caps a fork's token regardless of the job's grant) | None |
| `gitleaks.yml` | Yes, on `pull_request` | read-only | None. It calls the reusable secret-scanning workflow in `geekdojo/.github`, which only reads the repository. |
| `release.yml` | **No.** Only a tag push or a manual dispatch, and both need write access to this repository. | — | — |

No workflow here uses `pull_request_target`, `workflow_run` or `issue_comment`. Those
triggers run in the base repository's context, with its secrets and a writable token,
often on input a fork controls. Do not add one without the kind of review
`rasputin-app-catalog`'s `draft-tile.yml` received, and without keeping the privileged
job from ever checking out or executing the pull request's code.

No workflow references a repository or organisation secret. The only credential any job
uses is the per-run `GITHUB_TOKEN`.

## Running the audit locally

You need Python 3.9 or newer. These commands install zizmor into a throwaway virtual
environment in `.venv/` (gitignore it or delete it afterwards), so nothing is installed
system-wide:

```sh
python3 -m venv .venv                              # create the environment
.venv/bin/pip install zizmor==1.29.0               # the exact version CI uses
.venv/bin/zizmor --format plain .github/workflows/ # same invocation as CI
```

`--format plain` prints human-readable findings. A clean run prints `No findings to
report` and exits `0`; any finding makes it exit non-zero, which is what fails the CI job.
