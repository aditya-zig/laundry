import { execFileSync } from 'node:child_process';

// Local branch exposure audit. Surfaced after work/facility-recovery-20261026
// sat unpushed for twelve days on a machine that had already lost its Docker
// daemon to an OOM crash. Reports every local branch whose upstream is absent,
// gone, or behind the remote name it tracks, and calls out an unpushed local
// main explicitly. Decisions come from remote-tracking refs only, so this
// makes no network calls; run `git fetch --prune` first for current answers.
// Exit 0 when nothing is exposed, 2 when findings exist, 1 on tool failure.

const FORMAT = '%(refname:short)|%(upstream:short)|%(upstream:track)|%(objectname:short)|%(committerdate:format:%Y-%m-%d)';

function localBranches() {
  const out = execFileSync('git', ['for-each-ref', 'refs/heads', `--format=${FORMAT}`], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((line) => {
    const [name = '', upstream = '', rawTrack = '', sha = '', date = ''] = line.split('|');
    const track = rawTrack.replace(/^\[/, '').replace(/\]$/, '');
    const match = track.match(/ahead (\d+)/);
    return {
      name,
      upstream,
      track,
      sha,
      date,
      ahead: match ? Number(match[1]) : 0,
    };
  });
}

function findings(branches) {
  const result = [];
  for (const branch of branches) {
    if (!branch.upstream) {
      result.push({
        branch: branch.name,
        sha: branch.sha,
        date: branch.date,
        kind: 'NO_UPSTREAM',
        detail: 'no remote tracking ref',
      });
      continue;
    }
    if (branch.track === 'gone') {
      result.push({
        branch: branch.name,
        sha: branch.sha,
        date: branch.date,
        kind: 'GONE_UPSTREAM',
        detail: `tracked ${branch.upstream}, which no longer exists under refs/remotes`,
      });
      continue;
    }
    if (branch.ahead > 0) {
      result.push({
        branch: branch.name,
        sha: branch.sha,
        date: branch.date,
        kind: branch.name === 'main' ? 'MAIN_UNPUSHED' : 'AHEAD',
        detail: `${branch.ahead} commit(s) not pushed to ${branch.upstream}`,
      });
    }
  }
  return result;
}

const jsonMode = process.argv.includes('--json');
try {
  const branches = localBranches();
  const exposed = findings(branches);
  if (jsonMode) {
    console.log(JSON.stringify({ branches: branches.length, findings: exposed }, null, 2));
  } else if (exposed.length === 0) {
    console.log(`${branches.length} local branches, none exposed`);
  } else {
    const lines = exposed.map((f) => `${f.branch} ${f.kind}: ${f.detail} (tip ${f.sha}, ${f.date})`);
    console.log(`${branches.length} local branches, ${exposed.length} exposed:\n${lines.join('\n')}`);
  }
  process.exit(exposed.length ? 2 : 0);
} catch (error) {
  console.error(`branch-audit tool failure: ${error.message}`);
  process.exit(1);
}
