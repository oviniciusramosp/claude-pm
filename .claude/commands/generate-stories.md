# Generate User Stories from Epic

Analyze an Epic description and automatically create user story `.md` files inside the Epic folder.

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
4. Analyze the Epic description and generate user stories using the criteria below.
5. **Show the user a summary** of all stories to be created (name, priority, 1-line description) and **ask for confirmation** before writing files.
6. If confirmed, create each story as a `.md` file inside the Epic folder with proper YAML frontmatter and markdown body.
7. Use kebab-case filenames derived from the story name (e.g., `implement-login-form.md`).

## Story Generation Criteria

You are a senior product manager and prompt engineering expert. Analyze the Epic and break it down into concrete, actionable user stories.

### For each story, produce:

- **name**: Clear, concise name in imperative form (e.g., "Implement login form")
- **priority**: P0 (critical), P1 (high), P2 (medium), P3 (low)
- **body**: Complete markdown body with the following structure:

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
- Describe what should be tested
- Mention specific test file paths if applicable
- Or "N/A — infrastructure task" if no tests needed

## Dependencies
- List any prerequisites, blocking tasks, or required packages
- Or "None" if standalone

## Standard Completion Criteria
- [ ] Tests written and passing (or N/A)
- [ ] TypeScript compiles without errors
- [ ] Linter passes
- [ ] Commit message follows conventional commits format
```

### Rules

1. **DO NOT duplicate** stories that already exist as children of the Epic.
2. Each story should be small enough for a single developer to complete in one session.
3. Order stories logically — foundational work first, then features that build on it.
4. Generate between 2 and 15 stories. Do not generate more than 15.
5. Use imperative language: "Implement X", "Add Y", "Create Z".
6. Each acceptance criterion must be specific and testable — avoid vague ACs like "works correctly".
7. Include UI behavior, data validation, error handling, and edge cases in ACs.
8. Reference specific file paths in technical tasks when possible.

### YAML Frontmatter for each story file

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
- Use kebab-case filenames (e.g., `implement-login-form.md`, `add-validation-logic.md`)
- Each file must have valid YAML frontmatter with `name`, `priority`, `type`, and `status` fields
- The `status` must always be `Not Started`
- The `type` must always be `UserStory`
- Do not modify the `epic.md` file itself
- After creating all files, list what was created with their filenames
