# Generate Tasks from Epic

Analyze an Epic description and automatically create **Discovery tasks and implementation task** `.md` files inside the Epic folder. Tasks are optimized for autonomous execution by Claude Code — not for human consumption.

## Usage

Provide the path to an Epic folder (e.g., `Epic-Auth`) or the `epic.md` file inside it. The path is resolved relative to the `Board/` directory.

**Argument**: $ARGUMENTS (path to the Epic folder or epic.md file)

## Instructions

1. Resolve the Epic path:
   - If the argument is a folder name (e.g., `Epic-Auth`), look for `epic.md` inside it.
   - If the argument is a file path ending in `epic.md`, use it directly.
   - If the path doesn't start with `/`, resolve relative to the `Board/` directory inside the project.
2. Read the `epic.md` file and parse YAML frontmatter + body.
3. List existing `.md` files in the Epic folder (excluding `epic.md`) — these are existing children to avoid duplication.
4. **Cross-epic context**: Read ALL other Epic folders in the `Board/` directory (excluding the current Epic). For each other epic:
   - Read its `epic.md` file and extract the Epic name, status, and first ~500 characters of its goal/scope description.
   - List its child story file names and their status (from YAML frontmatter).
   Use this information to avoid generating tasks that overlap with work in other epics. If you identify dependencies between the current Epic and another Epic, note them in the generated tasks' Dependencies sections.
5. Analyze the Epic description and generate tasks using the methodology and criteria below.
6. **Show the user a summary** of all tasks to be created (type, name, priority, 1-line description) and **ask for confirmation** before writing files.
7. If confirmed, create each task as a `.md` file inside the Epic folder with proper YAML frontmatter and markdown body.
8. Use the numbered filename pattern `S{epic}-{story}-{slug}.md` where:
   - `{epic}` = Epic number extracted from the Epic folder name (e.g., "Epic-1" → 1, "E02" → 2)
   - `{story}` = Sequential story number starting from 1
   - `{slug}` = Kebab-case slug derived from the task name
   - Example: For Epic-1, first task "Research Auth Strategy" → `S1-1-research-auth-strategy.md`
   - If Epic has no number, use pattern `S{story}-{slug}.md` (e.g., `S1-research-auth-strategy.md`)

## Methodology

Each task will be executed autonomously by Claude Code in a single session. Write instructions as direct orders — not agile ceremonies.

### Discovery-First Approach
- For complex features where the implementation approach is unclear (choice of library, architecture pattern, API design, etc.), create a **Discovery task BEFORE the implementation task**.
- Discovery tasks (type: `Discovery`) research and document the recommended approach. They use `model: claude-opus-4-6` for deeper analysis.
- The Discovery task output MUST be saved to a markdown file inside the project (e.g., `docs/discoveries/auth-strategy.md`). This file becomes the reference for subsequent tasks.
- Tasks that follow a Discovery MUST reference the Discovery output file in their Dependencies section.

### When to Use Discovery vs Inline Research
- **Use a Discovery task** for complex decisions: choosing frameworks/libraries, defining API contracts, architectural patterns, database schema design, integration strategies.
- **Use inline ACs** (within a task) for simpler research: checking if a package exists, reading existing code to understand a pattern, minor technology choices.

### Incremental Delivery
- Order tasks so each builds on the previous one — never assume something exists that hasn't been built yet.
- Each task should produce a working, testable increment.
- Earlier tasks lay foundations; later tasks add features on top.

## Task Generation Criteria

You are a technical architect breaking down an Epic into executable tasks for Claude Code. Analyze the Epic and produce an incremental sequence of Discovery tasks and implementation tasks.

### For Discovery tasks, produce:

- **type**: `Discovery`
- **name**: "Research [topic]" (e.g., "Research authentication strategy")
- **priority**: P0-P3
- **model**: `claude-opus-4-6`
- **body**: Complete markdown body with this structure:

```
# [Discovery Name]

Research and document the recommended approach for [topic].

## Research Questions
- [ ] What are the available options for [topic]?
- [ ] What are the trade-offs of each option?
- [ ] Which option is recommended for this project and why?

## Acceptance Criteria
- [ ] Research document created at `docs/discoveries/[topic-slug].md`
- [ ] Document includes comparison of alternatives with pros/cons
- [ ] Document includes a clear recommendation with justification
- [ ] Document includes implementation guidelines for the recommended approach

## Output
Save findings to: `docs/discoveries/[topic-slug].md`

## Dependencies
- None (or list if depends on another Discovery)

## Completion
- [ ] Research document created and complete
- [ ] Commit: `docs(discovery): research [topic]`
```

### Model Selection Guide

Choose the Claude model for each task based on its complexity and nature:

- **claude-opus-4-6** — Use for Discovery tasks, complex architectural work, large refactors, tasks requiring deep reasoning or multi-file coordination, and tasks explicitly marked as needing Opus.
- **claude-sonnet-4-5-20250929** — Use for standard implementation tasks: building features, writing tests, adding endpoints, creating components, bug fixes with clear scope.
- **claude-haiku-4-5-20251001** — Use for simple/mechanical tasks: config changes, dependency installs, renaming, boilerplate generation, documentation-only tasks, chores.

When in doubt, prefer Sonnet. Only use Opus when the task genuinely requires deeper analysis.

### For implementation tasks, produce:

- **type**: `UserStory`
- **name**: Imperative form (e.g., "Implement login form", "Add JWT authentication endpoint")
- **priority**: P0-P3
- **model**: Choose based on task complexity (see Model Selection Guide above)
- **body**: Complete markdown body with this structure:

```
# [Task Name]

[1-3 sentences: imperative description of what to build. Be specific about scope and expected outcome. No "As a user..." format.]

## Acceptance Criteria
- [ ] [Technically verifiable condition — checkable by tests, build, or code inspection]
(3-8 ACs per task. Each must be specific, verifiable, and actionable.)

## Implementation
1. [Step with specific file path] (e.g., "Create `src/components/LoginForm.tsx`")
2. [Step with specific change] (e.g., "Add form validation using zod schema")
(Numbered, sequential. Each step is a concrete action Claude Code executes.)

## Tests
- File: `[specific test file path]`
- [Specific test case 1]
- [Specific test case 2]
- Or "N/A — infrastructure/research task"
- NEVER include manual testing steps

## Dependencies
- Reference Discovery output files if applicable (e.g., "See `docs/discoveries/auth-strategy.md`")
- List other prerequisites or blocking tasks
- Or "None" if standalone

## Completion
- [ ] Tests pass (or N/A)
- [ ] Build passes
- [ ] Commit: `type(scope): description`
```

### Rules

1. **DO NOT duplicate** tasks that already exist as children of the Epic.
2. **Cross-epic awareness**: Review other epics' scope and stories on the board. Do NOT generate tasks that duplicate work in other epics. Note cross-epic dependencies in the Dependencies section.
3. Each task should be completable by Claude Code in a single session.
4. **Order tasks incrementally**: Discoveries first, then foundational tasks, then features that build on them.
5. Generate between 2 and 15 tasks. Do not generate more than 15.
6. Use imperative language: "Research X", "Implement Y", "Add Z", "Create W".
7. Reference specific file paths in implementation steps when possible.
8. **NEVER include manual tests** — only automated tests (unit, integration, e2e).
9. No "As a user..." or "User Story" format — write direct implementation instructions.

### Acceptance Criteria Rules (STRICT)

Every AC in every task must follow these rules:

1. **Assertable via automated test** — every AC must be expressible as a unit, integration, or e2e assertion.
   - GOOD: "Submit button is disabled when form has validation errors"
   - GOOD: "POST /api/login returns 401 for invalid credentials"
   - BAD: "User sees an error message" (requires human eyes)
   - BAD: "Page renders correctly" (not a meaningful assertion)
   - BAD: "The UI looks clean" (untestable)

2. **No overlap with Completion section** — do not add ACs for "TypeScript compiles", "linter passes", or "tests pass". Those go in Completion.

3. **No redundancy** — each AC tests a distinct behavior or code path. Merge or remove overlapping ACs.

4. **Keep it tight** — 3-8 ACs per task. Only what meaningfully defines "done".

### YAML Frontmatter for Discovery tasks

```yaml
---
name: Research [Topic]
priority: [P0-P3]
type: Discovery
status: Not Started
model: claude-opus-4-6
---
```

### YAML Frontmatter for implementation tasks

```yaml
---
name: [Task Name]
priority: [P0-P3]
type: UserStory
status: Not Started
model: [claude-sonnet-4-5-20250929 or claude-haiku-4-5-20251001 based on complexity]
---
```

## Output Rules

- Create files only inside the Epic folder (same directory as `epic.md`)
- Use numbered filename pattern `S{epic}-{story}-{slug}.md`:
  - Extract Epic number from folder name (e.g., "Epic-1" → 1, "E02-Auth" → 2)
  - Number tasks sequentially starting from 1
  - Convert task name to kebab-case slug
  - Examples: `S1-1-research-auth-strategy.md`, `S1-2-implement-login-form.md`, `S2-1-setup-database.md`
  - If Epic has no number in its name, use `S{story}-{slug}.md` (e.g., `S1-research-auth-strategy.md`)
- Each file must have valid YAML frontmatter with `name`, `priority`, `type`, `status`, and `model` fields
- Discovery tasks use `model: claude-opus-4-6`; implementation tasks use Sonnet or Haiku based on complexity (see Model Selection Guide)
- The `status` must always be `Not Started`
- Do not modify the `epic.md` file itself
- After creating all files, list what was created with their filenames and types
