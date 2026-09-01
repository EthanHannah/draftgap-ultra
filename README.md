# DraftGap Ultra

This repo enhances the original DraftGap with extra controls and analysis features. This was made for personal use with no guarantee of accuracy.

Some of the new features added to this fork:

- Win-rate delta instead of winrate for each suggestion
  - This makes it easier to scan the results
- Configurable champion win-rate influence
  - This lets you get more off-meta recommendations while still considering overall winrate
- Configurable role matchup and duo influence.
  - This lets you choose which specific roles you want to counter/synergize with
- Configurable blindability scoring
  - This rewards champions with consistently strong synergies and matchups when picks are still unknown, while accounting for data confidence
- Configurable team composition scoring
  - The Comp Δ rewards picks that improve damage balance, frontline, fight planning through engage or peel, hard crowd control, waveclear, and sustained damage, using a five-level capability gradient with more influence late in the allied draft
  - Damage balance and reliable fight planning receive slightly more weight than contextual needs such as waveclear and sustained damage
  - A smaller enemy-response component rewards sustained damage into frontline, defensive tools into engage, and answers to waveclear-heavy teams; it scales with known enemy picks and stays within the same Comp Δ cap
- Flex-pick uncertainty analysis
  - This weights every valid role assignment by its likelihood instead of assuming each flexible champion is in its single most likely role
- Random small improvements
  - Remember hover setting, remember window size/position, etc.

---

DraftGap.com is a site and desktop application which helps you pick and draft your League of Legends team. It suggests champions based on the meta, their matchups with every opponent champion, every ally duo, and configurable composition fundamentals. Matchup, duo, damage, and scaling inputs come from statistics; frontline, engage, peel, crowd-control, waveclear, and sustained-damage capabilities use a small, reviewed champion profile.

If you ever wondered what champion to pick, which is the best champion you could have picked, or if the game was truly lost in draft, DraftGap is for you.

Find it at [draftgap.com](https://draftgap.com), or download the app, which integrates with the League client to automatically synchronize with the current draft in champ select.
