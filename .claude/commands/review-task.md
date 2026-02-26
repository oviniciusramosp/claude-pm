# Review Task with Claude

Review and optimize a task file for the Product Manager automation system.

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

You are an expert prompt engineer and product manager reviewing a task for a Claude Code automation system. This task will be executed by Claude Code — the quality of the task file directly determines execution success.

### 1. Acceptance Criteria Quality (type-specific)

Each AC must be a markdown checkbox: `- [ ] Description`. Each AC must be testable, specific, and unambiguous. Avoid vague ACs like "works correctly" — specify exact behavior.

**By task type:**

- **Epic**: Focus on **specific, observable product behaviors** — not technical implementation details. Each AC should map clearly to one or more child tasks (Discovery or UserStory). Be thorough and cover edge cases and error scenarios. Typically 5-10 ACs for an Epic. Flag items that need Discovery with "(needs Discovery)" in the Scope or Technical Approach sections.
- **UserStory**: Focus on specific, testable behaviors and technical requirements. Include UI behavior, data validation, error handling, and edge cases. Reference specific elements when applicable. Typically 4-10 ACs.
- **Bug**: First AC: reproduction steps that currently fail. Second AC: expected behavior after fix. Additional ACs: edge cases and regression test requirements. Typically 3-6 ACs.
- **Chore**: Focus on operational outcomes and verification steps. Include verification (e.g., "Build passes without warnings"). Typically 2-5 ACs.
- **Discovery**: Focus on research outcomes and documentation deliverables. Each AC describes a specific question answered or artifact produced. Output must be saved to a `.md` file (e.g., `docs/discoveries/[topic].md`). Typically 3-6 ACs.

### 2. Task Description Clarity

- **UserStory**: Use "As a [role], I want [goal] so that [benefit]"
- **Epic**: Describe the high-level business goal with **specific product behaviors**. Be detailed enough that each scope item can be directly mapped to child tasks. Flag areas needing Discovery.
- **Bug**: Include actual behavior, expected behavior, and reproduction steps
- **Chore**: Describe the operational goal clearly
- **Discovery**: Frame the research question, list alternatives to evaluate, and specify the output file path

### 3. Technical Tasks Section

- For **Epics**: List high-level Technical Approach with architectural decisions. Flag items that need Discovery with "(needs Discovery)" suffix.
- For **Discovery**: List research questions and evaluation criteria.
- For **other types**: Break implementation into numbered, sequential steps. Reference specific file paths when possible. Each step should be actionable by Claude Code.

### 4. Tests Section

- **CRITICAL**: NEVER include manual tests or manual QA steps. Only automated tests.
- For **Epics**: Do NOT include a Tests section. Testing is handled at the child task level.
- For **Discovery**: "N/A — research task, no automated tests"
- For **other types**: Specify test file path, list specific automated test cases (unit, integration, e2e), include edge case tests. For infrastructure/chore tasks, state "N/A — no business logic to test"

### 5. Dependencies Section

- List prerequisites, blocking tasks, or required packages
- For tasks following a Discovery: reference the Discovery output file (e.g., "See `docs/discoveries/auth-strategy.md` for implementation approach")
- Include dependencies on other epics when applicable (check board context)
- State "None" if there are no dependencies

### 6. Standard Completion Criteria

Include checkboxes for: automated tests passing, TypeScript compilation, linting. Include a commit message suggestion following conventional commits: `feat|fix|chore|docs(scope): description`.

### 7. Prompt Optimization for Claude Code

- Instructions must be explicit — Claude Code executes literally
- Avoid ambiguous language ("consider", "maybe", "if possible")
- Use imperative language ("Create", "Add", "Implement", "Run", "Research")
- Structure content with clear markdown headers (##)
- If the task involves modifying existing files, specify which files and what changes

### 8. Cross-Epic Consistency (Epic type only)

- Compare scope and ACs against other epics on the board
- Flag scope overlaps or redundant acceptance criteria
- Suggest dependencies where the Epic interacts with other epics
- Ensure naming and abstraction level are consistent with the backlog

## Output Rules

- Preserve the original YAML frontmatter exactly as-is
- Do not change the task's intent or scope — improve quality, not scope
- Do not invent acceptance criteria unrelated to the task
- Preserve existing content that is already good
- Keep the same task name
- NEVER add manual testing or manual QA steps — only automated tests
