import { Role, ROLES } from "../models/Role";
import { Dataset } from "../models/dataset/Dataset";
import { ratingToWinrate } from "../rating/ratings";
import { priorGamesByRiskLevel } from "../risk/risk-level";
import {
    DraftResult,
    AnalyzeDraftConfig,
    analyzeDraft,
    analyzeDuo,
    analyzeMatchup,
} from "./analysis";
import { getStats } from "./utils";

export type SuggestionConfig = AnalyzeDraftConfig & {
    synergyBlindabilityWeight: number;
    matchupBlindabilityWeight: number;
};

export type BlindabilityResult = {
    synergyGap: number;
    matchupGap: number;
    synergyScore: number;
    matchupScore: number;
    synergyConfidence: number;
    matchupConfidence: number;
    synergyRating: number;
    matchupRating: number;
    totalRating: number;
    adjustedRating: number;
    adjustedWinrate: number;
};

export interface Suggestion {
    championKey: string;
    role: Role;
    draftResult: DraftResult;
    blindabilityResult: BlindabilityResult;
}

type RawSuggestion = Omit<Suggestion, "blindabilityResult"> & {
    synergyGap: number;
    matchupGap: number;
    synergyScore: number;
    matchupScore: number;
    synergyConfidence: number;
    matchupConfidence: number;
};

// A suggested champion can have four unknown allies and five unknown opponents.
// Calibrate their summed risk-adjusted scores to one normal interaction so
// blindability remains a secondary modifier while still fading as slots fill.
const MAX_UNKNOWN_INTERACTIONS = ROLES.length * 2 - 1;

function isEligibleInRole(
    dataset: Dataset,
    championKey: string,
    role: Role,
    minGames: number,
) {
    return (getStats(dataset, championKey, role).games / 30) * 7 >= minGames;
}

function getRatingGap(ratings: number[]) {
    if (ratings.length < 2) return 0;

    return Math.max(...ratings) - Math.min(...ratings);
}

function getBlindabilityScore(ratings: number[]) {
    if (ratings.length === 0) return { gap: 0, score: 0 };

    const gap = getRatingGap(ratings);
    const mean =
        ratings.reduce((total, rating) => total + rating, 0) / ratings.length;

    // Reward strong average interactions while charging half the full spread
    // for the risk of an unfavorable unknown pick.
    return { gap, score: mean - gap / 2 };
}

function getWeight(value: number) {
    return Math.min(100, Math.max(0, value)) / 100;
}

function getInteractionConfidence(
    observedGames: number,
    interactionCount: number,
    priorGames: number,
) {
    if (interactionCount === 0) return 0;

    return observedGames / (observedGames + priorGames * interactionCount);
}

export function getSuggestions(
    dataset: Dataset,
    synergyMatchupDataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    config: SuggestionConfig,
    bannedChampionKeys: Iterable<string> = [],
) {
    const remainingRoles = ROLES.filter((role) => !team.has(role));
    const remainingEnemyRoles = ROLES.filter((role) => !enemy.has(role));
    const enemyChampions = new Set(enemy.values());
    const allyChampions = new Set(team.values());
    const bannedChampions = new Set(bannedChampionKeys);
    const unavailableChampions = new Set([
        ...enemyChampions,
        ...allyChampions,
        ...bannedChampions,
    ]);
    const availableChampionsByRole = Object.fromEntries(
        ROLES.map((role) => [
            role,
            Object.keys(dataset.championData).filter(
                (championKey) =>
                    !unavailableChampions.has(championKey) &&
                    isEligibleInRole(
                        synergyMatchupDataset,
                        championKey,
                        role,
                        config.minGames,
                    ),
            ),
        ]),
    ) as Record<Role, string[]>;
    const priorGames = priorGamesByRiskLevel[config.riskLevel];
    const duoResultCache = new Map<string, ReturnType<typeof analyzeDuo>>();
    const matchupResultCache = new Map<
        string,
        ReturnType<typeof analyzeMatchup>
    >();

    const getDuoResult = (
        championKey: string,
        role: Role,
        teammateKey: string,
        teammateRole: Role,
    ) => {
        const cacheKey = `${championKey}:${role}:${teammateKey}:${teammateRole}`;
        const cachedResult = duoResultCache.get(cacheKey);
        if (cachedResult !== undefined) return cachedResult;

        const result = analyzeDuo(
            synergyMatchupDataset,
            role,
            championKey,
            teammateRole,
            teammateKey,
            priorGames,
            config.duoRoleWeights,
        );
        duoResultCache.set(cacheKey, result);
        return result;
    };

    const getMatchupResult = (
        championKey: string,
        role: Role,
        opponentKey: string,
        opponentRole: Role,
    ) => {
        const cacheKey = `${championKey}:${role}:${opponentKey}:${opponentRole}`;
        const cachedResult = matchupResultCache.get(cacheKey);
        if (cachedResult !== undefined) return cachedResult;

        const result = analyzeMatchup(
            synergyMatchupDataset,
            role,
            championKey,
            opponentRole,
            opponentKey,
            priorGames,
            config.matchupRoleWeights,
        );
        matchupResultCache.set(cacheKey, result);
        return result;
    };

    const rawSuggestions: RawSuggestion[] = [];

    for (const championKey of Object.keys(dataset.championData)) {
        if (enemyChampions.has(championKey) || allyChampions.has(championKey))
            continue;

        for (const role of remainingRoles) {
            if (team.has(role)) continue;
            if (
                !isEligibleInRole(
                    synergyMatchupDataset,
                    championKey,
                    role,
                    config.minGames,
                )
            )
                continue;

            const unknownAllyRoles = remainingRoles.filter(
                (unknownRole) => unknownRole !== role,
            );
            let synergyGap = 0;
            let synergyScore = 0;
            let synergyGames = 0;
            let synergyInteractionCount = 0;
            for (const teammateRole of unknownAllyRoles) {
                const results = availableChampionsByRole[teammateRole]
                    .filter((teammateKey) => teammateKey !== championKey)
                    .map((teammateKey) =>
                        getDuoResult(
                            championKey,
                            role,
                            teammateKey,
                            teammateRole,
                        ),
                    );
                const blindability = getBlindabilityScore(
                    results.map((result) => result.rating),
                );
                synergyGap += blindability.gap;
                synergyScore += blindability.score;
                synergyGames += results.reduce(
                    (games, result) => games + result.games,
                    0,
                );
                synergyInteractionCount += results.length;
            }

            let matchupGap = 0;
            let matchupScore = 0;
            let matchupGames = 0;
            let matchupInteractionCount = 0;
            for (const opponentRole of remainingEnemyRoles) {
                const results = availableChampionsByRole[opponentRole]
                    .filter((opponentKey) => opponentKey !== championKey)
                    .map((opponentKey) =>
                        getMatchupResult(
                            championKey,
                            role,
                            opponentKey,
                            opponentRole,
                        ),
                    );
                const blindability = getBlindabilityScore(
                    results.map((result) => result.rating),
                );
                matchupGap += blindability.gap;
                matchupScore += blindability.score;
                matchupGames += results.reduce(
                    (games, result) => games + result.games,
                    0,
                );
                matchupInteractionCount += results.length;
            }

            const synergyConfidence = getInteractionConfidence(
                synergyGames,
                synergyInteractionCount,
                priorGames,
            );
            const matchupConfidence = getInteractionConfidence(
                matchupGames,
                matchupInteractionCount,
                priorGames,
            );

            team.set(role, championKey);
            const draftResult = analyzeDraft(
                dataset,
                synergyMatchupDataset,
                team,
                enemy,
                config,
            );
            team.delete(role);

            rawSuggestions.push({
                championKey,
                role,
                draftResult,
                synergyGap,
                matchupGap,
                synergyScore,
                matchupScore,
                synergyConfidence,
                matchupConfidence,
            });
        }
    }

    const scoreTotalsByRole = new Map<
        Role,
        {
            synergyConfidence: number;
            matchupConfidence: number;
            weightedSynergyScore: number;
            weightedMatchupScore: number;
        }
    >();

    for (const suggestion of rawSuggestions) {
        if (bannedChampions.has(suggestion.championKey)) continue;

        const totals = scoreTotalsByRole.get(suggestion.role) ?? {
            synergyConfidence: 0,
            matchupConfidence: 0,
            weightedSynergyScore: 0,
            weightedMatchupScore: 0,
        };
        totals.synergyConfidence += suggestion.synergyConfidence;
        totals.matchupConfidence += suggestion.matchupConfidence;
        totals.weightedSynergyScore +=
            suggestion.synergyScore * suggestion.synergyConfidence;
        totals.weightedMatchupScore +=
            suggestion.matchupScore * suggestion.matchupConfidence;
        scoreTotalsByRole.set(suggestion.role, totals);
    }

    const suggestions = rawSuggestions.map<Suggestion>((suggestion) => {
        const roleTotals = scoreTotalsByRole.get(suggestion.role);
        const meanSynergyScore = roleTotals?.synergyConfidence
            ? roleTotals.weightedSynergyScore / roleTotals.synergyConfidence
            : suggestion.synergyScore;
        const meanMatchupScore = roleTotals?.matchupConfidence
            ? roleTotals.weightedMatchupScore / roleTotals.matchupConfidence
            : suggestion.matchupScore;
        const synergyRating =
            (suggestion.synergyScore - meanSynergyScore) *
            suggestion.synergyConfidence *
            (getWeight(config.synergyBlindabilityWeight) /
                MAX_UNKNOWN_INTERACTIONS);
        const matchupRating =
            (suggestion.matchupScore - meanMatchupScore) *
            suggestion.matchupConfidence *
            (getWeight(config.matchupBlindabilityWeight) /
                MAX_UNKNOWN_INTERACTIONS);
        const totalRating = synergyRating + matchupRating;
        const adjustedRating = suggestion.draftResult.totalRating + totalRating;

        return {
            championKey: suggestion.championKey,
            role: suggestion.role,
            draftResult: suggestion.draftResult,
            blindabilityResult: {
                synergyGap: suggestion.synergyGap,
                matchupGap: suggestion.matchupGap,
                synergyScore: suggestion.synergyScore,
                matchupScore: suggestion.matchupScore,
                synergyConfidence: suggestion.synergyConfidence,
                matchupConfidence: suggestion.matchupConfidence,
                synergyRating,
                matchupRating,
                totalRating,
                adjustedRating,
                adjustedWinrate: ratingToWinrate(adjustedRating),
            },
        };
    });

    return suggestions.sort(
        (a, b) =>
            b.blindabilityResult.adjustedWinrate -
            a.blindabilityResult.adjustedWinrate,
    );
}
