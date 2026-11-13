import { onFinalise } from '../jobs/hooks.js';
import { creditGameweekCoins, coinBalance, grantMilestones } from './coins.js';
import { getEconomy } from './config.js';
import { runTeamOfTheWeek } from './editions.js';
import { registerHomeExtra } from './home.js';

onFinalise(async (ctx, f) => {
  await creditGameweekCoins(ctx, f.gameweek.id);
  await grantMilestones(
    ctx,
    f.scored.map((s) => s.userId),
    f.gameweek.season,
  );
  // Earned limited editions: Team of the Week (economy v0.2+).
  await runTeamOfTheWeek(ctx, f.gameweek.id);
});

registerHomeExtra(async (ctx, userId) => {
  const [balance, eco] = await Promise.all([coinBalance(ctx.db, userId), getEconomy(ctx.db)]);
  const price = eco.prices_coins.player_pack;
  return { coins: { balance, nextPackPrice: price, toNextPack: Math.max(0, price - balance) } };
});
