import { ratingToWinrate } from "../rating/ratings";
import { priorGamesByRiskLevel } from "../risk/risk-level";
import { weightedLowerTailSum } from "../statistics/weighted-tail";

const LOWER_TAIL_FRACTION = 0.2;
const LOWER_TAIL_WEIGHT = 0.5;
const HARD_COUNTER_WINRATE = 0.48;
const MAX_COUNTER_EXPOSURE = 8;
const COUNTER_EXPOSURE_RATING_SCALE = 50;
// Derivative of winrateToRating at 50%, used for the local normal approximation.
const RATING_PER_WINRATE = 1600 / Math.log(10);

type WeightedRating = { rating: number; weight: number };
type BlindInteraction = { wins: number; games: number; weight: number };

// Deterministic integration over a normal distribution, including both tails.
// Reusing these nodes avoids randomness and keeps suggestion ordering stable.
const NORMAL_NODES = Array.from({ length: 17 }, (_, index) => {
    const z = (index - 8) / 2;
    return { z, weight: Math.exp(-(z ** 2) / 2) };
});
const NORMAL_WEIGHT = NORMAL_NODES.reduce((sum, node) => sum + node.weight, 0);
for (const node of NORMAL_NODES) node.weight /= NORMAL_WEIGHT;

function getDistribution(mean: number, standardDeviation: number, weight = 1) {
    if (standardDeviation === 0) return [{ rating: mean, weight }];
    return NORMAL_NODES.map((node) => ({
        rating: mean + node.z * standardDeviation,
        weight: weight * node.weight,
    }));
}

function getAllyFit(interactions: WeightedRating[]) {
    const totalWeight = interactions.reduce((sum, row) => sum + row.weight, 0);
    if (totalWeight === 0) return { gap: 0, score: 0 };
    const mean =
        interactions.reduce((sum, row) => sum + row.rating * row.weight, 0) /
        totalWeight;
    const tailWeight = totalWeight * LOWER_TAIL_FRACTION;
    const tailRating = weightedLowerTailSum(interactions, tailWeight);
    const gap = Math.max(0, mean - tailRating / tailWeight);
    return { gap, score: mean - LOWER_TAIL_WEIGHT * gap };
}

function getExposure(rating: number) {
    const downside = Math.max(0, 0.5 - ratingToWinrate(rating));
    return Math.min(
        MAX_COUNTER_EXPOSURE,
        (downside / (0.5 - HARD_COUNTER_WINRATE)) ** 2,
    );
}

function getExpectedExposure(mean: number, standardDeviation: number) {
    if (standardDeviation === 0) return getExposure(mean);
    return NORMAL_NODES.reduce(
        (sum, node) =>
            sum + node.weight * getExposure(mean + node.z * standardDeviation),
        0,
    );
}

export function getBlindInteractionPrior(
    interactions: Iterable<{ wins: number; games: number }>,
    ratingWeight = 1,
) {
    let squaredEffect = 0;
    let totalGames = 0;
    for (const { wins, games } of interactions) {
        if (!Number.isFinite(wins) || !Number.isFinite(games) || games <= 0)
            continue;
        const effect = Math.min(1, Math.max(0, wins / games)) - 0.5;
        // Fit a shared role-pair spread from baseline-adjusted observations.
        // Subtract binomial sampling variance (at neutral, conservatively) so
        // sparse/noisy pair rates do not inflate the ordinary-risk baseline.
        squaredEffect += games * effect ** 2 - 0.25;
        totalGames += games;
    }
    const variance =
        totalGames > 0 ? Math.max(0, squaredEffect / totalGames) : 0;
    const standardDeviation =
        RATING_PER_WINRATE * Math.sqrt(variance) * Math.max(0, ratingWeight);
    const allyFit = getAllyFit(getDistribution(0, standardDeviation));
    return {
        variance,
        ratingWeight: Math.max(0, ratingWeight),
        standardDeviation,
        allyFit,
        counterExposure: getExpectedExposure(0, standardDeviation),
    };
}

type InteractionPrior = ReturnType<typeof getBlindInteractionPrior>;

function validInteractions(interactions: BlindInteraction[]) {
    return interactions.filter(
        ({ wins, games, weight }) =>
            Number.isFinite(wins) &&
            Number.isFinite(games) &&
            games >= 0 &&
            Number.isFinite(weight) &&
            weight > 0,
    );
}

function getEstimate(
    row: BlindInteraction,
    prior: InteractionPrior,
    priorGames: number,
) {
    if (row.games === 0 || prior.variance === 0) {
        return { mean: 0, standardDeviation: prior.standardDeviation };
    }
    // Normal-normal update on the baseline-adjusted win-rate effect. The
    // selected risk level scales sampling uncertainty relative to Medium.
    // Unlike a fixed pseudo-game mean followed by a separate penalty, the
    // mean and spread here use the same evidence weight. These distributions
    // approximate interaction effects; they are not match win-rate intervals.
    const samplingVariance =
        (0.25 / row.games) * (priorGames / priorGamesByRiskLevel.medium);
    const confidence = prior.variance / (prior.variance + samplingVariance);
    const effect = Math.min(1, Math.max(0, row.wins / row.games)) - 0.5;
    return {
        mean: RATING_PER_WINRATE * effect * confidence * prior.ratingWeight,
        standardDeviation: prior.standardDeviation * Math.sqrt(1 - confidence),
    };
}

export function getAllyBlindability(
    interactions: BlindInteraction[],
    prior: InteractionPrior,
    priorGames: number,
) {
    const rows = validInteractions(interactions);
    if (!rows.some((row) => row.games > 0)) return { gap: 0, score: 0 };
    const distribution = rows.flatMap((row) => {
        const estimate = getEstimate(row, prior, priorGames);
        return getDistribution(
            estimate.mean,
            estimate.standardDeviation,
            row.weight,
        );
    });
    const fit = getAllyFit(distribution);
    return {
        gap: Math.max(0, fit.gap - prior.allyFit.gap),
        score: fit.score - prior.allyFit.score,
    };
}

export function getCounterBlindability(
    interactions: BlindInteraction[],
    prior: InteractionPrior,
    priorGames: number,
) {
    const rows = validInteractions(interactions);
    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    if (totalWeight === 0)
        return {
            counterExposure: 0,
            baselineExposure: 0,
            hardCounterRate: 0,
            score: 0,
        };
    let exposure = 0;
    let difference = 0;
    let hardCounterWeight = 0;
    for (const row of rows) {
        const estimate = getEstimate(row, prior, priorGames);
        const expectedExposure =
            row.games === 0
                ? prior.counterExposure
                : getExpectedExposure(
                      // Favorable point estimates cannot cancel counter exposure.
                      // Evidence of neutral or favorable matchups earns safety by
                      // reducing uncertainty, with the same reward at equal support.
                      Math.min(0, estimate.mean),
                      estimate.standardDeviation,
                  );
        exposure += expectedExposure * row.weight;
        difference += (expectedExposure - prior.counterExposure) * row.weight;
        if (
            row.games > 0 &&
            ratingToWinrate(estimate.mean) <= HARD_COUNTER_WINRATE
        ) {
            hardCounterWeight += row.weight;
        }
    }
    return {
        counterExposure: exposure / totalWeight,
        baselineExposure: prior.counterExposure,
        hardCounterRate: hardCounterWeight / totalWeight,
        score:
            difference === 0
                ? 0
                : (-COUNTER_EXPOSURE_RATING_SCALE * difference) / totalWeight,
    };
}
