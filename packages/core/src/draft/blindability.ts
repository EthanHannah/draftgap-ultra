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
// A blind pick invites counterpicks. A share of opponents (set per role pair
// by the caller) is modeled as choosing from the forecast tilted toward
// champions estimated to beat the pick; the rest follow the forecast alone.
// Every 2% of estimated advantage multiplies a champion's counterpick weight
// by e. These are design defaults.
const DEFAULT_COUNTERPICK_SHARE = 0.5;
const COUNTERPICK_RATING_SCALE = RATING_PER_WINRATE * 0.02;
// Caps the tilt at e^4 (an 8% advantage) so one extreme estimate cannot
// absorb the whole counterpick share.
const MAX_COUNTERPICK_TILT_EXPONENT = 4;
// Baselines are tabulated on sqrt(confidence), where they change fastest.
const BASELINE_STEPS = 32;

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
    // Expected teammate performance belongs to situational scoring. Blind
    // ally fit measures only downside relative to that expected performance.
    return { gap, score: -LOWER_TAIL_WEIGHT * gap };
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
        exposureBaselines: getExposureBaselines(standardDeviation),
    };
}

function getCounterpickTilt(mean: number) {
    return Math.exp(
        Math.min(
            MAX_COUNTERPICK_TILT_EXPONENT,
            Math.max(0, -mean) / COUNTERPICK_RATING_SCALE,
        ),
    );
}

function getRowExposure(mean: number, standardDeviation: number) {
    // Favorable point estimates cannot cancel counter exposure. Evidence of
    // neutral or favorable matchups earns safety by reducing uncertainty.
    return getExpectedExposure(Math.min(0, mean), standardDeviation);
}

// Expected row exposure for a typical champion whose matchup has the given
// evidence. Under the normal model the posterior mean of a typical champion
// is distributed N(0, sd * sqrt(confidence)) and its spread is
// sd * sqrt(1 - confidence). Comparing each row with the typical champion at
// the same confidence keeps blindability from rewarding play rate itself:
// only matchups that are better or worse than usual move the score.
function getExposureBaselines(standardDeviation: number) {
    return Array.from({ length: BASELINE_STEPS + 1 }, (_, step) => {
        if (step === 0) {
            // Without evidence every champion shares the prior exactly.
            const exposure = getExpectedExposure(0, standardDeviation);
            return { meta: exposure, counter: exposure, tiltMass: 1 };
        }
        const confidence = (step / BASELINE_STEPS) ** 2;
        const meanSpread = standardDeviation * Math.sqrt(confidence);
        const posteriorSpread = standardDeviation * Math.sqrt(1 - confidence);
        let meta = 0;
        let tiltWeight = 0;
        let tilted = 0;
        for (const node of NORMAL_NODES) {
            const mean = node.z * meanSpread;
            const exposure = getRowExposure(mean, posteriorSpread);
            const tilt = getCounterpickTilt(mean);
            meta += node.weight * exposure;
            tiltWeight += node.weight * tilt;
            tilted += node.weight * tilt * exposure;
        }
        return { meta, counter: tilted / tiltWeight, tiltMass: tiltWeight };
    });
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
        return {
            mean: 0,
            standardDeviation: prior.standardDeviation,
            confidence: 0,
        };
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
        confidence,
    };
}

function getExposureBaseline(prior: InteractionPrior, confidence: number) {
    const position =
        Math.sqrt(Math.min(1, Math.max(0, confidence))) * BASELINE_STEPS;
    const lower = Math.min(BASELINE_STEPS - 1, Math.floor(position));
    const fraction = position - lower;
    const a = prior.exposureBaselines[lower]!;
    const b = prior.exposureBaselines[lower + 1]!;
    return {
        meta: a.meta + (b.meta - a.meta) * fraction,
        counter: a.counter + (b.counter - a.counter) * fraction,
        tiltMass: a.tiltMass + (b.tiltMass - a.tiltMass) * fraction,
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
    counterpickShare = DEFAULT_COUNTERPICK_SHARE,
) {
    const share = Math.min(1, Math.max(0, counterpickShare));
    const rows = validInteractions(interactions);
    const totalWeight = rows.reduce((sum, row) => sum + row.weight, 0);
    if (totalWeight === 0)
        return {
            counterExposure: 0,
            baselineExposure: 0,
            hardCounterRate: 0,
            score: 0,
        };
    let observed = false;
    let observedWeight = 0;
    let squaredWeight = 0;
    let metaExposure = 0;
    let metaBaseline = 0;
    let counterWeight = 0;
    let counterExposure = 0;
    let typicalTiltWeight = 0;
    let typicalCounterExposure = 0;
    let hardCounterWeight = 0;
    for (const row of rows) {
        const estimate = getEstimate(row, prior, priorGames);
        const exposure =
            row.games === 0
                ? prior.counterExposure
                : getRowExposure(estimate.mean, estimate.standardDeviation);
        const baseline = getExposureBaseline(prior, estimate.confidence);
        if (row.games > 0) {
            observed = true;
            observedWeight += row.weight;
            squaredWeight += row.weight ** 2;
        }
        metaExposure += exposure * row.weight;
        metaBaseline += baseline.meta * row.weight;
        // Counterpickers act on shrunk estimates, so sparse noisy rows are
        // not treated as known counters.
        const tiltedWeight = row.weight * getCounterpickTilt(estimate.mean);
        counterWeight += tiltedWeight;
        counterExposure += exposure * tiltedWeight;
        typicalTiltWeight += row.weight * baseline.tiltMass;
        typicalCounterExposure +=
            row.weight * baseline.tiltMass * baseline.counter;
        if (
            row.games > 0 &&
            ratingToWinrate(estimate.mean) <= HARD_COUNTER_WINRATE
        ) {
            hardCounterWeight += row.weight;
        }
    }
    const metaMean = metaExposure / totalWeight;
    const typicalMeta = metaBaseline / totalWeight;
    const counterMean = counterExposure / counterWeight;
    // A typical champion facing counterpicks from a large pool is exposed to
    // its tilted baseline; with a single opponent there is nothing to choose
    // between and counterpicks change nothing. Interpolate on the effective
    // number of observed opponents, which matches both limits to first order.
    // Unobserved opponents are identical neutral options for every champion.
    const effectiveOpponents = observed
        ? observedWeight ** 2 / squaredWeight
        : 1;
    const typicalCounter =
        typicalMeta +
        (typicalCounterExposure / typicalTiltWeight - typicalMeta) *
            (1 - 1 / effectiveOpponents);
    const difference = observed
        ? (1 - share) * (metaMean - typicalMeta) +
          share * (counterMean - typicalCounter)
        : 0;
    return {
        counterExposure: (1 - share) * metaMean + share * counterMean,
        baselineExposure: prior.counterExposure,
        hardCounterRate: hardCounterWeight / totalWeight,
        score:
            difference === 0 ? 0 : -COUNTER_EXPOSURE_RATING_SCALE * difference,
    };
}
