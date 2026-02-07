# Claude Development Guidelines

This document contains guidelines and conventions for working with Claude on the Scrivano project.

## Conventional Commit Prefixes

When creating commits and pull requests, **always** use conventional commit prefixes. This helps maintain a clean and readable git history.

### Required Prefixes

- **feat**: A new feature
  - Example: `feat: add global hotkey customization`

- **fix**: A bug fix
  - Example: `fix: resolve audio recording memory leak`

- **chore**: Changes to build process, dependencies, or tooling
  - Example: `chore: update Tauri to 2.1.0`

- **test**: Adding or updating tests
  - Example: `test: add unit tests for transcription service`

- **docs**: Documentation changes
  - Example: `docs: update setup instructions in README`

- **refactor**: Code changes that neither fix bugs nor add features
  - Example: `refactor: simplify audio capture logic`

- **style**: Code style changes (formatting, whitespace, etc.)
  - Example: `style: format Rust code with rustfmt`

- **perf**: Performance improvements
  - Example: `perf: optimize Whisper API request batching`

- **ci**: Changes to CI/CD configuration
  - Example: `ci: add GitHub Actions workflow for tests`

### Format

```
<prefix>: <short description>

[optional longer description]

[optional footer]
```

### Examples

Good commit messages:
- `feat: add support for custom Whisper model selection`
- `fix: prevent app crash when microphone permission is denied`
- `chore: update dependencies to latest versions`
- `test: add integration tests for paste functionality`

Bad commit messages (missing prefix):
- `add new feature`
- `bug fix`
- `update dependencies`

## Pull Requests

When creating pull requests using the `/pr` command, the PR title **must** use a conventional commit prefix. The PR description should include:

1. **Summary**: Bullet points describing the changes
2. **Test plan**: How to test the changes
3. **Related issues**: Link to any related GitHub issues

Example PR title:
```
feat: implement custom hotkey configuration
```

## Commits

When using the `/push` command, ensure your commit message follows the conventional commit format with one of the approved prefixes listed above.
