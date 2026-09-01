import { Role, ROLES } from "../models/Role";
import { Dataset } from "../models/dataset/Dataset";
import { ratingToWinrate, winrateToRating } from "../rating/ratings";
import { priorGamesByRiskLevel } from "../risk/risk-level";
import {
    DraftResult,
    AnalyzeDraftConfig,
    analyzeDraft,
    analyzeDuo,
    analyzeMatchup,
    aggregateDraftResults,
    normalizeTeamComps,
    WeightedTeamComp,
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
const BLINDABILITY_LOWER_TAIL_FRACTION = 0.2;

type WeightedInteraction = {
    rating: number;
    weight: number;
};

type AvailableChampion = {
    championKey: string;
    pickWeight: number;
};

function isEligibleInRole(
    dataset: Dataset,
    championKey: string,
    role: Role,
    minGames: number,
) {
    return (getStats(dataset, championKey, role).games / 30) * 7 >= minGames;
}

function getBlindabilityScore(interactions: WeightedInteraction[]) {
    const weightedInteractions = interactions.filter(
        ({ rating, weight }) =>
            Number.isFinite(rating) && Number.isFinite(weight) && weight > 0,
    );
    if (weightedInteractions.length === 0) return { gap: 0, score: 0 };

    const totalWeight = weightedInteractions.reduce(
        (total, interaction) => total + interaction.weight,
        0,
    );
    const mean =
        weightedInteractions.reduce(
            (total, interaction) =>
                total + interaction.rating * interaction.weight,
            0,
        ) / totalWeight;

    // Use the average result from the most unfavorable 20% of likely picks as
    // the downside case. Unlike the full range, this cannot punish a champion
    // for gaining an unusually strong interaction and is less sensitive to a
    // single rare outlier.
    const lowerTailWeight = totalWeight * BLINDABILITY_LOWER_TAIL_FRACTION;
    let remainingTailWeight = lowerTailWeight;
    let lowerTailRating = 0;
    const sortedInteractions = [...weightedInteractions].sort(
        (a, b) => a.rating - b.rating,
    );

    for (const interaction of sortedInteractions) {
        if (remainingTailWeight <= 0) break;

        const includedWeight = Math.min(
            interaction.weight,
            remainingTailWeight,
        );
        lowerTailRating += interaction.rating * includedWeight;
        remainingTailWeight -= includedWeight;
    }

    const lowerTailMean = lowerTailRating / lowerTailWeight;
    const gap = Math.max(0, mean - lowerTailMean);

    // Blend expected performance and downside performance evenly.
    return { gap, score: mean - gap / 2 };
}

function getWeight(value: number) {
    return Math.min(100, Math.max(0, value)) / 100;
}

function getInteractionConfidence(
    interactions: { games: number; weight: number }[],
    priorGames: number,
) {
    const weightedInteractions = interactions.filter(
        ({ games, weight }) =>
            Number.isFinite(games) &&
            Number.isFinite(weight) &&
            games >= 0 &&
            weight > 0,
    );
    if (weightedInteractions.length === 0) return 0;

    const totalWeight = weightedInteractions.reduce(
        (total, interaction) => total + interaction.weight,
        0,
    );
    const weightedGames = weightedInteractions.reduce(
        (total, interaction) =>
            total + interaction.games * interaction.weight,
        0,
    );

    return weightedGames / (weightedGames + priorGames * totalWeight);
}

export function getSuggestions(
    dataset: Dataset,
    synergyMatchupDataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    config: SuggestionConfig,
    bannedChampionKeys: Iterable<string> = [],
) {
    return getSuggestionsWithRoleUncertainty(
        dataset,
        synergyMatchupDataset,
        [[team, 1]],
        [[enemy, 1]],
        config,
        bannedChampionKeys,
    );
}

export function getSuggestionsWithRoleUncertainty(
    dataset: Dataset,
    synergyMatchupDataset: Dataset,
    teamComps: WeightedTeamComp[],
    enemyComps: WeightedTeamComp[],
    config: SuggestionConfig,
    bannedChampionKeys: Iterable<string> = [],
) {
    const normalizedTeamComps = normalizeTeamComps(teamComps);
    const normalizedEnemyComps = normalizeTeamComps(enemyComps);
    const enemyChampions = new Set(
        normalizedEnemyComps.flatMap(([enemy]) => [...enemy.values()]),
    );
    const allyChampions = new Set(
        normalizedTeamComps.flatMap(([team]) => [...team.values()]),
    );
    const bannedChampions = new Set(bannedChampionKeys);
    const unavailableChampions = new Set([
        ...enemyChampions,
        ...allyChampions,
        ...bannedChampions,
    ]);
    const availableChampionsByRole = Object.fromEntries(
        ROLES.map((role) => [
            role,
            Object.keys(dataset.championData)
                .filter(
                    (championKey) =>
                        !unavailableChampions.has(championKey) &&
                        isEligibleInRole(
                            synergyMatchupDataset,
                            championKey,
                            role,
                            config.minGames,
                        ),
                )
                .map((championKey) => ({
                    championKey,
                    pickWeight: getStats(
                        synergyMatchupDataset,
                        championKey,
                        role,
                    ).games,
                })),
        ]),
    ) as Record<Role, AvailableChampion[]>;
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

    const enemyOpenRoleProbability = Object.fromEntries(
        ROLES.map((role) => [
            role,
            normalizedEnemyComps.reduce(
                (probability, [enemy, weight]) =>
                    probability + (enemy.has(role) ? 0 : weight),
                0,
            ),
        ]),
    ) as Record<Role, number>;

    for (const championKey of Object.keys(dataset.championData)) {
        if (enemyChampions.has(championKey) || allyChampions.has(championKey))
            continue;

        for (const role of ROLES) {
            const roleCompatibleTeamComps = normalizedTeamComps.filter(
                ([team]) => !team.has(role),
            );
            if (roleCompatibleTeamComps.length === 0) continue;
            const compatibleTeamComps = normalizeTeamComps(
                roleCompatibleTeamComps,
            );
            if (
                !isEligibleInRole(
                    synergyMatchupDataset,
                    championKey,
                    role,
                    config.minGames,
                )
            )
                continue;

            const allyOpenRoleProbability = Object.fromEntries(
                ROLES.map((unknownRole) => [
                    unknownRole,
                    unknownRole === role
                        ? 0
                        : compatibleTeamComps.reduce(
                              (probability, [team, weight]) =>
                                  probability +
                                  (team.has(unknownRole) ? 0 : weight),
                              0,
                          ),
                ]),
            ) as Record<Role, number>;
            let synergyGap = 0;
            let synergyScore = 0;
            const synergyInteractions: { games: number; weight: number }[] = [];
            for (const teammateRole of ROLES) {
                const roleProbability = allyOpenRoleProbability[teammateRole];
                if (roleProbability === 0) continue;

                const results = availableChampionsByRole[teammateRole]
                    .filter(
                        (teammate) =>
                            teammate.championKey !== championKey,
                    )
                    .map((teammate) => ({
                        result: getDuoResult(
                            championKey,
                            role,
                            teammate.championKey,
                            teammateRole,
                        ),
                        weight: teammate.pickWeight,
                    }));
                const blindability = getBlindabilityScore(
                    results.map(({ result, weight }) => ({
                        rating: result.rating,
                        weight,
                    })),
                );
                synergyGap += blindability.gap * roleProbability;
                synergyScore += blindability.score * roleProbability;
                synergyInteractions.push(
                    ...results.map(({ result, weight }) => ({
                        games: result.games,
                        weight: weight * roleProbability,
                    })),
                );
            }

            let matchupGap = 0;
            let matchupScore = 0;
            const matchupInteractions: { games: number; weight: number }[] = [];
            for (const opponentRole of ROLES) {
                const roleProbability = enemyOpenRoleProbability[opponentRole];
                if (roleProbability === 0) continue;

                const results = availableChampionsByRole[opponentRole]
                    .filter(
                        (opponent) =>
                            opponent.championKey !== championKey,
                    )
                    .map((opponent) => ({
                        result: getMatchupResult(
                            championKey,
                            role,
                            opponent.championKey,
                            opponentRole,
                        ),
                        weight: opponent.pickWeight,
                    }));
                const blindability = getBlindabilityScore(
                    results.map(({ result, weight }) => ({
                        rating: result.rating,
                        weight,
                    })),
                );
                matchupGap += blindability.gap * roleProbability;
                matchupScore += blindability.score * roleProbability;
                matchupInteractions.push(
                    ...results.map(({ result, weight }) => ({
                        games: result.games,
                        weight: weight * roleProbability,
                    })),
                );
            }

            const synergyConfidence = getInteractionConfidence(
                synergyInteractions,
                priorGames,
            );
            const matchupConfidence = getInteractionConfidence(
                matchupInteractions,
                priorGames,
            );

            const draftResults = compatibleTeamComps.flatMap(
                ([team, teamProbability]) =>
                    normalizedEnemyComps.map(([enemy, enemyProbability]) => {
                        const teamWithSuggestion = new Map(team);
                        teamWithSuggestion.set(role, championKey);

                        return {
                            result: analyzeDraft(
                                dataset,
                                synergyMatchupDataset,
                                teamWithSuggestion,
                                enemy,
                                config,
                            ),
                            weight: teamProbability * enemyProbability,
                        };
                    }),
            );
            const draftResult = aggregateDraftResults(draftResults);

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
        const adjustedRating =
            winrateToRating(suggestion.draftResult.winrate) + totalRating;

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
