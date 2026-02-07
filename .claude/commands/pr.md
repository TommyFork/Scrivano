---
description: Generate title/description and create a PR
allowed-tools: Bash(gh *), Bash(git *)
---
# Context
- Branch: !`git branch --show-current`
- Diff: !`git diff main...HEAD`

# Instructions
1. Analyze the differences between the current branch and main.
2. Draft a PR Title using a conventional commit prefix (feat, fix, chore, test, docs, refactor, style, perf, or ci) and a Description (bullet points of changes).
3. The PR title MUST start with one of these prefixes:
   - **feat**: new feature
   - **fix**: bug fix
   - **chore**: build/tooling/dependency changes
   - **test**: adding or updating tests
   - **docs**: documentation changes
   - **refactor**: code changes without bug fixes or features
   - **style**: formatting/whitespace changes
   - **perf**: performance improvements
   - **ci**: CI/CD configuration changes
4. Present them to me for confirmation.
5. If I approve, run:
   `gh pr create --title "YOUR_TITLE" --body "YOUR_DESCRIPTION" --web`