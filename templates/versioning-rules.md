## Versioning & Commit Standards

This project follows [Semantic Versioning](https://semver.org/) (SemVer) and [Conventional Commits](https://www.conventionalcommits.org/).

### Semantic Versioning

The version in `package.json` MUST be updated on every commit following SemVer rules:

- **MAJOR** (X.0.0) - Breaking changes to APIs, config format, or database schema.
- **MINOR** (0.X.0) - New features, new endpoints, new components, new config options.
- **PATCH** (0.0.X) - Bug fixes, performance improvements, refactoring, documentation updates, dependency bumps.

**Before committing**, bump the version in `package.json` accordingly using:
```bash
npm version patch|minor|major --no-git-tag-version
```

### Conventional Commits

Every commit message MUST follow the Conventional Commits format:

```
<type>(<scope>): <short description>

<optional body with details of what changed and why>
```

**Types:**
- `feat` - New feature (bumps MINOR).
- `fix` - Bug fix (bumps PATCH).
- `refactor` - Code restructuring without behavior change (bumps PATCH).
- `docs` - Documentation only (bumps PATCH).
- `style` - Formatting, whitespace, missing semicolons (bumps PATCH).
- `perf` - Performance improvement (bumps PATCH).
- `test` - Adding or updating tests (bumps PATCH).
- `chore` - Build process, dependencies, tooling (bumps PATCH).
- `ci` - CI/CD configuration (bumps PATCH).
- `build` - Build system or external dependencies (bumps PATCH).

**Scopes** (use the most relevant for your project):
- Use component names, module names, or feature areas (e.g., `auth`, `api`, `ui`, `database`).
- Keep scopes concise (1-2 words).

**Examples:**
```
feat(auth): add OAuth2 login support
fix(api): resolve null pointer exception in user endpoint
refactor(ui): extract button component for reuse
chore(deps): bump react to 18.3.0
```

### Commit Workflow — Commit After Every Change

**CRITICAL**: You MUST create a commit after every meaningful change. Do NOT batch multiple changes into a single commit. Each logical change gets its own commit immediately after it is completed.

**What counts as a "change":**
- Adding, modifying, or deleting a feature, component, endpoint, or module.
- Fixing a bug.
- Refactoring code (even small refactors).
- Updating configuration or documentation.
- Adding or modifying tests.

**Step-by-step for each commit:**

1. **Stage relevant files** - Stage only the files for this specific change (never use `git add -A` blindly).
2. **Bump version** - Update `package.json` version with the appropriate level (`patch`, `minor`, or `major`) using `npm version <level> --no-git-tag-version`.
3. **Include version bump** - Add the version bump to the staging area.
4. **Write commit message** - Write a commit message with **both title AND description body**:
   - **Title**: concise conventional commit format (`type(scope): short description`), max ~72 chars.
   - **Body**: explain **what** changed, **why** it changed, and any notable details. The body is mandatory — never commit with only a title.
5. **Split unrelated changes** - If you made multiple unrelated changes before committing, split them into separate commits — one per logical change.

**Commit message format:**
```
type(scope): short description of the change

Detailed explanation of what was changed and why. Include:
- What files/modules were affected
- The motivation or context for the change
- Any trade-offs or decisions made
- Breaking changes (if any)
```

**Example:**
```
feat(auth): implement password reset flow

Add new password reset endpoints to the API and corresponding UI
screens. The flow uses time-limited JWT tokens sent via email.
Users can request a reset, receive an email, and set a new password
within 1 hour. Tokens expire after use or timeout.

Files changed:
- src/api/auth.js - new /reset-password endpoint
- src/pages/ResetPassword.tsx - new reset password page
- src/utils/email.js - password reset email template
```

**Anti-patterns (do NOT do these):**
- Committing with only a title and no body.
- Batching 3+ unrelated changes into one commit.
- Forgetting to bump the version before committing.
- Using vague messages like "update code" or "fix stuff".

### When NOT to Version Bump

In rare cases, you may skip the version bump if:
- The change is purely a work-in-progress commit (e.g., `wip: save progress on feature X`).
- The commit is immediately followed by a `git reset` or `git rebase` operation that will squash commits.

In most cases, **always bump the version**.
