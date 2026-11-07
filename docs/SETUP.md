---
title: Cartograph account setup
subtitle: What to create in each service, where each key lives, and how to enter it
toc: true
theme: cyan
---

Do these in order. Clerk comes first because Supabase needs a value from it.
Never paste a key into chat or a file: every key goes in at the end through
`pnpm env:setup`, which hides what you type.

## 1. Clerk

Site: dashboard.clerk.com

### Set up

1. **Create application.** Name it "Cartograph". Under sign-in options, tick
   **GitHub** (you can untick Email) and click Create.
2. **Turn on teams.** Configure → **Organizations** → Enable. Leave personal
   accounts allowed, so team membership stays optional.
3. **Add a claim to the session token.** Configure → **Sessions** →
   **Customize session token**. Paste exactly this, then Save:

   ```json
   { "org_name": "{{org.name}}" }
   ```

4. **Connect Supabase.** Go to clerk.com/setup/supabase (or search the
   dashboard for "Supabase") → **Activate Supabase integration**. It shows a
   **Clerk domain** like `xxx.clerk.accounts.dev`. Copy it for step 2.2.

### Keys to enter later

| Value | Where | Looks like |
|---|---|---|
| Publishable key | Configure → API keys | `pk_test_…` |
| Secret key | Configure → API keys | `sk_test_…` |

## 2. Supabase

Site: supabase.com/dashboard

### Set up

1. **New project.** Pick a US region. Save the database password somewhere
   safe.
2. **Trust Clerk.** Authentication → **Sign In / Providers** →
   **Third-party Auth** → **Add provider** → **Clerk**. Paste the Clerk domain
   from step 1.4.
3. **Create the tables.** Open **SQL Editor** → New query. Paste the whole
   contents of `supabase/migrations/20261105000000_init.sql` and click
   **Run**. It should say "Success. No rows returned".

### Keys to enter later

| Value | Where | Looks like |
|---|---|---|
| Project URL | Project Settings → Data API | `https://<ref>.supabase.co` |
| Publishable key | Project Settings → API Keys | `sb_publishable_…` |
| Secret key | Project Settings → API Keys | `sb_secret_…` |

If only "legacy" keys show, click **Create new API keys**.

## 3. Anthropic

Site: console.anthropic.com

1. **Plans & Billing.** Add a card and some credit. $10 is plenty for
   testing.
2. Settings → **API Keys** → **Create Key**, named "cartograph". The key
   (`sk-ant-…`) is shown once, so leave the page open until you have entered
   it.

## 4. LangSmith

Site: smith.langchain.com (US region)

Settings → **API Keys** → **Create API Key** → **Personal Access Token**.
Copy the key (`lsv2_…`). It is shown once.

## 5. GitHub token (optional, recommended)

Site: github.com/settings/personal-access-tokens

**Generate new token** (fine-grained):

- Repository access: **Public repositories**
- Permissions: none
- Expiration: 90 days

The token starts with `github_pat_…`. Without it, Vercel's shared servers
quickly hit GitHub's limit of 60 anonymous requests an hour.

## 6. Enter everything

In a terminal (the VS Code terminal works):

```bash
cd ~/Projects/CartogrphAI/cartograph
pnpm env:setup
```

It asks for each value in order. What you type for a secret stays hidden.
Pressing Enter keeps the default shown in brackets. It writes `.env.local`
and `cartograph-agent/.env`, readable only by you and ignored by git.

To check what is still missing without showing any values:

```bash
pnpm env:doctor
```

## 7. What happens next

Vercel needs nothing yet. Once the keys are in:

1. `pnpm env:check` confirms every key with its service.
2. `pnpm agent key` generates the agent's signing key. You import it once in
   Supabase (Project Settings → JWT Keys → **Create standby key** → import
   the private key), then the file is deleted.
3. End-to-end test: sign in, analyze a repo, map, Explain, Ask.
4. Deploy the app to Vercel and the agent to LangSmith.
