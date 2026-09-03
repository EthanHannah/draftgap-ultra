import { ChampionRoleData } from "../models/dataset/ChampionRoleData";

export type ScalingProfile = "early" | "mid" | "late" | "stable" | "u-shaped";

const MIN_PHASE_GAMES = 500;
const PRIOR_GAMES = 1000;
const STABLE_WINRATE_SPREAD = 0.02;
const U_SHAPED_MIN_DIP = 0.0125;

export function getChampionScaling(
    champion:
        Pick<ChampionRoleData, "games" | "wins" | "statsByTime"> | undefined,
) {
    if (
        !champion ||
        !Number.isFinite(champion.games) ||
        champion.games <= 0 ||
        !Number.isFinite(champion.wins) ||
        champion.wins < 0 ||
        champion.wins > champion.games ||
        !champion.statsByTime ||
        champion.statsByTime.length < 5
    ) {
        return undefined;
    }

    // Keep the stored five-bucket layout shared with the scaling chart.
    // The legacy final bucket overlaps 30–35 and excludes 40+ games.
    // Pool wins and games so a small duration bucket cannot dominate a phase.
    const baseline = champion.wins / champion.games;
    const deltas: number[] = [];
    for (const indices of [[0], [1, 2], [3, 4]]) {
        let games = 0;
        let wins = 0;
        for (const index of indices) {
            const stats = champion.statsByTime[index];
            if (
                !stats ||
                !Number.isFinite(stats.games) ||
                stats.games < 0 ||
                !Number.isFinite(stats.wins) ||
                stats.wins < 0 ||
                stats.wins > stats.games
            ) {
                return undefined;
            }
            games += stats.games;
            wins += stats.wins;
        }
        // Missing evidence is unknown, never a flat (Stable) scaling profile.
        if (games < MIN_PHASE_GAMES) return undefined;

        // Shrink toward this champion's own role win rate. A fixed prior keeps
        // draft risk settings from changing filter membership.
        deltas.push(
            (wins + PRIOR_GAMES * baseline) / (games + PRIOR_GAMES) - baseline,
        );
    }

    // Both ends must exceed mid game by 1.25 percentage points after shrinkage.
    // Check the shape before Stable so shallow U-shaped curves qualify too.
    const [early, mid, late] = deltas;
    if (early - mid > U_SHAPED_MIN_DIP && late - mid > U_SHAPED_MIN_DIP) {
        return "u-shaped" as const;
    }

    const peak = Math.max(...deltas);
    if (peak - Math.min(...deltas) <= STABLE_WINRATE_SPREAD) {
        return "stable" as const;
    }

    return (["early", "mid", "late"] as const)[deltas.indexOf(peak)];
}
