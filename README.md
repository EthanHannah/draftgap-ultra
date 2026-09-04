# DraftGap Ultra

This repo enhances the original DraftGap with extra controls and analysis features. This was made for personal use with no guarantee of accuracy.

Some of the new features added to this fork:

- Win-rate delta instead of winrate for each suggestion
  - This makes it easier to scan the results
- Configurable champion win-rate influence
  - This lets you get more off-meta recommendations while still considering overall winrate
- Configurable role matchup and duo influence.
  - This lets you choose which specific roles you want to counter/synergize with
- Configurable situational adjustment
  - Situational Δ adjusts a champion's base win rate from the favorable or unfavorable drafts in which players usually select it to the normal mix of available teammates and opponents
  - Revealed picks use their direct interactions instead, allowing situational champions to rise when the current draft actually suits them; influence can be tuned from 0–200%
- Configurable blindability scoring
  - Blind Δ measures the downside of unrevealed picks, rewarding champions with consistently strong synergies and matchups while accounting for data confidence
- Configurable team composition scoring
  - The Comp Δ rewards picks that improve damage balance, frontline, fight planning through engage or peel, hard crowd control, waveclear, and sustained damage, using a five-level capability gradient with more influence late in the allied draft
  - Damage balance and reliable fight planning receive slightly more weight than contextual needs such as waveclear and sustained damage
  - A smaller enemy-response component rewards sustained damage into frontline, defensive tools into engage, and answers to waveclear-heavy teams; it scales with known enemy picks and stays within the same Comp Δ cap
- Flex-pick uncertainty analysis
  - This weights every valid role assignment by its likelihood instead of assuming each flexible champion is in its single most likely role
- Desktop-only build analysis
  - Select a drafted champion in the Builds tab to choose from supported core builds and rune options using current-patch and 30-day Lolalytics statistics
  - Requests use a restricted native HTTPS command, not browser fetch; no web proxy or beta toggle is required
  - Successful responses are cached for an hour. Missing patches or matchups show a warning and can be retried without discarding available builds
  - Builds shows up to three supported three-major-item cores (with early boots when supported) and three rune options. Cores pool purchase-order variants, show the most common supported opening through the third major item (including boots bought by then, without pulling later boots forward), and require 500 observed games and 1% of eligible core observations. Combined-set estimates adjust the win rate, while only observed counts determine the ranking penalty; extrapolation never qualifies a niche build. Rune options use the same minimums and rank keystone results, displaying the source’s suggested complete page for that keystone—not claiming page-level sample counts. Core and rune recommendations follow the Lolalytics time-range setting strictly, with no automatic range fallback. Fewer than three are shown when support is insufficient. Neither list is opponent-adjusted, and matching ranks do not imply item/rune pairings.
  - Locking in your champion in the League client opens Builds with your ally slot selected. Trades update the selection, while repeated client polls do not override manual navigation. The embedded Lolalytics tab has been removed; external stats-site links remain available.
- Random small improvements
  - Remember hover setting, remember window size/position, etc.

---

DraftGap.com is a site and desktop application which helps you pick and draft your League of Legends team. It suggests champions based on the meta, their matchups with every opponent champion, every ally duo, and configurable composition fundamentals. Matchup, duo, damage, and scaling inputs come from statistics; frontline, engage, peel, crowd-control, waveclear, and sustained-damage capabilities use a small, reviewed champion profile.

If you ever wondered what champion to pick, which is the best champion you could have picked, or if the game was truly lost in draft, DraftGap is for you.

Find it at [draftgap.com](https://draftgap.com), or download the app, which integrates with the League client to automatically synchronize with the current draft in champ select.
