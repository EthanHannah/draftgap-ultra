type ContextInteraction = {
    rating: number;
    games: number;
    metaWeight: number;
    // Unconditional role frequency limits support: a forecast favoring observed
    // pairs must not make a poorly covered interaction pool look well sampled.
    coverageWeight?: number;
    available: boolean;
};

export function getContextRatings(
    interactions: ContextInteraction[],
    priorGames: number,
    openRoleProbability: number,
) {
    // Historical context uses pair-game frequencies; the target context uses
    // forecast pick probabilities among champions still available in the draft.
    let observedWeight = 0;
    let observedRating = 0;
    let observedSupport = 0;
    let metaWeight = 0;
    let metaRating = 0;
    let metaSupport = 0;
    let coverageWeight = 0;
    let coverageSupport = 0;

    for (const row of interactions) {
        if (
            !Number.isFinite(row.rating) ||
            !Number.isFinite(row.games) ||
            row.games < 0
        )
            continue;

        // Pair ratings already use pseudo-games to shrink noisy effects.
        // Here the same evidence fraction measures coverage of each mix.
        // Average fractions, not game counts: a huge sample against one pick
        // cannot supply evidence for all the unobserved picks in the meta.
        const support =
            row.games > 0 ? row.games / (row.games + priorGames) : 0;
        observedWeight += row.games;
        observedRating += row.rating * row.games;
        observedSupport += support * row.games;
        if (
            row.available &&
            Number.isFinite(row.metaWeight) &&
            row.metaWeight > 0
        ) {
            metaWeight += row.metaWeight;
            metaRating += row.rating * row.metaWeight;
            metaSupport += support * row.metaWeight;
        }
        const baselineWeight = row.coverageWeight ?? row.metaWeight;
        if (
            row.available &&
            Number.isFinite(baselineWeight) &&
            baselineWeight > 0
        ) {
            coverageWeight += baselineWeight;
            coverageSupport += support * baselineWeight;
        }
    }

    const rawObserved =
        observedWeight > 0 ? observedRating / observedWeight : 0;
    const rawMeta = metaWeight > 0 ? metaRating / metaWeight : 0;
    const observedConfidence =
        observedWeight > 0 ? observedSupport / observedWeight : 0;
    const metaConfidence = Math.min(
        metaWeight > 0 ? metaSupport / metaWeight : 0,
        coverageWeight > 0 ? coverageSupport / coverageWeight : 0,
    );
    // A conservative coverage multiplier, not a statistical confidence interval.
    // Scale the entire open-slot contrast by the weaker mix so differing sample
    // sizes cannot manufacture a correction between otherwise equal means.
    const openConfidence = Math.min(observedConfidence, metaConfidence);
    const openProbability = Math.min(1, Math.max(0, openRoleProbability));
    // Known slots need only a supported historical offset: analyzeDraft already
    // supplies their direct, regularized interaction. Unrelated missing future
    // opponents must not suppress that offset. Mix open/known branches linearly
    // to preserve uncertain role assignments.
    const observed =
        rawObserved *
        (openProbability * openConfidence +
            (1 - openProbability) * observedConfidence);
    const meta = rawMeta * openProbability * openConfidence;

    return {
        observed,
        meta,
        rawObserved,
        rawMeta,
        observedConfidence,
        metaConfidence,
        openConfidence,
    };
}
