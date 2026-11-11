import { Dataset } from "../models/dataset/Dataset";
import { Role } from "../models/Role";
import { priorGamesByRiskLevel } from "../risk/risk-level";

export type PairFamily = "matchup" | "synergy";
type EffectRow = { wins: number; games: number };
type EffectFn = (
    dataset: Dataset,
    roleA: Role,
    championKeyA: string,
    roleB: Role,
    championKeyB: string,
) => EffectRow;

// Only champions played regularly in a role describe its real interaction
// spread; rare off-role picks have unreliable baselines.
const MIN_ROLE_GAMES = 5000;
// Minimum evidence before the measured spread replaces the fixed prior.
// Small or synthetic datasets keep the risk level's pseudo-games unchanged.
const MIN_PAIRS = 20;
const MIN_PAIR_GAMES = 200_000;
// Bounds on the fitted pseudo-games at Medium risk, so one unusual role pair
// can neither trust a few hundred games outright nor ignore large samples.
const MIN_FITTED_PRIOR = 250;
const MAX_FITTED_PRIOR = 100_000;

const cache = new WeakMap<Dataset, Map<string, number | null>>();

// Returns pseudo-games at Medium risk for one role pair: the sample size at
// which sampling noise (0.25 / games) equals the measured spread of true
// effects. This is the normal-normal shrinkage weight, so strong lane
// matchups keep most of their effect while weak cross-role pairs and duos
// stay close to neutral. Null when the dataset cannot support an estimate.
function getFittedPriorGames(
    dataset: Dataset,
    family: PairFamily,
    roleA: Role,
    roleB: Role,
    getEffect: EffectFn,
) {
    let datasetCache = cache.get(dataset);
    if (!datasetCache) {
        datasetCache = new Map();
        cache.set(dataset, datasetCache);
    }
    // Spread is symmetric in the two roles; share one estimate.
    const [low, high] = roleA <= roleB ? [roleA, roleB] : [roleB, roleA];
    const key = `${family}:${low}:${high}`;
    const cached = datasetCache.get(key);
    if (cached !== undefined) return cached;

    let squaredEffect = 0;
    let totalGames = 0;
    let pairs = 0;
    for (const [keyA, championA] of Object.entries(dataset.championData)) {
        const statsA = championA.statsByRole[low];
        if (!statsA || statsA.games < MIN_ROLE_GAMES) continue;
        for (const keyB of Object.keys(statsA[family]?.[high] ?? {})) {
            if (keyA === keyB) continue;
            const statsB = dataset.championData[keyB]?.statsByRole[high];
            if (!statsB || statsB.games < MIN_ROLE_GAMES) continue;
            const { wins, games } = getEffect(dataset, low, keyA, high, keyB);
            if (!(games > 0) || !Number.isFinite(wins)) continue;
            const effect = Math.min(1, Math.max(0, wins / games)) - 0.5;
            // Remove binomial sampling variance so noise is not read as spread.
            squaredEffect += games * effect ** 2 - 0.25;
            totalGames += games;
            pairs++;
        }
    }
    let fitted: number | null = null;
    if (pairs >= MIN_PAIRS && totalGames >= MIN_PAIR_GAMES) {
        const variance = Math.max(0, squaredEffect / totalGames);
        fitted =
            variance > 0
                ? Math.min(
                      MAX_FITTED_PRIOR,
                      Math.max(MIN_FITTED_PRIOR, 0.25 / variance),
                  )
                : MAX_FITTED_PRIOR;
    }
    datasetCache.set(key, fitted);
    return fitted;
}

// Converts the risk level's pseudo-games into pseudo-games for this role
// pair. The risk level keeps its meaning as a multiplier on caution relative
// to Medium, the same convention blind scoring uses.
export function getPairPriorGames(
    dataset: Dataset,
    family: PairFamily,
    roleA: Role,
    roleB: Role,
    priorGames: number,
    getEffect: EffectFn,
) {
    if (!(priorGames > 0)) return priorGames;
    const fitted = getFittedPriorGames(
        dataset,
        family,
        roleA,
        roleB,
        getEffect,
    );
    if (fitted === null) return priorGames;
    return fitted * (priorGames / priorGamesByRiskLevel.medium);
}
