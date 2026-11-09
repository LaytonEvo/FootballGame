// Headless check of onboarding → starter pack → picks → confirm against a running API (DATABASE_URL dev DB) and a web build.
// Start: pnpm --filter @ff/api dev:sync; API with output to <dir>/api.log; serve `expo export --platform web` on :8082.
const { chromium } = require('playwright');
const fs = require('fs');
// Usage: node apps/mobile/e2e/onboarding.cjs <dir with api.log> [outDir]
const SP = process.argv[2];
const OUT = process.argv[3] ?? SP + '/shots';
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = (n) => p.screenshot({ path: `${OUT}/${n}.png`, fullPage: true });
  const t0 = Date.now();
  await p.goto('http://localhost:8082/');
  await p.getByLabel('Mobile number').fill('07700 9' + String(Date.now()).slice(-5) + '');
  await shot('01-signin');
  await p.getByText('Send code').click();
  await p.waitForTimeout(1500);
  const log = fs.readFileSync(`${SP}/api.log`, 'utf8');
  const code = [...log.matchAll(/one-time code for [^:]+: (\d{6})/g)].pop()[1];
  await p.getByLabel('One-time code').fill(code);
  await p.waitForTimeout(2000);
  await p.getByLabel('Display name').fill('Layton');
  await p.getByRole('checkbox', { name: 'I am 16 or over' }).click();
  await p.getByRole('checkbox', { name: /Not affiliated/ }).click();
  await shot('02-profile');
  await p.getByText('Open my starter pack').click();
  await p.waitForTimeout(2000);
  await shot('03-pack-sealed');
  await p.getByRole('button', { name: /Open Starter pack/ }).click();
  await p.waitForTimeout(2500);
  await shot('04-pack-revealed');
  await p.getByText('Pick your actions').click();
  await p.waitForTimeout(2500);
  await shot('05-sheet');
  await p.getByRole('checkbox', { name: /^Scores a goal/ }).click();
  await p.getByText('Done', { exact: true }).click();
  await p.getByRole('button', { name: 'Auto-pick' }).click();
  await p.waitForTimeout(1500);
  await shot('06-picks');
  await p.getByRole('button', { name: 'Confirm' }).click();
  await p.waitForTimeout(2500);
  await shot('07-home');
  console.log('elapsed ms (scripted, with waits):', Date.now() - t0);
  console.log('errors:', JSON.stringify(errors.slice(0, 10), null, 1));
  await b.close();
})().catch((e) => { console.error('FAILED', e.message); process.exit(1); });
