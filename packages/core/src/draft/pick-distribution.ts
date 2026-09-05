import { Dataset } from "../models/dataset/Dataset";
import { Role } from "../models/Role";

export type AvailableChampion = { championKey: string; pickWeight: number };
export type PickAnchor = {
    championKey: string;
    role: Role;
    family: "duo" | "matchup";
};

const PICK_PRIOR_GAMES = 2000;
// Co-occurrence is not observed pick order. Even abundant pair data retains
// half of the ordinary meta distribution rather than asserting a reaction.
const MAX_CONDITIONAL_WEIGHT = 0.5;

export function getDraftPickDistribution(
    dataset: Dataset,
    role: Role,
    champions: AvailableChampion[],
    anchors: PickAnchor[],
) {
    const pool = champions.filter(
        ({ championKey, pickWeight }) =>
            Number.isFinite(pickWeight) &&
            pickWeight > 0 &&
            !anchors.some((anchor) => anchor.championKey === championKey),
    );
    const totalWeight = pool.reduce((total, row) => total + row.pickWeight, 0);
    if (totalWeight === 0) return new Map<string, number>();
    const base = pool.map((row) => row.pickWeight / totalWeight);
    const logRatios = pool.map(() => 0);
    const uniqueAnchors = [
        ...new Map(
            anchors.map((anchor) => [
                `${anchor.family}:${anchor.role}:${anchor.championKey}`,
                anchor,
            ]),
        ).values(),
    ];
    let anchorCount = 0;
    for (const anchor of uniqueAnchors) {
        if (anchor.family === "duo" && anchor.role === role) continue;
        const counts = pool.map(({ championKey }) => {
            const field = anchor.family === "duo" ? "synergy" : "matchup";
            const forward =
                dataset.championData[championKey]?.statsByRole[role]?.[field]?.[
                    anchor.role
                ]?.[anchor.championKey]?.games ?? 0;
            const reverse =
                dataset.championData[anchor.championKey]?.statsByRole[
                    anchor.role
                ]?.[field]?.[role]?.[championKey]?.games ?? 0;
            const valid = [forward, reverse].filter(
                (games) => Number.isFinite(games) && games > 0,
            );
            // These are two views of the same games, never independent samples.
            return valid.length
                ? valid.reduce((a, b) => a + b, 0) / valid.length
                : 0;
        });
        const totalGames = counts.reduce((total, games) => total + games, 0);
        if (totalGames === 0) continue;
        // A large sample for one champion cannot establish the distribution
        // of a mostly unobserved pool. Missing rows retain conservative support.
        const coverage = counts.reduce(
            (total, games, index) => total + (games > 0 ? base[index] : 0),
            0,
        );
        const confidence =
            (MAX_CONDITIONAL_WEIGHT * coverage * totalGames) /
            (totalGames + PICK_PRIOR_GAMES);
        for (let index = 0; index < pool.length; index++) {
            const conditional = counts[index] / totalGames;
            const probability =
                base[index] * (1 - confidence) + conditional * confidence;
            logRatios[index] += Math.log(probability / base[index]);
        }
        anchorCount++;
    }
    // Pool correlated pair evidence geometrically, rather than multiplying
    // nine pair likelihoods as if all revealed picks were independent.
    const weights = base.map(
        (probability, index) =>
            probability *
            Math.exp(anchorCount ? logRatios[index] / anchorCount : 0),
    );
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return new Map(
        pool.map(({ championKey }, index) => [
            championKey,
            weights[index] / total,
        ]),
    );
}
