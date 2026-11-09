# Points-table simulator

Tunes the scoring table against real 2025/26 Premier League player data.

```bash
# data: public FPL dataset (dev/test use only)
curl -L -o merged_gw.csv https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/2025-26/gws/merged_gw.csv
pip install pandas numpy
python3 -I sim.py merged_gw.csv out/
```

Outputs `out/v01_table.csv`, `out/v02_table.csv` (hit rate and average points per pick for every action and position) and `out/summary.json` (season totals by strategy: smart, always-goal, random, chaos chaser; Elite vs Bronze squads).

Method: player-gameweeks where the player averaged 60+ minutes over the previous four gameweeks; 150 simulated seasons per strategy; random squad in the squad shape each gameweek; two actions per player; captain doubled; max one chaos action.

Known gaps (Phase 1 task): captain choice is a simple heuristic, bold action and rarity multipliers are not simulated, squads are re-drawn each gameweek rather than persistent. Port to TypeScript in `packages/scoring` and extend to cover these, then confirm the Coins prices in `config/economy.v0.1.json`.

The `points` column in `v02_table.csv` is the simulator's auto-priced draft; the curated, authoritative values are in `config/scoring.v0.2.json`.
