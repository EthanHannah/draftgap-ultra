import type { WeightedDraftResult } from "./analysis";

export type EvidenceContribution = {
    rating: number;
    support: number;
};

// Evidence diagnostics, not a probability of winning or a confidence interval.
export function getSampleSupport(games: number, priorGames: number) {
    return Number.isFinite(games) && games > 0
        ? games / (games + priorGames)
        : 0;
}

export function getPickEvidence(
    results: WeightedDraftResult[],
    championKey: string,
    priorGames: number,
    baseEnabled: boolean,
) {
    return results.flatMap(({ result, weight }) => {
        const champions = baseEnabled
            ? result.allyChampionRating.championResults
                  .filter((row) => row.championKey === championKey)
                  .map((row) => ({
                      // Keep a small evidence floor for neutral or missing base stats.
                      rating: Math.max(1, Math.abs(row.rating)),
                      games: row.games,
                  }))
            : [];
        const interactions = [
            ...result.allyDuoRating.duoResults.filter(
                (row) =>
                    row.championKeyA === championKey ||
                    row.championKeyB === championKey,
            ),
            ...result.matchupRating.matchupResults.filter(
                (row) => row.championKeyA === championKey,
            ),
        ];
        // Average support across role assignments before combining evidence;
        // abundant data in one assignment cannot fill another assignment's gaps.
        return [...champions, ...interactions].map((row) => ({
            rating: Math.abs(row.rating) * weight,
            support: getSampleSupport(row.games, priorGames),
        }));
    });
}

export function summarizeSuggestionEvidence(
    contributions: EvidenceContribution[],
) {
    let total = 0;
    let supported = 0;
    for (const { rating, support } of contributions) {
        if (!Number.isFinite(rating) || rating === 0) continue;
        const weight = Math.abs(rating);
        total += weight;
        supported +=
            weight *
            (Number.isFinite(support) ? Math.min(1, Math.max(0, support)) : 0);
    }
    const support = total > 0 ? supported / total : 0;
    // Presentation thresholds only; these are deliberately not displayed as percentages.
    const level =
        support < 0.35
            ? "very-limited"
            : support < 0.7
              ? "limited"
              : "supported";
    return { support, level } as const;
}
