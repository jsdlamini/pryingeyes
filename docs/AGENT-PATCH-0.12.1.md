# PryingEyes 0.12.1 — patch the repo on GitHub (instructions for an agent)

**Your only new job: apply the 0.12.1 patch to the PryingEyes repo and push it to GitHub.** Then deploy
with the local → GitHub → VPS flow you already use; nothing about deploying has changed.

Don't edit, fix or reformat any code, tests or settings yourself. If a step fails, stop and report the
output; don't work around it.

## The files

In **`/home/tux/Downloads`**:

| File | What it is |
| --- | --- |
| `AGENT-PATCH-0.12.1.md` | These instructions |
| `pryingeyes-0.12.1.patch` | One commit on top of 0.12 ("docs: 0.12 release notes and patch instructions") |
| `SHA256SUMS` | Checksum of the patch |

```bash
cd /home/tux/Downloads && sha256sum -c SHA256SUMS      # must say OK; if not, stop and report
```

## 1. Go to your local clone and update it

Use the same local clone you used for 0.12.

```bash
cd <your local clone>
git remote -v | grep -q 'jsdlamini/pryingeyes' || { echo "wrong repo"; exit 1; }
git status --short          # must print nothing; if not, stop and report
git checkout main && git pull --ff-only origin main
git log --oneline -2        # top two: "docs: 0.12 release notes and patch instructions" and "PryingEyes 0.12: …"
grep '"version"' package.json    # expect "0.12.0"
```

If the top commit is something else, `main` has moved on: still try step 2, and mention it in your report.

## 2. Apply the patch

```bash
START=$(git rev-parse HEAD)
git am /home/tux/Downloads/pryingeyes-0.12.1.patch
git log --oneline -1        # expect: "PryingEyes 0.12.1: Home, Requests, Chat and caller screens built to the redesign"
grep '"version"' package.json    # expect "0.12.1"
```

If `git am` stops with a conflict: run `git am --abort`, leave the repo as it was, and report the output.
Don't resolve conflicts yourself.

## 3. Check before pushing

The checks run in a throwaway Node container on a copy of the repo, so nothing is installed and nothing
is added to your clone. Needs Docker and internet access; takes a few minutes.

```bash
docker run --rm -v "$PWD":/src:ro node:22-bookworm-slim bash -c '
  cp -a /src /w && cd /w && rm -rf node_modules .next var &&
  npm ci --no-audit --no-fund &&
  npm run typecheck &&
  npx next build > /tmp/build.log 2>&1 && echo "BUILD OK" || { tail -40 /tmp/build.log; echo "BUILD FAILED"; } ;
  TEST_DATABASE_URL=embedded TEST_REDIS_URL=memory npx vitest run 2>&1 | tail -25'
```

(Use `sudo docker` if `docker` alone is refused.) Expect a clean typecheck, `BUILD OK`, and
**180 passed, 3 failed** — the same 3 known failures as for 0.12, in `tests/integration/calls.test.ts` (1)
and `tests/integration/contact.test.ts` (2). Typecheck errors, `BUILD FAILED`, or any **other** test
failure: stop, don't push, undo with `git reset --hard "$START"`, and report.

## 4. Push to GitHub

```bash
git push origin main
```

## 5. Deploy and report

Deploy with your usual flow. No database changes and no `.env` changes in this release.

Then tell the person who asked:

- the commit pushed (`git log --oneline -1`), the version line, and the test summary line;
- that they should hard-refresh the site on their phone (or clear the browser cache) to see the new screens:
  Home (code cards), Requests, a chat, and a code link opened while signed in as someone else.
