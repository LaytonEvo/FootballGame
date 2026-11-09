// Fetch the public 2025/26 FPL dataset (vaastav/Fantasy-Premier-League, dev/replay use only) and write a
// trimmed, gzipped snapshot to data/fpl-2025-26/. Never call fantasy.premierleague.com directly.
//   node tools/data/fetch-fpl-dataset.mjs [--from <dir with merged_gw.csv, fixtures.csv, teams.csv>]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const BASE = 'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2025-26';
const OUT = new URL('../../data/fpl-2025-26/', import.meta.url).pathname;
const fromIdx = process.argv.indexOf('--from');
const fromDir = fromIdx > 0 ? process.argv[fromIdx + 1] : null;

const FILES = {
  'merged_gw.csv': {
    out: 'player_gw.csv.gz',
    cols: ['element', 'name', 'position', 'team', 'fixture', 'GW', 'kickoff_time', 'was_home', 'opponent_team',
      'minutes', 'starts', 'goals_scored', 'assists', 'clean_sheets', 'goals_conceded', 'saves', 'penalties_saved',
      'yellow_cards', 'red_cards', 'tackles', 'clearances_blocks_interceptions', 'defensive_contribution', 'value',
      'total_points'],
  },
  'fixtures.csv': {
    out: 'fixtures.csv.gz',
    cols: ['id', 'event', 'kickoff_time', 'team_h', 'team_a', 'team_h_score', 'team_a_score', 'finished'],
  },
  'teams.csv': { out: 'teams.csv.gz', cols: ['id', 'name', 'short_name'] },
};

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const esc = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

mkdirSync(OUT, { recursive: true });
for (const [name, spec] of Object.entries(FILES)) {
  const text = fromDir ? readFileSync(join(fromDir, name), 'utf8') : await (await fetch(`${BASE}/${name}`)).text();
  const [header, ...rows] = parseCsv(text);
  const idx = spec.cols.map((c) => {
    const i = header.indexOf(c);
    if (i < 0) throw new Error(`${name}: missing column ${c}`);
    return i;
  });
  const out = [spec.cols.join(','), ...rows.map((r) => idx.map((i) => esc(r[i] ?? '')).join(','))].join('\n') + '\n';
  writeFileSync(join(OUT, spec.out), gzipSync(out, { level: 9 }));
  console.log(`${spec.out}: ${rows.length} rows`);
}
writeFileSync(join(OUT, 'SOURCE.md'), `# 2025/26 FPL public dataset snapshot\n\nTrimmed from https://github.com/vaastav/Fantasy-Premier-League (data/2025-26).\nDevelopment and replay tests only. Production uses the contracted commercial feed.\nRegenerate with \`pnpm data:fetch\`.\n`);
