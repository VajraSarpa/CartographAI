---
title: Using Cartograph
subtitle: Start it, map a repository, and read what the map tells you
toc: true
theme: cyan
---

Cartograph turns a public TypeScript or JavaScript repository on GitHub into a
map. Folders are boxes. Lines are imports. An import line exists only when
the parser found a real import that points at a real file: nothing is
guessed.

## 1. Start it on your computer

You need two terminals, both in the project folder. Use Node 22: run
`nvm use 22` first if your terminal defaults to an older version.

**Terminal 1, the app:**

```bash
cd ~/Projects/CartogrphAI/cartograph
pnpm dev
```

**Terminal 2, the Ask agent** (only needed for the Ask tab):

```bash
cd ~/Projects/CartogrphAI/cartograph
pnpm dev:agent
```

Open **http://localhost:3000**. To stop either one, click its terminal and
press **Ctrl+C**.

Once Cartograph is deployed, you skip this step and use its web address
instead.

## 2. Sign in and pick your team

1. Click **Sign in** and continue with GitHub.
2. The first time, you name your team (an "organization"). Everything you
   analyze belongs to that team, and only its members can see it.
3. The team name shows top left. Click it to switch teams, create another
   one, or invite people.

## 3. Map a repository

1. On the dashboard, paste a public GitHub URL, for example
   `https://github.com/expressjs/express`.
2. Click **Analyze**. You see four steps: **Fetch** (download from GitHub),
   **Select** (keep code files), **Parse** (read every import), **Store**
   (save the map for your team).
3. Most repositories finish in seconds. The map opens by itself.

To map a branch or tag, paste its GitHub URL, such as
`https://github.com/owner/repo/tree/v2`.

If you analyze a repository your team already mapped, you get the saved map
instantly. Click **Re-analyze** (top right of a map) to fetch the latest
commit.

## 4. Read the screen

The map page has three parts.

| Part | What it shows |
|---|---|
| Left rail | Framework detected, **Roles** (routes, pages, entry points), **Insights** |
| Middle | The map: folders as boxes, files as rows, imports as lines |
| Right panel | **Overview** of the repository, or the selected file; the **Ask** tab |

### Move around the map

- **Scroll** to zoom, **drag** the background to pan.
- The **+ / − / frame** buttons bottom left zoom in, out, and fit everything.
- Folder boxes start folded, showing a file count. Click a box's title to
  open it and see its files; click again to fold it.

### Select a file

Click any file, in an open folder box or in any list in the panels. The map highlights its neighbours
and dims everything else:

- **Green** lines: files that **import** it.
- **Amber** lines: files **it** imports.

The right panel shows the file's details: kind, lines, what imports it, and
what it imports. Press **Escape** or click empty background to clear the
selection. Selecting never contacts the server, so it is instant.

### Blast radius and dependency chain

With a file selected, the right panel has two buttons:

- **Blast radius**: every file that imports this one, directly or through
  others. This is what may break if you change it. Grouped into **One
  step**, **Two steps**, and **Three or more steps**.
- **Dependency chain**: every file this one relies on, grouped the same way.

### Roles and Insights (left rail)

- **Roles** come from framework rules. Examples: Next.js pages, Nest
  controllers, Express servers, HTML script entries. A **Routes** list shows
  only routes whose method and full path are both written in the code.
  Click a role to filter the map to those files; **Clear filter** undoes it.
- **Insights** lists facts the graph can show: **Import cycles**, **Heavy
  fan-in** (files many others import), **Large files (500+ lines)**, and
  **Nothing imports these**.

"Nothing imports these" does not mean "unused". Tests, scripts and config
files are often run by tools, not imported. Cartograph never grades code
quality: the graph cannot know.

### The numbers in the Overview

| Number | Meaning |
|---|---|
| Files parsed | Code files read |
| Files skipped | Code files too big to read (listed, never hidden) |
| Imports resolved | Import statements that point at a file in this repository. The map footer's "connections" count is lower: several imports between the same two files draw one line |
| External packages | Imports of npm packages (not drawn) |
| Not resolved (with reason) | Imports the parser could not match, each with its reason |
| Lines | Total lines of code |

## 5. Explain (AI)

Select a file or folder and click **Explain**. Claude reads the file's code
and its place on the map, and writes a short plain-English explanation.

- The first time takes a few seconds. After that the same explanation
  returns instantly, marked **From cache (no model call)**.
- Claude may only name files it was shown. If it names a path it was not
  shown, Cartograph strikes it through and labels it **Not in the map**.
- **Explain again** asks for a fresh one.

## 6. Ask (AI agent)

Open the **Ask** tab in the right panel and type a question about this
repository. Good questions:

- *Where is authentication handled?*
- *What are the entry points?*
- *What breaks if I change the most depended-on file?*

You see each step the agent takes (looking up files, reading source,
tracing blast radius), then its answer. It can only read this one map and
this repository's code. It declines to judge whether code is "good".

## 7. Limits and cost

Each team gets, per day: **30** analyses, **200** explanations and **100**
questions. Explain and Ask use your Anthropic credit, a few cents each.
Analyzing uses no AI and costs nothing.

You can watch every AI call, with its cost and timing, in LangSmith under the
**cartograph** project.

## 8. When something goes wrong

| You see | Do this |
|---|---|
| "Repository not found, or it is not public" | Check the URL; private repos are not supported |
| "GitHub rate limit reached" | Wait an hour, or add a GitHub token with `pnpm env:setup --only github` |
| "Ask is not configured" | Start terminal 2 (`pnpm dev:agent`) |
| "Your team reached today's limit" | Try again tomorrow |
| "Stored by an older parser" | Click **Re-analyze** |
| Page won't load at localhost:3000 | Check terminal 1 is running; restart with `pnpm dev` |
| Anything else | Run `pnpm env:check` to test every key |
