# Git Workflow

## Branch Strategy

The project follows a trunk-based development workflow with feature branches.

### Branch Naming

| Type    | Pattern                 | Example                       |
| ------- | ----------------------- | ----------------------------- |
| Feature | `feature/<description>` | `feature/add-cleanup-handler` |
| Bugfix  | `fix/<description>`     | `fix/memory-leak-on-shutdown` |
| Chore   | `chore/<description>`   | `chore/update-dependencies`   |

## Commit Conventions

The project uses [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint.

### Commit Message Format

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | Description                             |
| ---------- | --------------------------------------- |
| `feat`     | New feature                             |
| `fix`      | Bug fix                                 |
| `docs`     | Documentation only                      |
| `style`    | Formatting, no code change              |
| `refactor` | Code change that neither fixes nor adds |
| `perf`     | Performance improvement                 |
| `test`     | Adding or updating tests                |
| `chore`    | Maintenance tasks                       |
| `ci`       | CI/CD changes                           |

### Examples

```bash
# Feature
git commit -m "feat(cleaner): add batch cleanup support"

# Bug fix
git commit -m "fix(worker): handle timeout errors gracefully"

# Breaking change
git commit -m "feat(api)!: change task data structure

BREAKING CHANGE: task.data.path renamed to task.data.resourcePath"
```

## Pre-commit Hooks

Husky runs pre-commit hooks defined in `.husky/`:

1. **pretty-quick**: Formats staged files with Prettier
2. **commitlint**: Validates commit message format

### Bypassing Hooks (Not Recommended)

```bash
git commit --no-verify -m "message"
```

## Pull Request Process

1. Create feature branch from `master`
2. Make changes and commit with conventional commits
3. Push branch and create PR
4. PR template in `.github/PULL_REQUEST_TEMPLATE.md`
5. CI runs on PR (lint, test, build)
6. Merge after approval

## Release Process

The project uses [Release Please](https://github.com/google-github-actions/release-please-action) for automated releases.

### How It Works

1. Conventional commits are analyzed
2. Release PR is auto-created with:
   - Version bump based on commit types
   - CHANGELOG.md updates
3. Merging release PR triggers:
   - Git tag creation
   - GitHub release
   - Docker image build and push

### Configuration

- `release-please-config.json` - Release configuration
- `.release-please-manifest.json` - Version tracking

## GitHub Actions

| Workflow                 | Trigger        | Purpose                     |
| ------------------------ | -------------- | --------------------------- |
| `pull_request.yaml`      | PR events      | Lint, test, build           |
| `build-and-push.yaml`    | Push to master | Build and push Docker image |
| `release-please.yml`     | Push to master | Manage releases             |
| `auto-author-assign.yml` | PR opened      | Auto-assign PR author       |

## Dependabot

Automated dependency updates configured in `.github/dependabot.yaml`:

- Weekly npm dependency updates
- GitHub Actions updates
- Auto-creates PRs for updates
