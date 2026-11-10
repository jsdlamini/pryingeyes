# PryingEyes 0.12 — patch the repo on GitHub (instructions for an agent)

**Your only new job: apply the 0.12 patch to the PryingEyes repo and push it to GitHub.** Then deploy
with the local → GitHub → VPS flow you already use; nothing about deploying has changed.

Don't edit, fix or reformat any code, tests or settings yourself. If a step fails, stop and report the
output; don't work around it.

## The files

In **`/home/tux/Downloads`**:

| File | What it is |
| --- | --- |
| `AGENT-PATCH-0.12.md` | These instructions |
| `pryingeyes-0.12.patch` | Two commits on top of `ca3d490` ("Share contact code by default") |
| `SHA256SUMS` | Checksum of the patch |

```bash
cd /home/tux/Downloads && sha256sum -c SHA256SUMS      # must say OK; if not, stop and report
```

## 1. Go to your local clone and update it

Use the local clone of `github.com/jsdlamini/pryingeyes` you already deploy from.

```bash
cd <your local clone>
git remote -v | grep -q 'jsdlamini/pryingeyes' || { echo "wrong repo"; exit 1; }
git status --short          # must print nothing; if not, stop and report
git checkout main && git pull --ff-only origin main
git log --oneline -1        # expect: ca3d490 Share contact code by default …
```

If the top commit is not `ca3d490`, `main` has moved on since the patch was made: still try step 2, and
mention it in your report.

## 2. Apply the patch

```bash
git am /home/tux/Downloads/pryingeyes-0.12.patch
git log --oneline -3
```

Expect, newest first:

```
… docs: 0.12 release notes and patch instructions
… PryingEyes 0.12: private uploads, SSRF-safe previews, codes-first navigation
ca3d490 Share contact code by default (reversible in Settings)
```

If `git am` stops with a conflict: run `git am --abort`, leave the repo as it was, and report the output.
Don't resolve conflicts yourself.

## 3. Check before pushing

Node.js doesn't need to be installed where you are: the checks run in a throwaway Node container, on a
copy of the repo, so nothing is installed and no files are added to your clone. Needs Docker and internet
access (to download packages); takes a few minutes.

```bash
docker run --rm -v "$PWD":/src:ro node:22-bookworm-slim bash -c '
  cp -a /src /w && cd /w && rm -rf node_modules .next var &&
  npm ci --no-audit --no-fund &&
  npm run typecheck &&
  TEST_DATABASE_URL=embedded TEST_REDIS_URL=memory npx vitest run 2>&1 | tail -25'
```

(Use `sudo docker` if `docker` alone is refused.) Expect a clean typecheck and **180 passed, 3 failed**.
The 3 expected failures are in `tests/integration/calls.test.ts` (1) and `tests/integration/contact.test.ts` (2).
They already failed before this patch and are not caused by it. Typecheck errors or any **other** failure:
stop, don't push, undo with `git reset --hard ca3d490` (or the commit you started from), and report.

## 4. Push to GitHub

```bash
git push origin main
```

## 5. Deploy and report

Deploy with your usual flow. The new database table (migration `0018_uploads`) is created automatically
when the app starts; no `.env` changes are needed. As with any release, have a backup of the data
volume before deploying.

Then tell the person who asked:

- the commit pushed (`git log --oneline -1`) and the test summary line;
- this reminder, word for word: "The phone app must send its sign-in token when loading photos and
  voice notes; until it's updated, media won't load in the phone app. The website is not affected."
- that someone should now do the manual checks in `docs/RELEASE-0.12.md` ("Manual checks after deploying").
