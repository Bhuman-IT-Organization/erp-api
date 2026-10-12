// The scripts behind the git hooks. Consumers hold identical
// copies and run it from their root. No dependencies: it runs before and during
// `corepack yarn install`.
//
//   install     postinstall: `lefthook install` (pre-commit, commit-msg, post-merge, post-rewrite), then writes our own
//               .git/hooks/pre-push; only inside a git checkout and never in CI (a Docker build has no .git, so the
//               install there stays silent and green). pre-push is not lefthook's: lefthook skips every pre-push
//               command when `git diff HEAD @{push}` is empty, so `git push origin HEAD:main` from a pushed branch
//               would skip the guard. The written hook must never contain lefthook's fingerprint (its name in capitals).
//   pre-push    reads git's `<local ref> <local sha> <remote ref> <remote sha>` lines on stdin; refuses a push to
//               main (D-15) unless ERP_ALLOW_MAIN_PUSH=1, and a merge commit in the pushed range (ADR-0013).
//   post-sync   post-merge and post-rewrite: `corepack yarn install` when the pull changed yarn.lock (D-20: a
//               rebasing pull fires post-rewrite, not post-merge). `amend` is skipped: it never changes yarn.lock.

import { spawnSync } from 'node:child_process';
import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ZERO = /^0+$/;

const git = (args) => spawnSync('git', args, { encoding: 'utf8' });
const run = (command) => spawnSync(command, { shell: true, stdio: 'inherit' }).status ?? 1;

const PRE_PUSH = `#!/bin/sh
# Written by node configs/scripts/git-hooks.mjs install (the postinstall); do not edit it.
# The guard reads git's refs on stdin (no push to main, no merge commit), then check:push runs.
node configs/scripts/git-hooks.mjs pre-push || exit 1
exec corepack yarn check:push
`;

function install() {
  if (process.env.CI) return 0;
  const hooks = git(['rev-parse', '--path-format=absolute', '--git-path', 'hooks']);
  if (hooks.error || hooks.status !== 0) return 0;
  const status = run('corepack yarn lefthook install');
  if (status !== 0) return status;
  const file = join(resolve(hooks.stdout.trim()), 'pre-push');
  writeFileSync(file, PRE_PUSH);
  chmodSync(file, 0o755);
  return 0;
}

/** The merge commits a push would publish; `--not --remotes` for a new branch or an unknown remote sha. */
function mergesIn(localSha, remoteSha) {
  if (!ZERO.test(remoteSha)) {
    const range = git(['rev-list', '--merges', `${remoteSha}..${localSha}`]);
    if (range.status === 0) return range.stdout.split('\n').filter(Boolean);
  }
  return git(['rev-list', '--merges', localSha, '--not', '--remotes'])
    .stdout.split('\n')
    .filter(Boolean);
}

function prePush() {
  const refusals = [];
  for (const line of readFileSync(0, 'utf8').split('\n')) {
    const [, localSha, remoteRef, remoteSha] = line.trim().split(/\s+/);
    if (!localSha || ZERO.test(localSha)) continue; // a branch deletion publishes nothing
    if (remoteRef === 'refs/heads/main' && process.env.ERP_ALLOW_MAIN_PUSH !== '1') {
      refusals.push(
        "pushing to main is refused; open a PR (D-15). A push the lead intends: ERP_ALLOW_MAIN_PUSH=1 git push ... (PowerShell: $env:ERP_ALLOW_MAIN_PUSH='1'; git push ...; Remove-Item Env:ERP_ALLOW_MAIN_PUSH)",
      );
    }
    for (const sha of mergesIn(localSha, remoteSha)) {
      refusals.push(
        `${sha} is a merge commit; history is rebase-only (ADR-0013): git pull --rebase, then push`,
      );
    }
  }
  for (const refusal of refusals) process.stderr.write(`pre-push: ${refusal}\n`);
  return refusals.length > 0 ? 1 : 0;
}

function postSync(kind) {
  if (kind === 'amend') return 0;
  const diff = spawnSync('git', ['diff', '--quiet', 'ORIG_HEAD', 'HEAD', '--', 'yarn.lock'], {
    stdio: 'ignore',
  });
  if (diff.status !== 1) return 0; // 0: unchanged; anything else: no ORIG_HEAD yet
  process.stdout.write('yarn.lock changed: corepack yarn install\n');
  return run('corepack yarn install');
}

const [command, arg] = process.argv.slice(2);
const commands = { install, 'pre-push': prePush, 'post-sync': () => postSync(arg) };
if (!commands[command]) {
  process.stderr.write(
    'usage: node configs/scripts/git-hooks.mjs <install|pre-push|post-sync [amend|rebase]>\n',
  );
  process.exit(1);
}
process.exit(commands[command]());
