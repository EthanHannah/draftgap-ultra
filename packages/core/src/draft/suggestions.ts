import {
    getInteractionInfluenceWeight,
    getDuoInteractionWeight,
    getMatchupInteractionWeight,
    getBlindMatchupInteractionWeight,
} from "./role-influence";
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
import { getContextRatings } from "./context";
import {
    getAllyBlindability,
    getBlindInteractionPrior,
    getCounterBlindability,
} from "./blindability";
import {
    COMPOSITION_DIMENSIONS,
    CompositionCoverage,
    EnemyCompositionPressures,
    combineCompositionWinrateDeltas,
    getCompositionStageWeight,
    getCompositionWinrateDelta,
    getEnemyCompositionStageWeight,
    getEnemyResponseScore,
    getEnemyResponseWinrateDelta,
    getTeamCompositionScore,
} from "../composition/composition";

import {
    AvailableChampion,
    PickAnchor,
    getDraftPickDistribution,
} from "./pick-distribution";

// Fixed weekly-equivalent role volume for potential interactions and baselines.
export const INTERACTION_MIN_GAMES = 1000;

export type SuggestionConfig = AnalyzeDraftConfig & {
    contextInfluence: number;
    blindabilityWeight: number;
    enemySafetyPriority: number;
    compositionInfluence: number;
};

export type BlindabilityResult = {
    synergyGap: number;
    matchupGap: number;
    counterExposure: number;
    counterExposureBaseline: number;
    hardCounterRate: number;
    // Relative to the shared role-pair priors; no further candidate centering.
    synergyScore: number;
    matchupScore: number;
    // Sample-size support diagnostics, separate from the uncertainty model.
    synergyConfidence: number;
    matchupConfidence: number;
    rating: number;
    adjustedRating: number;
    adjustedWinrate: number;
};

export type CompositionResult = {
    coverage: CompositionCoverage;
    rawScore: number;
    centeredScore: number;
    stageWeight: number;
    alliedWinrateDelta: number;
    enemyResponse: {
        pressures: EnemyCompositionPressures;
        rawScore: number;
        centeredScore: number;
        stageWeight: number;
        winrateDelta: number;
    };
    rating: number;
    winrateDelta: number;
};

export type ContextResult = {
    // Contributions after coverage weighting, including open-role probability.
    allyObservedRating: number;
    allyMetaRating: number;
    enemyObservedRating: number;
    enemyMetaRating: number;
    rating: number;
    adjustedRating: number;
    adjustedWinrate: number;
};

export interface Suggestion {
    championKey: string;
    role: Role;
    draftResult: DraftResult;
    contextResult: ContextResult;
    blindabilityResult: BlindabilityResult;
    compositionResult: CompositionResult;
    adjustedRating: number;
    adjustedWinrate: number;
}

type RawSuggestion = Omit<
    Suggestion,
    | "blindabilityResult"
    | "contextResult"
    | "compositionResult"
    | "adjustedRating"
    | "adjustedWinrate"
> & {
    allyObservedContextRating: number;
    allyMetaContextRating: number;
    enemyObservedContextRating: number;
    enemyMetaContextRating: number;
    synergyGap: number;
    matchupGap: number;
    counterExposure: number;
    counterExposureBaseline: number;
    hardCounterRate: number;
    synergyScore: number;
    matchupScore: number;
    synergyConfidence: number;
    matchupConfidence: number;
    compositionCoverage: CompositionCoverage;
    compositionPickWeight: number;
    compositionScore: number;
    compositionStageWeight: number;
    hasCompositionProfiles: boolean;
    enemyResponsePressures: EnemyCompositionPressures;
    enemyResponseScore: number;
    enemyResponseStageWeight: number;
    hasEnemyResponseProfiles: boolean;
};

function isEligibleInRole(
    dataset: Dataset,
    championKey: string,
    role: Role,
    minGames: number,
) {
    return (getStats(dataset, championKey, role).games / 30) * 7 >= minGames;
}

function getWeight(value: number) {
    return Math.min(100, Math.max(0, value)) / 100;
}

function getContextWeight(value: number) {
    return Math.min(200, Math.max(0, value)) / 100;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
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
        (total, interaction) => total + interaction.games * interaction.weight,
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
    const enemyCompositionScores = normalizedEnemyComps.map(
        ([enemy, probability]) => ({
            enemy,
            probability,
            composition: getTeamCompositionScore(dataset, enemy),
        }),
    );
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
    const eligibleChampionsByRole = Object.fromEntries(
        ROLES.map((role) => [
            role,
            Object.keys(dataset.championData)
                .filter((championKey) =>
                    isEligibleInRole(
                        synergyMatchupDataset,
                        championKey,
                        role,
                        INTERACTION_MIN_GAMES,
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
    const duoInfluence = getInteractionInfluenceWeight(config.duoInfluence);
    const matchupInfluence = getInteractionInfluenceWeight(
        config.matchupInfluence,
    );
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
            getDuoInteractionWeight(role, teammateRole),
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
        );
        matchupResultCache.set(cacheKey, result);
        return result;
    };

    const priorCache = new Map<
        string,
        ReturnType<typeof getBlindInteractionPrior>
    >();
    const getPrior = (
        family: "ally" | "enemy",
        role: Role,
        otherRole: Role,
    ) => {
        const key = `${family}:${role}:${otherRole}`;
        const cached = priorCache.get(key);
        if (cached) return cached;
        function* interactions() {
            for (const candidate of eligibleChampionsByRole[role]) {
                if (unavailableChampions.has(candidate.championKey)) continue;
                for (const other of eligibleChampionsByRole[otherRole]) {
                    if (
                        candidate.championKey === other.championKey ||
                        unavailableChampions.has(other.championKey)
                    )
                        continue;
                    yield family === "ally"
                        ? getDuoResult(
                              candidate.championKey,
                              role,
                              other.championKey,
                              otherRole,
                          )
                        : getMatchupResult(
                              candidate.championKey,
                              role,
                              other.championKey,
                              otherRole,
                          );
                }
            }
        }
        const prior = getBlindInteractionPrior(
            interactions(),
            family === "ally" ? getDuoInteractionWeight(role, otherRole) : 1,
        );
        priorCache.set(key, prior);
        return prior;
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
                    Math.min(config.minGames, INTERACTION_MIN_GAMES),
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
            // Condition forecasts on each legal visible role assignment. The
            // suggested champion becomes visible in either family's forecast;
            // no unrevealed champion identities are used.
            const getFuturePicks = (
                family: "ally" | "enemy",
                targetRole: Role,
            ) => {
                const pool = eligibleChampionsByRole[targetRole].filter(
                    (pick) =>
                        pick.championKey !== championKey &&
                        !unavailableChampions.has(pick.championKey),
                );
                const probabilities = new Map<string, number>();
                let openWeight = 0;
                for (const [team, teamWeight] of compatibleTeamComps) {
                    for (const [enemy, enemyWeight] of normalizedEnemyComps) {
                        if ((family === "ally" ? team : enemy).has(targetRole))
                            continue;
                        const ownTeam = new Map(team);
                        ownTeam.set(role, championKey);
                        const anchors: PickAnchor[] = [
                            ...[...ownTeam].map(([anchorRole, key]) => ({
                                championKey: key,
                                role: anchorRole,
                                family:
                                    family === "ally"
                                        ? ("duo" as const)
                                        : ("matchup" as const),
                            })),
                            ...[...enemy].map(([anchorRole, key]) => ({
                                championKey: key,
                                role: anchorRole,
                                family:
                                    family === "enemy"
                                        ? ("duo" as const)
                                        : ("matchup" as const),
                            })),
                        ];
                        const weight = teamWeight * enemyWeight;
                        const forecast = getDraftPickDistribution(
                            synergyMatchupDataset,
                            targetRole,
                            pool,
                            anchors,
                        );
                        for (const [key, probability] of forecast) {
                            probabilities.set(
                                key,
                                (probabilities.get(key) ?? 0) +
                                    probability * weight,
                            );
                        }
                        openWeight += weight;
                    }
                }
                if (openWeight > 0) {
                    for (const [key, probability] of probabilities) {
                        probabilities.set(key, probability / openWeight);
                    }
                }
                return probabilities;
            };

            let synergyGap = 0;
            let synergyScore = 0;
            let allyObservedContextRating = 0;
            let allyMetaContextRating = 0;
            const synergyInteractions: { games: number; weight: number }[] = [];
            for (const teammateRole of ROLES) {
                if (teammateRole === role) continue;
                const roleProbability = allyOpenRoleProbability[teammateRole];
                const futurePicks = getFuturePicks("ally", teammateRole);
                const results = eligibleChampionsByRole[teammateRole]
                    .filter((teammate) => teammate.championKey !== championKey)
                    .map((teammate) => ({
                        result: getDuoResult(
                            championKey,
                            role,
                            teammate.championKey,
                            teammateRole,
                        ),
                        metaWeight: futurePicks.get(teammate.championKey) ?? 0,
                        coverageWeight: teammate.pickWeight,
                        available: !unavailableChampions.has(
                            teammate.championKey,
                        ),
                    }));
                const contextRatings = getContextRatings(
                    results.map(
                        ({
                            result,
                            metaWeight,
                            coverageWeight,
                            available,
                        }) => ({
                            rating: result.rating,
                            games: result.games,
                            metaWeight,
                            coverageWeight,
                            available,
                        }),
                    ),
                    priorGames,
                    roleProbability,
                );
                allyObservedContextRating +=
                    contextRatings.observed * duoInfluence;
                allyMetaContextRating += contextRatings.meta * duoInfluence;
                if (roleProbability === 0) continue;

                const availableResults = results.filter(
                    ({ available }) => available,
                );
                const allyFit = getAllyBlindability(
                    availableResults.map(({ result, metaWeight }) => ({
                        games: result.games,
                        wins: result.wins,
                        weight: metaWeight,
                    })),
                    getPrior("ally", role, teammateRole),
                    priorGames,
                );
                synergyGap += allyFit.gap * roleProbability * duoInfluence;
                synergyScore += allyFit.score * roleProbability * duoInfluence;
                synergyInteractions.push(
                    ...availableResults.map(({ result, metaWeight }) => ({
                        games: result.games,
                        weight: metaWeight * roleProbability * duoInfluence,
                    })),
                );
            }

            let matchupGap = 0;
            let matchupScore = 0;
            let counterExposure = 0;
            let counterExposureBaseline = 0;
            let hardCounterRate = 0;
            let counterExposureWeight = 0;
            let enemyObservedContextRating = 0;
            let enemyMetaContextRating = 0;
            const matchupInteractions: { games: number; weight: number }[] = [];
            for (const opponentRole of ROLES) {
                const matchupRoleWeight =
                    getMatchupInteractionWeight(role, opponentRole) *
                    matchupInfluence;
                const roleProbability =
                    enemyOpenRoleProbability[opponentRole] *
                    getBlindMatchupInteractionWeight(role, opponentRole) *
                    matchupInfluence;
                const futurePicks = getFuturePicks("enemy", opponentRole);
                const possibleOpponents = eligibleChampionsByRole[
                    opponentRole
                ].filter((opponent) => opponent.championKey !== championKey);
                const availableOpponents = possibleOpponents.filter(
                    ({ championKey: opponentKey }) =>
                        !unavailableChampions.has(opponentKey),
                );
                const availableOpponentKeys = new Set(
                    availableOpponents.map(({ championKey }) => championKey),
                );
                const results = possibleOpponents.map((opponent) => ({
                    result: getMatchupResult(
                        championKey,
                        role,
                        opponent.championKey,
                        opponentRole,
                    ),
                    metaWeight: futurePicks.get(opponent.championKey) ?? 0,
                    coverageWeight: opponent.pickWeight,
                    available: availableOpponentKeys.has(opponent.championKey),
                }));
                const contextRatings = getContextRatings(
                    results.map(
                        ({
                            result,
                            metaWeight,
                            coverageWeight,
                            available,
                        }) => ({
                            rating: result.rating,
                            games: result.games,
                            metaWeight,
                            coverageWeight,
                            available,
                        }),
                    ),
                    priorGames,
                    enemyOpenRoleProbability[opponentRole],
                );
                enemyObservedContextRating +=
                    contextRatings.observed * matchupRoleWeight;
                enemyMetaContextRating +=
                    contextRatings.meta * matchupRoleWeight;
                if (roleProbability === 0) continue;

                const resultByChampion = new Map(
                    results.map((result) => [
                        result.result.championKeyB,
                        result.result,
                    ]),
                );
                const availableResults = availableOpponents.map((opponent) => ({
                    result: resultByChampion.get(opponent.championKey)!,
                    weight: futurePicks.get(opponent.championKey) ?? 0,
                }));
                const weightedInteractions = availableResults.map(
                    ({ result, weight }) => ({
                        games: result.games,
                        wins: result.wins,
                        weight,
                    }),
                );
                const prior = getPrior("enemy", role, opponentRole);
                const matchupDistribution = getAllyBlindability(
                    weightedInteractions,
                    prior,
                    priorGames,
                );
                const counterExposureResult = getCounterBlindability(
                    weightedInteractions,
                    prior,
                    priorGames,
                );
                matchupGap += matchupDistribution.gap * roleProbability;
                matchupScore += counterExposureResult.score * roleProbability;
                counterExposure +=
                    counterExposureResult.counterExposure * roleProbability;
                counterExposureBaseline +=
                    counterExposureResult.baselineExposure * roleProbability;
                hardCounterRate +=
                    counterExposureResult.hardCounterRate * roleProbability;
                counterExposureWeight += roleProbability;
                matchupInteractions.push(
                    ...availableResults.map(({ result, weight }) => ({
                        games: result.games,
                        weight: weight * roleProbability,
                    })),
                );
            }
            if (counterExposureWeight > 0) {
                counterExposure /= counterExposureWeight;
                counterExposureBaseline /= counterExposureWeight;
                hardCounterRate /= counterExposureWeight;
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
                                role,
                            ),
                            weight: teamProbability * enemyProbability,
                        };
                    }),
            );
            const draftResult = aggregateDraftResults(draftResults);
            const compositionPickWeight = getStats(
                synergyMatchupDataset,
                championKey,
                role,
            ).games;
            const compositionCoverage = Object.fromEntries(
                COMPOSITION_DIMENSIONS.map((dimension) => [dimension, 0]),
            ) as CompositionCoverage;
            let compositionScore = 0;
            let compositionStageWeight = 0;
            let hasCompositionProfiles = true;
            const enemyResponsePressures: EnemyCompositionPressures = {
                frontline: 0,
                engage: 0,
                peel: 0,
                waveclear: 0,
            };
            let enemyResponseScore = 0;
            let enemyResponseStageWeight = 0;
            let hasEnemyResponseProfiles = true;

            for (const [team, teamProbability] of compatibleTeamComps) {
                const teamWithSuggestion = new Map(team);
                teamWithSuggestion.set(role, championKey);
                const composition = getTeamCompositionScore(
                    dataset,
                    teamWithSuggestion,
                );

                hasCompositionProfiles &&= composition.hasProfiles;
                compositionScore += composition.score * teamProbability;
                compositionStageWeight +=
                    getCompositionStageWeight(team.size) * teamProbability;
                for (const dimension of COMPOSITION_DIMENSIONS) {
                    compositionCoverage[dimension] +=
                        composition.coverage[dimension] * teamProbability;
                }

                for (const enemyResult of enemyCompositionScores) {
                    const response = getEnemyResponseScore(
                        composition,
                        enemyResult.composition,
                    );
                    const responseProbability =
                        teamProbability * enemyResult.probability;

                    hasEnemyResponseProfiles &&=
                        composition.hasProfiles &&
                        enemyResult.composition.hasProfiles;
                    enemyResponseScore += response.score * responseProbability;
                    enemyResponseStageWeight +=
                        getEnemyCompositionStageWeight(enemyResult.enemy.size) *
                        responseProbability;
                    for (const pressure of Object.keys(
                        enemyResponsePressures,
                    ) as (keyof EnemyCompositionPressures)[]) {
                        enemyResponsePressures[pressure] +=
                            response.pressures[pressure] * responseProbability;
                    }
                }
            }

            rawSuggestions.push({
                championKey,
                role,
                draftResult,
                allyObservedContextRating,
                allyMetaContextRating,
                enemyObservedContextRating,
                enemyMetaContextRating,
                synergyGap,
                matchupGap,
                counterExposure,
                counterExposureBaseline,
                hardCounterRate,
                synergyScore,
                matchupScore,
                synergyConfidence,
                matchupConfidence,
                compositionCoverage,
                compositionPickWeight,
                compositionScore,
                compositionStageWeight,
                hasCompositionProfiles,
                enemyResponsePressures,
                enemyResponseScore,
                enemyResponseStageWeight,
                hasEnemyResponseProfiles,
            });
        }
    }

    const scoreTotalsByRole = new Map<
        Role,
        {
            weightedCompositionScore: number;
            compositionWeight: number;
            weightedEnemyResponseScore: number;
            enemyResponseWeight: number;
        }
    >();

    for (const suggestion of rawSuggestions) {
        if (bannedChampions.has(suggestion.championKey)) continue;
        // Use the independent interaction pool for composition baselines too.
        // Hiding recommendations must not change scores for the visible picks.
        if (
            !isEligibleInRole(
                synergyMatchupDataset,
                suggestion.championKey,
                suggestion.role,
                INTERACTION_MIN_GAMES,
            )
        )
            continue;

        const totals = scoreTotalsByRole.get(suggestion.role) ?? {
            weightedCompositionScore: 0,
            compositionWeight: 0,
            weightedEnemyResponseScore: 0,
            enemyResponseWeight: 0,
        };
        if (
            suggestion.hasCompositionProfiles &&
            Number.isFinite(suggestion.compositionPickWeight) &&
            suggestion.compositionPickWeight > 0
        ) {
            totals.weightedCompositionScore +=
                suggestion.compositionScore * suggestion.compositionPickWeight;
            totals.compositionWeight += suggestion.compositionPickWeight;
        }
        if (
            suggestion.hasEnemyResponseProfiles &&
            Number.isFinite(suggestion.compositionPickWeight) &&
            suggestion.compositionPickWeight > 0
        ) {
            totals.weightedEnemyResponseScore +=
                suggestion.enemyResponseScore *
                suggestion.compositionPickWeight;
            totals.enemyResponseWeight += suggestion.compositionPickWeight;
        }
        scoreTotalsByRole.set(suggestion.role, totals);
    }

    const suggestions = rawSuggestions.map<Suggestion>((suggestion) => {
        // The base win rate describes the contexts in which players actually
        // selected this champion. Re-center every interaction family from that
        // observed mix to the draft-conditioned mix for slots that remain open.
        // Once a slot is revealed, analyzeDraft supplies its direct interaction
        // and only the observed-context centering remains. Each role's context
        // contrast is already reduced according to its data coverage.
        const contextWeight = getContextWeight(config.contextInfluence);
        const rawContextRating =
            suggestion.allyMetaContextRating -
            suggestion.allyObservedContextRating +
            suggestion.enemyMetaContextRating -
            suggestion.enemyObservedContextRating;
        const contextRating =
            contextWeight === 0 ? 0 : rawContextRating * contextWeight;
        const contextAdjustedRating =
            winrateToRating(suggestion.draftResult.winrate) + contextRating;
        const contextAdjustedWinrate = ratingToWinrate(contextAdjustedRating);
        // Blind scores already compare uncertainty-aware interactions with
        // their shared role-pair priors. Centering again on observed candidates
        // would turn missing evidence back into a relative safety bonus.
        const roleTotals = scoreTotalsByRole.get(suggestion.role);
        const synergyRating = suggestion.synergyScore;
        const matchupRating = suggestion.matchupScore;
        const enemySafetyShare = getWeight(config.enemySafetyPriority);
        const allyFitShare = 1 - enemySafetyShare;
        // Multiplying both shares by two preserves the previous total scale at
        // 50/50 while allowing solo-queue users to prioritize enemy safety.
        const rating =
            (synergyRating * allyFitShare * 2 +
                matchupRating * enemySafetyShare * 2) *
            getWeight(config.blindabilityWeight);
        const adjustedRating = contextAdjustedRating + rating;
        const blindabilityAdjustedWinrate = ratingToWinrate(adjustedRating);
        // Composition and enemy-response scores use the same viable, recent
        // role pool, but are centered separately to preserve their scales.
        const meanCompositionScore = roleTotals?.compositionWeight
            ? roleTotals.weightedCompositionScore / roleTotals.compositionWeight
            : suggestion.compositionScore;
        const centeredCompositionScore = suggestion.hasCompositionProfiles
            ? suggestion.compositionScore - meanCompositionScore
            : 0;
        const compositionWinrateDelta = getCompositionWinrateDelta(
            centeredCompositionScore,
            config.compositionInfluence,
            suggestion.compositionStageWeight,
        );
        const meanEnemyResponseScore = roleTotals?.enemyResponseWeight
            ? roleTotals.weightedEnemyResponseScore /
              roleTotals.enemyResponseWeight
            : suggestion.enemyResponseScore;
        const centeredEnemyResponseScore = suggestion.hasEnemyResponseProfiles
            ? suggestion.enemyResponseScore - meanEnemyResponseScore
            : 0;
        const enemyResponseWinrateDelta = getEnemyResponseWinrateDelta(
            centeredEnemyResponseScore,
            config.compositionInfluence,
            suggestion.enemyResponseStageWeight,
        );
        const finalCompositionWinrateDelta = combineCompositionWinrateDeltas(
            compositionWinrateDelta,
            enemyResponseWinrateDelta,
            config.compositionInfluence,
        );
        const finalAdjustedWinrate = clamp(
            blindabilityAdjustedWinrate + finalCompositionWinrateDelta,
            Number.EPSILON,
            1 - Number.EPSILON,
        );
        const finalAdjustedRating = winrateToRating(finalAdjustedWinrate);

        return {
            championKey: suggestion.championKey,
            role: suggestion.role,
            draftResult: suggestion.draftResult,
            contextResult: {
                allyObservedRating: suggestion.allyObservedContextRating,
                allyMetaRating: suggestion.allyMetaContextRating,
                enemyObservedRating: suggestion.enemyObservedContextRating,
                enemyMetaRating: suggestion.enemyMetaContextRating,
                rating: contextRating,
                adjustedRating: contextAdjustedRating,
                adjustedWinrate: contextAdjustedWinrate,
            },
            blindabilityResult: {
                synergyGap: suggestion.synergyGap,
                matchupGap: suggestion.matchupGap,
                counterExposure: suggestion.counterExposure,
                counterExposureBaseline: suggestion.counterExposureBaseline,
                hardCounterRate: suggestion.hardCounterRate,
                synergyScore: suggestion.synergyScore,
                matchupScore: suggestion.matchupScore,
                synergyConfidence: suggestion.synergyConfidence,
                matchupConfidence: suggestion.matchupConfidence,
                rating,
                adjustedRating,
                adjustedWinrate: blindabilityAdjustedWinrate,
            },
            compositionResult: {
                coverage: suggestion.compositionCoverage,
                rawScore: suggestion.compositionScore,
                centeredScore: centeredCompositionScore,
                stageWeight: suggestion.compositionStageWeight,
                alliedWinrateDelta: compositionWinrateDelta,
                enemyResponse: {
                    pressures: suggestion.enemyResponsePressures,
                    rawScore: suggestion.enemyResponseScore,
                    centeredScore: centeredEnemyResponseScore,
                    stageWeight: suggestion.enemyResponseStageWeight,
                    winrateDelta: enemyResponseWinrateDelta,
                },
                rating: finalAdjustedRating - adjustedRating,
                winrateDelta: finalCompositionWinrateDelta,
            },
            adjustedRating: finalAdjustedRating,
            adjustedWinrate: finalAdjustedWinrate,
        };
    });

    return suggestions
        .filter((suggestion) =>
            isEligibleInRole(
                synergyMatchupDataset,
                suggestion.championKey,
                suggestion.role,
                config.minGames,
            ),
        )
        .sort((a, b) => b.adjustedWinrate - a.adjustedWinrate);
}
