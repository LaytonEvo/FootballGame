/* Replay the 2025/26 season through the real scoring engine and write docs/ECONOMY_CHECK.md.
 *   pnpm replay            # print scenario summaries
 *   pnpm economy-check     # also write docs/ECONOMY_CHECK.md and tools/sim/baseline/ts_summary.json
 * Options: --seasons N (default 150) */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadDataset } from '@ff/fpl-dataset';
import { parseEconomyConfig, parseScoringConfig } from '@ff/shared';
import { compileRules } from '../rules.js';
import { SCENARIOS, prepareReplay, runScenario } from './sim.js';
import { economyRows } from './economy.js';
import { renderEconomyReport } from './report.js';

const root = new URL('../../../../', import.meta.url);
const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1]! : d;
};
const seasons = Number(arg('--seasons', '150'));
const mode = process.argv[2] ?? 'replay';

const scoringFile = arg('--scoring', 'scoring.v0.3.json');
const scoringCfg = parseScoringConfig(
  JSON.parse(readFileSync(new URL(`config/${scoringFile}`, root), 'utf8')),
);
const ecoCfg = parseEconomyConfig(
  JSON.parse(readFileSync(new URL('config/economy.v0.1.json', root), 'utf8')),
);
const rules = compileRules(scoringCfg);
const data = prepareReplay(loadDataset(), rules);
const t0 = Date.now();
const summaries = SCENARIOS.map((s) => runScenario(rules, data, s, seasons));
const elapsed = (Date.now() - t0) / 1000;

for (const s of summaries) {
  console.log(
    `${s.label.padEnd(40)} mean ${s.mean.toFixed(1).padStart(7)}  p10 ${s.p10.toFixed(0).padStart(5)}  p90 ${s.p90
      .toFixed(0)
      .padStart(5)}  /GW ${s.perGameweek.toFixed(2).padStart(6)}  hit ${(s.hitRate * 100).toFixed(1)}%`,
  );
}
console.log(
  `${seasons} seasons × ${SCENARIOS.length} scenarios × ${data.gameweeks.length} GWs in ${elapsed.toFixed(1)}s`,
);

if (mode === 'economy') {
  const rows = economyRows(summaries, ecoCfg, data.gameweeks[0]!);
  writeFileSync(
    new URL('tools/sim/baseline/ts_summary.json', root),
    JSON.stringify(
      {
        rulesVersion: rules.version,
        economyVersion: ecoCfg.version,
        seasons,
        summaries: summaries.map(({ cumulative: _c, ...s }) => s),
        economy: rows,
      },
      null,
      1,
    ) + '\n',
  );
  writeFileSync(
    new URL('docs/ECONOMY_CHECK.md', root),
    renderEconomyReport({ rules, eco: ecoCfg, data, summaries, rows, seasons }),
  );
  console.log('wrote docs/ECONOMY_CHECK.md');
}
