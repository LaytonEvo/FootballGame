# Design direction

Live mockup canvas: https://claude.ai/artifact/C3HQhV2ki71gmarc6PE6Tt (owner access). Source copies are in `design/mockups/`. Tokens: `design/tokens.json`.

## Chosen style

- **Colour — Clean Fantasy:** light grey-blue background (#F4F6FA), white cards, navy ink and primary buttons (#10153A), blue for points, links, progress and the active tab (#3D5AFE), aqua accent (#00D9C0). Aqua-to-blue gradient for the pitch band, active tab tile, pack and share card. Landed actions in aqua tints, missed in orange (never colour alone — always an icon too).
- **Type — Friendly Rounded:** Sora for headings and numbers, DM Sans for body and UI.
- **Icons — Gradient tile:** active tab is a white 2px-stroke icon on a gradient tile with a soft glow; inactive tabs are muted outlines.
- **Pitch:** vivid striped green drawn in perspective with white markings; each player is a kit-style shirt (white body, rarity-coloured sleeves, collar and side panels, number in the middle) above a white name plate with the fixture or live score underneath. Inspired by the clarity of fantasy-football team views, without copying any league's branding.
- **Rarity colours:** Bronze #A9683A, Silver #7C8796, Gold #B8860B, Elite #6A55E0.

## Screens and mockup files

| Screen                    | Tab          | Mockup file                       | Notes                                                                                                             |
| ------------------------- | ------------ | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Home (before deadline)    | Home         | `Main.dc.html`                    | Countdown, your five, Pick your actions, league card, pack ready, Coins chip with progress to next pack           |
| Pick actions (pitch view) | Home / Squad | `Predictions.dc.html`             | Five on the pitch with two action slots each; sub on bench; Same as last week, Auto-pick; potential points footer |
| Scoring actions sheet     | Sheet        | `ActionSheet.dc.html`             | Grouped Likely / Possible / Bold / Chaos, "+N pts", form hint, bold-action toggle                                 |
| Matchday live             | Home         | `Live.dc.html`                    | Points bubble per shirt, pending / landed / missed chips, league movement, landed banner                          |
| League table              | Leagues      | `Leagues.dc.html`                 | Interactive: Season vs This week; movement arrows; your row highlighted                                           |
| My season                 | Leagues      | `History.dc.html`                 | Total, average, best week, bars per gameweek with league-average marks, last three weeks                          |
| Coins & packs             | Collection   | `Rewards.dc.html`                 | Coins vs Season Points, next-pack progress, milestone track, weekly free pack, shop                               |
| Pack opening (motion)     | Overlay      | `PackMotion.dc.html`              | Interactive: shake → tear + glow → flip → buttons; Skip / Replay                                                  |
| Pack reveal (still)       | Overlay      | `PackOpening.dc.html`             | End state of the animation                                                                                        |
| Recap                     | Home         | `Recap.dc.html`                   | Points, actions landed, pitch with points per player, best action, Share my week                                  |
| Share card                | —            | `ShareCard.dc.html`               | 540×960 (9:16), gradient, invite code                                                                             |
| Card rarities             | —            | `Cards.dc.html`                   | Four rarity card faces (note: colours predate the final palette; use tokens)                                      |
| Shirt component           | —            | `Shirt.dc.html`, `Shirts.dc.html` | Shirt SVG, props: number, tier, size                                                                              |
| Tab bar                   | —            | `TabBar.dc.html`                  | Gradient tile active state                                                                                        |
| Style picker              | —            | `StylePicker.dc.html`             | The options the style was chosen from                                                                             |

All names, fixtures, form figures and ratings in the mockups are sample data.

## Motion

Pack opening: tap → 0.6 s shake → 0.4 s tear with rarity glow → 0.6 s card flip → 0.3 s fade-in of name and buttons. Skip always visible. Reduce Motion: fade only. No slow-downs, near-miss teases or "so close" copy.
