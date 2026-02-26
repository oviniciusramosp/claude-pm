# Generate Tasks from Epic

Analyze an Epic description and automatically create **Discovery tasks and User Story** `.md` files inside the Epic folder, following agile methodology.

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
5. Analyze the Epic description and generate tasks using the agile methodology and criteria below.
6. **Show the user a summary** of all tasks to be created (type, name, priority, 1-line description) and **ask for confirmation** before writing files.
7. If confirmed, create each task as a `.md` file inside the Epic folder with proper YAML frontmatter and markdown body.
8. Use the numbered filename pattern `S{epic}-{story}-{slug}.md` where:
   - `{epic}` = Epic number extracted from the Epic folder name (e.g., "Epic-1" → 1, "E02" → 2)
   - `{story}` = Sequential story number starting from 1
   - `{slug}` = Kebab-case slug derived from the task name
   - Example: For Epic-1, first task "Research Auth Strategy" → `S1-1-research-auth-strategy.md`
   - If Epic has no number, use pattern `S{story}-{slug}.md` (e.g., `S1-research-auth-strategy.md`)

## Agile Methodology

Follow these agile principles when generating tasks:

### Discovery-First Approach
- For complex features where the implementation approach is unclear (choice of library, architecture pattern, API design, etc.), create a **Discovery task BEFORE the implementation story**.
- Discovery tasks (type: `Discovery`) research and document the recommended approach. They use `model: claude-opus-4-6` for deeper analysis.
- The Discovery task output MUST be saved to a markdown file inside the project (e.g., `docs/discoveries/auth-strategy.md`). This file becomes the reference for subsequent User Stories.
- The User Story that follows a Discovery task MUST reference the Discovery output file in its Dependencies section.

### When to Use Discovery vs Inline Research
- **Use a Discovery task** for complex decisions: choosing frameworks/libraries, defining API contracts, architectural patterns, database schema design, integration strategies.
- **Use inline ACs** (within a UserStory) for simpler research: checking if a package exists, reading existing code to understand a pattern, minor technology choices.

### Incremental Delivery
- Order tasks so each builds on the previous one — never assume something exists that hasn't been built yet.
- Each task should produce a working, testable increment of the product.
- Earlier tasks lay foundations; later tasks add features on top.

## Task Generation Criteria

You are a senior product manager and prompt engineering expert following agile methodology. Analyze the Epic and break it down into an incremental sequence of Discovery tasks and User Stories.

### For Discovery tasks, produce:

- **type**: `Discovery`
- **name**: "Research [topic]" (e.g., "Research authentication strategy")
- **priority**: P0-P3
- **model**: `claude-opus-4-6`
- **body**: Complete markdown body with this structure:

```
# [Discovery Name]

**Goal**: Research and document the recommended approach for [topic].

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

## Standard Completion Criteria
- [ ] Research document created and complete
- [ ] Commit: `docs(discovery): research [topic]`
```

### For User Stories, produce:

- **type**: `UserStory`
- **name**: Imperative form (e.g., "Implement login form")
- **priority**: P0-P3
- **body**: Complete markdown body with this structure:

```
# [Story Name]

**User Story**: As a [role], I want [goal] so that [benefit].

## Acceptance Criteria
- [ ] First acceptance criterion (specific, testable, checkbox format)
- [ ] Second acceptance criterion
(... typically 3-8 per story)

## Technical Tasks
1. First implementation step with specific file paths when possible
2. Second implementation step
(... numbered, sequential steps)

## Tests
- Describe automated tests to write (unit, integration, e2e)
- Mention specific test file paths if applicable
- Or "N/A — infrastructure task" if no tests needed
- NEVER include manual testing steps

## Dependencies
- Reference Discovery output files if applicable (e.g., "See `docs/discoveries/auth-strategy.md` for implementation approach")
- List any other prerequisites or blocking tasks
- Or "None" if standalone

## Standard Completion Criteria
- [ ] Automated tests written and passing (or N/A)
- [ ] TypeScript compiles without errors
- [ ] Linter passes
- [ ] Commit message follows conventional commits format
```

### Rules

1. **DO NOT duplicate** tasks that already exist as children of the Epic.
2. **Cross-epic awareness**: Review other epics' scope and stories on the board. Do NOT generate tasks that duplicate work in other epics. Note cross-epic dependencies in the Dependencies section.
3. Each task should be small enough for a single developer to complete in one session.
4. **Order tasks incrementally**: Discoveries first, then foundational stories, then features that build on them.
5. Generate between 2 and 15 tasks. Do not generate more than 15.
6. Use imperative language: "Research X", "Implement Y", "Add Z", "Create W".
7. Each acceptance criterion must be specific and testable — avoid vague ACs like "works correctly".
8. Include UI behavior, data validation, error handling, and edge cases in ACs.
9. Reference specific file paths in technical tasks when possible.
10. **NEVER include manual tests** — only automated tests (unit, integration, e2e).

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

### YAML Frontmatter for User Story tasks

```yaml
---
name: [Story Name]
priority: [P0-P3]
type: UserStory
status: Not Started
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
- Each file must have valid YAML frontmatter with `name`, `priority`, `type`, and `status` fields
- Discovery tasks must also include `model: claude-opus-4-6` in frontmatter
- The `status` must always be `Not Started`
- Do not modify the `epic.md` file itself
- After creating all files, list what was created with their filenames and types
