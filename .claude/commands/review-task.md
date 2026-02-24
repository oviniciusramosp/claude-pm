# Review Task with Claude

Review and optimize a task file for the Product Manager automation system.

## Usage

Provide the path to a `.md` task file (relative to the Board directory or absolute). The file must have YAML frontmatter with `name`, `priority`, `type`, and `status` fields.

**Argument**: $ARGUMENTS (path to the task .md file)

## Instructions

1. Read the task file at the provided path. If the path doesn't start with `/`, resolve it relative to the `Board/` directory inside the project's `CLAUDE_WORKDIR`.
2. Parse the YAML frontmatter to extract: `name`, `priority`, `type`, `status`, `model`, `agents`.
3. Read the body (everything after the closing `---`).
4. Review the task using the criteria below and produce an improved version.
5. **Show the user a diff** of the changes (old vs new) and a short summary of what was improved.
6. **Ask the user for confirmation** before overwriting the file.
7. If confirmed, write the improved body back to the file (preserving the original YAML frontmatter).

## Review Criteria

You are an expert prompt engineer and product manager reviewing a task for a Claude Code automation system. This task will be executed by Claude Code — the quality of the task file directly determines execution success.

### 1. Acceptance Criteria Quality (type-specific)

Each AC must be a markdown checkbox: `- [ ] Description`. Each AC must be testable, specific, and unambiguous. Avoid vague ACs like "works correctly" — specify exact behavior.

**By task type:**

- **Epic**: Focus on high-level business outcomes, NOT technical implementation details. Each AC describes a complete, user-visible capability. Avoid file names, function names, or code structure. Typically 3-7 ACs.
- **UserStory**: Every AC must be assertable via an automated test (unit, integration, or e2e). Do NOT write ACs that require manual human observation ("UI looks correct", "user sees X", "page renders"). Do NOT duplicate Standard Completion Criteria (TypeScript, linting, tests passing). No redundancy — each AC tests a distinct code path. Keep it tight: 4-6 ACs max. GOOD: "Submit button is disabled when form has validation errors" / "POST /api/login returns 401 for invalid credentials". BAD: "Login form renders correctly" / "User can see the dashboard".
- **Bug**: Every AC must be assertable in a test — no "verify manually" or "check visually". First AC: expected behavior after fix, assertable in a regression test. Additional ACs: edge cases that must still work. Include: "Regression test added to prevent recurrence". Typically 3-5 ACs.
- **Chore**: ACs describe a verifiable completed state (e.g., "npm ci exits with code 0"). For pure config/infra tasks, operational verification ACs are acceptable. Do NOT duplicate Standard Completion Criteria. Typically 2-4 ACs.
- **Discovery**: Each AC describes a specific deliverable — a decision documented, a question answered, an artifact produced. Reference the expected output (e.g., "ADR document created at docs/adr/001-auth.md"). Typically 3-5 ACs.

### 2. Task Description Clarity

- **UserStory**: Use "As a [role], I want [goal] so that [benefit]"
- **Epic**: Describe the high-level business goal and scope
- **Bug**: Include actual behavior, expected behavior, and reproduction steps
- **Chore**: Describe the operational goal clearly
- **Discovery**: Frame the research question or investigation goal

### 3. Technical Tasks Section

- For **Epics**: List high-level implementation phases, NOT detailed steps. Example: "Phase 1: Authentication infrastructure"
- For **other types**: Break implementation into numbered, sequential steps. Reference specific file paths when possible. Each step should be actionable by Claude Code.

### 4. Tests Section

- For **Epics**: Describe testing strategy at a high level
- For **other types**: Specify test file path, list specific test cases, include edge case tests. For infrastructure/chore tasks, state "N/A — no business logic to test"

### 5. Dependencies Section

List prerequisites, blocking tasks, or required packages. State "None" if there are no dependencies.

### 6. Standard Completion Criteria

Include checkboxes for: tests passing, TypeScript compilation, linting. Include a commit message suggestion following conventional commits: `feat|fix|chore(scope): description`.

### 7. Prompt Optimization for Claude Code

- Instructions must be explicit — Claude Code executes literally
- Avoid ambiguous language ("consider", "maybe", "if possible")
- Use imperative language ("Create", "Add", "Implement", "Run")
- Structure content with clear markdown headers (##)
- If the task involves modifying existing files, specify which files and what changes

## Output Rules

- Preserve the original YAML frontmatter exactly as-is
- Do not change the task's intent or scope — improve quality, not scope
- Do not invent acceptance criteria unrelated to the task
- Preserve existing content that is already good
- Keep the same task name
