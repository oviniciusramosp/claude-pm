# Review Task with Claude

Review and optimize a task file for the Product Manager automation system. Tasks are executed by Claude Code — the output must be optimized for automated execution, not human consumption.

## Usage

Provide the path to a `.md` task file (relative to the Board directory or absolute). The file must have YAML frontmatter with `name`, `priority`, `type`, and `status` fields.

**Argument**: $ARGUMENTS (path to the task .md file)

## Instructions

1. Read the task file at the provided path. If the path doesn't start with `/`, resolve it relative to the `Board/` directory inside the project's `CLAUDE_WORKDIR`.
2. Parse the YAML frontmatter to extract: `name`, `priority`, `type`, `status`, `model`, `agents`.
3. Read the body (everything after the closing `---`).
4. **For Epic type only**: Read all OTHER Epic folders in the `Board/` directory (excluding the current task's Epic, if applicable). For each other epic, read its `epic.md` and extract name, status, and goal/scope summary (~500 chars). List child story names and statuses. Use this context to check for scope overlap and suggest dependencies.
5. Review the task using the criteria below and produce an improved version.
6. **Show the user a diff** of the changes (old vs new) and a short summary of what was improved.
7. **Ask the user for confirmation** before overwriting the file.
8. If confirmed, write the improved body back to the file (preserving the original YAML frontmatter).

## Review Criteria

You are a technical architect reviewing a task for a Claude Code automation system. This task will be executed autonomously by Claude Code — write instructions as direct orders, not agile ceremonies. The quality of the task file directly determines execution success.

### 1. Acceptance Criteria Quality (type-specific)

Each AC must be a markdown checkbox: `- [ ] Description`. Each AC must be technically verifiable and unambiguous. Avoid vague ACs like "works correctly" — specify exact verifiable behavior.

**By task type:**

- **Epic**: Focus on **technically verifiable conditions** — checkable by automated tests, build commands, or code inspection. Each AC should map to one or more child tasks. Be thorough and cover error handling, edge cases, data validation. Typically 5-10 ACs. Flag items needing Discovery with "(needs Discovery)" in Scope or Technical Approach.
- **UserStory**: Focus on technically verifiable conditions. Include data validation, error handling, edge cases. Reference specific endpoints, components, or behaviors. Typically 3-8 ACs.
- **Bug**: First AC: expected behavior after fix. Additional ACs: edge cases and regression tests. Typically 3-6 ACs.
- **Chore**: Operational outcomes and verification commands (e.g., "Build passes without warnings"). Typically 2-5 ACs.
- **Discovery**: Research outcomes and documentation deliverables. Output saved to `docs/discoveries/[topic].md`. Typically 3-6 ACs.

### 2. Task Description Clarity

- **UserStory**: Start with 1-3 imperative sentences describing what to build. Be specific about scope and expected outcome. Do NOT use "As a [role], I want..." format — write direct implementation instructions.
- **Epic**: Start with "**Goal**:" — concise technical description of what the epic delivers. No narrative.
- **Bug**: Include actual behavior, expected behavior, and reproduction steps.
- **Chore**: Describe the operational goal with direct imperative instructions.
- **Discovery**: State the research goal directly, list alternatives to evaluate, specify output file path.

### 3. Implementation Section (non-Epic)

- Break implementation into numbered, sequential steps
- Reference specific file paths when possible
- Each step should be a concrete action Claude Code executes
- Include commands when relevant (e.g., "Run `npm install react-hook-form`")

### 4. Tests Section

- **CRITICAL**: NEVER include manual tests or manual QA steps. Only automated tests.
- For **Epics**: Do NOT include a Tests section. Testing is handled at child task level.
- For **Discovery**: "N/A — research task, no automated tests"
- For **other types**: Specify test file path, list specific automated test cases, include edge case tests. For infrastructure/chore tasks: "N/A — no business logic to test"

### 5. Dependencies Section

- List prerequisites, blocking tasks, required packages
- For tasks following a Discovery: reference the Discovery output file (e.g., "See `docs/discoveries/auth-strategy.md`")
- Include dependencies on other epics when applicable (check board context)
- State "None" if no dependencies

### 6. Completion Section (non-Epic)

Include checkboxes for: tests passing, build passing. Include a commit message following conventional commits: `type(scope): description`.

### 7. Claude Code Optimization

- Instructions must be explicit — Claude Code executes literally
- Avoid ambiguous language ("consider", "maybe", "if possible")
- Use imperative language ("Create", "Add", "Implement", "Run", "Research")
- No "As a user..." or "User Story" format — write direct instructions
- Use section header "## Implementation" (not "## Technical Tasks")
- Use section header "## Completion" (not "## Standard Completion Criteria")
- Structure content with clear markdown headers (##)

### 8. Epic-Specific Format

**Required sections for Epics** (in order): `# [Name] Epic`, `**Goal**: ...`, `## Scope`, `## Acceptance Criteria`, `## Technical Approach`, `## Dependencies`, `## Child Tasks`.

**Sections to NEVER include in an Epic:**
- "Motivation & Objectives", "User Experience & Design", "Open Questions & Risks"
- "User Story" / "As a [role], I want..."
- "Implementation" with numbered steps, "Tests", "Completion"
- Manual testing references

### 9. Cross-Epic Consistency (Epic type only)

- Compare scope and ACs against other epics on the board
- Flag scope overlaps or redundant acceptance criteria
- Suggest dependencies where the Epic interacts with other epics

## Output Rules

- Preserve the original YAML frontmatter exactly as-is
- Do not change the task's intent or scope — improve quality, not scope
- Do not invent acceptance criteria unrelated to the task
- Preserve existing content that is already good
- Keep the same task name
- NEVER add manual testing or manual QA steps — only automated tests
