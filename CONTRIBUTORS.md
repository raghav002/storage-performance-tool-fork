## Setup

`raghav002/storage-performance-tool-fork` is the team's shared repo, maintained by Raghav (@raghav002). `dell/storage-performance-tool` is the upstream SPT repo, maintained by Mike. All work happens in this fork. Do not open a PR against the upstream. Raghav will do that, in coordination with Mike, when the project is in a working state.

1. Clone the fork. The GitHub CLI also adds the `upstream` remote for you:
   ```
   gh repo clone raghav002/storage-performance-tool-fork
   cd storage-performance-tool-fork
   ```
   Without the GitHub CLI:
   ```
   git clone https://github.com/raghav002/storage-performance-tool-fork.git
   cd storage-performance-tool-fork
   git remote add upstream https://github.com/dell/storage-performance-tool.git
   git fetch upstream
   ```

2. Point `gh` at the fork. `gh repo clone` makes the upstream the default repo, so `gh pr create` would send your PR to `dell/storage-performance-tool`. Fix that once per clone:
   ```
   gh repo set-default raghav002/storage-performance-tool-fork
   ```

3. Check the result:
   ```
   git remote -v                # origin = the fork, upstream = dell/storage-performance-tool
   gh repo set-default --view   # raghav002/storage-performance-tool-fork
   ```

On the GitHub website, the "Compare & pull request" button defaults the base repository to the upstream. Before you click "Create pull request", change **base repository** to `raghav002/storage-performance-tool-fork`. If a PR targeting `dell/storage-performance-tool` is opened by mistake, close it and tell Raghav.

## Branching

- `main` is protected: no direct pushes, no force-pushes. All changes go through a pull request.
- Every PR needs 1 approval from another team member. New commits dismiss existing approvals.
- Name branches `feature/<github-username>/<short-topic>`, e.g. `feature/jsmith/login-form`.
- Rebase and force-push freely on your own feature branches.

## Syncing With Upstream

The upstream SPT keeps moving. We pull its changes into the fork regularly so that our work does not drift away from it and so the final PR stays easy to review.

### When to sync

- About once a week.
- Before starting a new feature branch.
- When you need a bug fix or feature that has landed upstream.
- Before the final PR to the upstream. This is required.

Small, frequent syncs are much easier than one big one. Check with Raghav before you start, so two people don't sync at the same time.

### How to sync

Sync goes through a normal PR into the fork's `main`, like any other change.

```
git fetch upstream
git switch main
git pull origin main
git switch -c feature/<github-username>/sync-upstream-YYYY-MM-DD
git merge upstream/main
```

If there are conflicts: edit the conflicted files, then `git add` them and run `git commit`. Build the project and run the tests before pushing.

```
git push -u origin HEAD
gh pr create --base main
```

Rules for sync PRs:

- **Branch name:** use `feature/<github-username>/<short-topic>`. The repository rejects any other new branch name, so `sync/...` will not work.
- **Merge, don't rebase:** use `git merge` to bring in `upstream/main`. `main` is protected, so we never rebase it or force-push to it.
- **Merge method:** merge the PR with **Create a merge commit**. Do not squash or rebase-merge it. Those rewrite the upstream commits, git no longer sees them as already merged, and the same conflicts come back at the next sync.
- **Review:** someone other than the person who pushed last must approve the PR. A new push dismisses earlier approvals.
- **Keep it clean:** a sync PR contains only the merge and its conflict fixes. Do not add GUI changes to it.
- **Don't use the shortcuts:** do not use the website's **Sync fork** button or `gh repo sync` (especially with `--force`). They skip the PR review and can overwrite our own commits on `main`.
- **Conflicts in SPT files:** if a conflict is in an SPT file you did not deliberately change for the GUI, take the upstream version. If you did change it on purpose, ask Raghav before deciding. He will check with Mike if it affects SPT itself.

### After the sync PR merges

Update your own feature branches:

```
git switch main
git pull origin main
git switch feature/<github-username>/<short-topic>
git merge main
```

If you are the only person on the branch, you can `git rebase main` instead. A rebase needs a force-push, which dismisses existing approvals.

### Needing something from the upstream sooner

- **It's already upstream:** check with `git fetch upstream` and `git log upstream/main --oneline`. If it's there, sync now.
- **It isn't upstream yet:** ask Raghav, who will check with Mike. Do not patch SPT core code inside the fork.
- **You can't wait:** cherry-pick the specific upstream commit onto a feature branch with `git cherry-pick <sha>`. The next sync normally absorbs it cleanly.
- **You found a bug in SPT itself:** do not fix it in a GUI branch. Tell Raghav, who will raise it with Mike or open an issue on `dell/storage-performance-tool`.
