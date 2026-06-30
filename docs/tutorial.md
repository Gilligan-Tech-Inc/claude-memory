# Claude Memory Tutorial

Claude is very good at working inside the context you give it. The hard part is that normal
sessions are temporary. When you close Claude Code or Claude Desktop, the model does not
automatically remember your project rules, deployment notes, architecture decisions, or the
preferences you explained last week.

`@gilligan-tech/claude-memory` gives Claude a local, persistent memory it can use across
sessions. It is an MCP server backed by SQLite on your machine. There is no cloud account,
no hosted database, and no tracking service.

## What Claude Remembers By Default

In a normal Claude session, Claude can use:

- the current conversation
- files and terminal output it has read during this session
- instructions from your Claude/Codex environment
- any MCP tools connected for that session

That context is powerful, but it is not the same as durable project memory. If you repeatedly
tell Claude:

- "This repo deploys from main, not from a feature branch."
- "Never run the destructive migration without a backup."
- "We use routes -> services -> repositories in this codebase."
- "I prefer concise progress updates while you work."

Claude can follow those instructions during the current session. Without a memory tool,
you usually need to repeat them next time.

## What This Tool Adds

Claude Memory adds a small set of tools Claude can call:

- `memory_bootstrap` loads saved context for a project at the start of a session.
- `memory_save` stores a rule, decision, note, preference, deployment detail, or architecture fact.
- `memory_recall` searches saved memory by keyword, type, repo, and tags.
- `memory_update`, `memory_archive`, and `memory_delete` keep old memories accurate.
- `memory_export` and `memory_import` let you back up or move your memory database.

The result is simple: Claude can start with the important background already loaded instead
of rediscovering everything from scratch.

## Install

Add the MCP server to Claude Code:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@gilligan-tech/claude-memory"]
    }
  }
}
```

Then restart Claude Code.

For faster startup, install it globally:

```bash
npm install -g @gilligan-tech/claude-memory
```

Then configure:

```json
{
  "mcpServers": {
    "memory": {
      "command": "claude-memory"
    }
  }
}
```

## The First Session

Start by choosing a project slug. Use something stable and short, like:

- `my-app`
- `api-service`
- `company-site`
- `mobile-app`

Then tell Claude:

```text
Load my memory for the api-service project.
```

Claude should call:

```text
memory_bootstrap(repo: "api-service")
```

If there are no memories yet, that is fine. The tool will say so. You can start saving useful
project context right away.

## Save The First Useful Memories

Good memories are specific, reusable, and likely to matter in a future session.

Example:

```text
Remember for api-service: deploys go through ./deploy.sh on the main branch. Do not deploy
from a dirty worktree.
```

Claude should save something like:

```text
memory_save(
  repo: "api-service",
  type: "deploy",
  content: "Deploys go through ./deploy.sh on the main branch. Do not deploy from a dirty worktree.",
  tags: ["deploy", "safety"]
)
```

Another example:

```text
Remember that this repo uses routes -> services -> repositories. Keep business logic out of routes.
```

Claude should save:

```text
memory_save(
  repo: "api-service",
  type: "architecture",
  content: "The repo uses routes -> services -> repositories. Keep business logic out of routes.",
  tags: ["architecture"]
)
```

## What To Save

Save facts that you would otherwise repeat:

- coding rules
- repo architecture
- deployment steps
- production URLs and non-secret environment names
- design decisions and why they were made
- user preferences for how Claude should work
- common test commands
- known pitfalls
- release procedures

Good:

```text
The checkout flow uses Stripe Checkout Sessions, not raw PaymentIntents, because subscriptions
and tax settings are managed in Stripe.
```

Good:

```text
Run npm run build and npm run test:e2e before calling frontend work complete.
```

Too vague:

```text
This repo is complicated.
```

Too sensitive:

```text
The production database password is ...
```

Do not save secrets. Use your normal secret manager for API keys, passwords, tokens, and private
credentials.

## Memory Types

Use the type to help Claude rank and load the right context:

| Type | Use for |
| --- | --- |
| `rules` | Coding conventions, required workflows, safety constraints |
| `architecture` | System design, components, boundaries, patterns |
| `deploy` | Deployment steps, servers, release procedure, environment notes |
| `decision` | Why a choice was made |
| `preference` | Personal working style |
| `note` | General useful context |

`rules` and `architecture` are especially important because they tend to be useful at session
startup.

## How Claude Uses Memory During Work

A practical memory-assisted session looks like this:

```text
You: Load my memory for api-service.

Claude: calls memory_bootstrap("api-service")
Claude: reads project rules, architecture notes, deploy notes, and global preferences.

You: Add pagination to the customers endpoint.

Claude: works with the repo conventions already in mind.

You: The team decided cursor pagination is required because offset pagination times out on large tenants.

Claude: calls memory_save with type "decision".
```

Later, in a new session:

```text
You: Load my memory for api-service.

Claude: sees the cursor-pagination decision during bootstrap or recall.
Claude: avoids reintroducing offset pagination.
```

That is the main benefit: fewer repeated explanations, fewer accidental reversals of past
decisions, and faster ramp-up each time you return to a project.

## Search Old Context

If you remember that a decision exists but not the exact details, ask Claude:

```text
Search my api-service memory for pagination decisions.
```

Claude can call:

```text
memory_recall(
  repo: "api-service",
  query: "pagination decisions",
  type: "decision"
)
```

You can also search by tags:

```text
Find deploy memories tagged safety.
```

## Keep Memory Accurate

Memory is only useful when it stays current.

If something changes, say so directly:

```text
Update the deploy memory: we now deploy with ./scripts/release.sh, not ./deploy.sh.
```

Claude can use `memory_update` when it knows the memory ID, or save a new decision if the old
context should remain as history.

If a memory is no longer active but you do not want to delete it:

```text
Archive the old Heroku deploy note.
```

Claude can use `memory_archive`, which hides it from normal bootstrap and recall.

Use delete only when a note is wrong, sensitive, duplicated, or should not exist:

```text
Delete memory #42.
```

## Global Preferences

Leave `repo` empty for global memories that should apply everywhere.

Examples:

```text
Remember globally: I prefer short progress updates while you work.
```

```text
Remember globally: before changing files, explain the intended edit in one sentence.
```

These memories are loaded alongside project-specific memories.

## Backup And Move Memories

The database lives locally at:

```text
~/.claude-memory/memory.db
```

You can change the location:

```bash
CLAUDE_MEMORY_DB=/path/to/memory.db claude-memory
```

Use `memory_export` to create a JSON backup and `memory_import` to restore or move memories
between machines.

## A Good Starting Set

For a new project, ask Claude to save these:

```text
Remember the repo architecture.
Remember the main test commands.
Remember the deployment process.
Remember the branch and release rules.
Remember any security constraints.
Remember my working preferences for this repo.
```

You do not need to build a perfect memory system on day one. Start with the facts you are tired
of repeating. Claude Memory becomes more useful as it collects the decisions and rules that
actually shape your work.
