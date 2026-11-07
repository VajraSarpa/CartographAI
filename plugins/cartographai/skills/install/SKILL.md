---
name: install
description: Install and set up a self-hosted CartographAI. Clones the repo, installs it, lists the accounts and keys needed, walks through each service, checks the keys, and starts the app. Use when someone wants to install, self-host or set up CartographAI.
argument-hint: "[install folder]"
disable-model-invocation: true
---

# Install CartographAI

You are guiding someone through installing CartographAI ("Every connection,
proven.") on their own computer, from https://github.com/VajraSarpa/cartograph.

## How to work

- Plain English, short steps, one thing at a time. Wait for them to say a
  step is done before moving on.
- Ask at most one question at a time, and say which answer you'd pick and why.
- **Never ask for, accept, read or print a key, token or password.** All keys
  are entered by the person in their own terminal through `pnpm env:setup`,
  which hides what they type. Never open, cat, grep or print `.env.local`,
  `cartograph-agent/.env` or `.agent-signing-key.jwk.json`. If they paste a
  secret into the chat anyway, stop, tell them that key is now exposed and
  must be rotated in its service, and carry on once they've made a new one.
- Run commands for them where it's safe (checks, clone, install, tests).
  Don't install system software (Node, Git) without asking first, and never
  use `sudo` on their behalf.
- Follow the repo's own docs once it's cloned: `docs/SETUP.md` (accounts and
  keys) and `docs/DEPLOY.md` (Vercel). If a doc and this skill disagree, the
  doc wins.

## Step 0: say what's ahead

Before running anything, tell them, briefly:

- Time: about 30–45 minutes, mostly creating accounts.
- Accounts they need (all have free tiers except Anthropic):

  | Service | Why | Cost |
  |---|---|---|
  | GitHub | to sign in to CartographAI | free |
  | Clerk (clerk.com) | sign-in and teams | free tier |
  | Supabase (supabase.com) | database | free tier |
  | Anthropic (console.anthropic.com) | Explain and Ask | pay per use; $10 of credit is plenty to try it |
  | LangSmith (smith.langchain.com) | tracing and evals | optional |
  | GitHub token | raises GitHub's download limit | optional, recommended if deploying |
  | Vercel (vercel.com) | hosting it online | optional, only to deploy |

- The values they'll collect along the way, and where each goes:

  | From | Values |
  |---|---|
  | Clerk | publishable key `pk_test_…`, secret key `sk_test_…`, and the Clerk domain `xxx.clerk.accounts.dev` (pasted into Supabase, not into CartographAI) |
  | Supabase | project URL `https://<ref>.supabase.co`, publishable key `sb_publishable_…`, secret key `sb_secret_…` |
  | Anthropic | API key `sk-ant-…` |
  | LangSmith (optional) | API key `lsv2_…` |
  | GitHub (optional) | fine-grained token `github_pat_…` |

- Reassure them: they'll type every key into their own terminal, never into
  this chat.

Then ask where to install it. Default: the folder given as an argument, else
`~/Projects/cartograph` (on Windows, `%USERPROFILE%\Projects\cartograph`).

## Step 1: check the tools

Run and report: `git --version`, `node --version`, `corepack --version`.

- Node must be 22 or newer. If it's missing or older, explain the options
  (nvm / nvm-windows, Homebrew `brew install node@22`, or nodejs.org) and ask
  before installing anything.
- Git missing: point them to git-scm.com (or Xcode command line tools on
  macOS) and wait.

## Step 2: get the code

- If the folder doesn't exist: `git clone https://github.com/VajraSarpa/cartograph.git <folder>`.
- If it exists and is a clone of that repo: `git -C <folder> pull --ff-only`.
- If it exists and is something else: stop and ask for another folder.

Then in the folder: `corepack enable && pnpm install`, then `pnpm test`.
Tests need no keys; if they pass, the install is sound. If `corepack enable`
fails with a permissions error, try `npx pnpm@latest install` and tell them why.

## Step 3: create the accounts

Walk through `docs/SETUP.md` sections 1–5, one service at a time, in its
order (Clerk first, because Supabase needs the Clerk domain). For each:

1. Say what to click, in the doc's words.
2. Say which values to keep handy for later, what they look like, and that
   they're entered in Step 4, not here.
3. Wait for "done".

Point out these two steps, which people miss:
- Clerk → Sessions → **Customize session token**:
  `{ "org_name": "{{org.name}}" }`
- Supabase → SQL Editor: paste the whole of
  `supabase/migrations/20261105000000_init.sql` and run it. Offer to open the
  file or show its path; it contains no secrets.

## Step 4: enter the keys (they do this, not you)

Ask them to open a separate terminal in the install folder and run:

```bash
pnpm env:setup
```

It asks for each value in order and hides secrets as they type. Enter keeps
the default; optional ones can be skipped. When they say it's done, run:

- `pnpm env:doctor`: shows what's set or missing, never the values.
- `pnpm env:check`: confirms each key with its service (`ok` / `FAIL`).

For any `FAIL`, say which service and the likely cause (wrong key, or a
`pk_live` vs `pk_test` mix-up), and have them rerun
`pnpm env:setup --only <clerk|supabase|anthropic|langsmith|github>`.

## Step 5: turn on Ask

Ask needs a signing key that Supabase trusts:

1. Run `pnpm agent key`. It saves the key to `.env.local` and writes
   `.agent-signing-key.jwk.json`. Do not open or print that file.
2. They import it in Supabase: Project Settings → **JWT Keys** →
   **Create standby key** → **Import an existing private key** (ES256) →
   paste the file's contents (they open it themselves) → save.
3. Once they confirm, delete `.agent-signing-key.jwk.json`.

`pnpm agent check` can verify it after Step 6, once a repository has been
analyzed.

## Step 6: start it and try it

Run `pnpm dev` in the background, then tell them to open
http://localhost:3000 and:

1. Sign in with GitHub and name their team.
2. Analyze `https://github.com/expressjs/express`.
3. Click a file, then try **Explain** and the **Ask** tab ("What breaks if I
   change lib/utils.js?").

Then run `pnpm agent check`. If anything fails, read the terminal output from
`pnpm dev` (it never contains keys) and fix the cause with them.

## Step 7 (optional): put it online

Only if they want it hosted: follow `docs/DEPLOY.md` with them, step by step.
Vercel needs the same values; the doc lists which to copy and which to leave
out (`APP_URL`, `AGENT_URL`).

## Finish

Summarise in a few lines: where it's installed, what works (map, Explain,
Ask), what was skipped (LangSmith, deploy), and the two commands they'll use
again: `pnpm dev` to start it and `pnpm env:doctor` to check settings.
