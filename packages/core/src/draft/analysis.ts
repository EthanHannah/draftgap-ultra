import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { Dataset } from "../models/dataset/Dataset";
import { DEFAULT_ROLE_WEIGHTS, Role, RoleWeights } from "../models/Role";
import { winrateToRating, ratingToWinrate } from "../rating/ratings";
import { RiskLevel, priorGamesByRiskLevel } from "../risk/risk-level";
import { addStats, averageStats } from "../stats";
import { getStats } from "./utils";

export type DraftResult = {
    allyChampionRating: AnalyzeChampionsResult;
    enemyChampionRating: AnalyzeChampionsResult;
    allyDuoRating: AnalyzeDuosResult;
    enemyDuoRating: AnalyzeDuosResult;
    matchupRating: AnalyzeMatchupsResult;

    totalRating: number;
    winrate: number;
};

export type WeightedTeamComp = [Map<Role, string>, number];

export function normalizeTeamComps(teamComps: WeightedTeamComp[]) {
    const validTeamComps = teamComps.filter(
        ([, probability]) => Number.isFinite(probability) && probability > 0,
    );
    if (validTeamComps.length === 0) {
        if (teamComps.length === 0) {
            return [[new Map<Role, string>(), 1]] satisfies WeightedTeamComp[];
        }

        return teamComps.map(
            ([teamComp]) =>
                [teamComp, 1 / teamComps.length] as WeightedTeamComp,
        );
    }

    const totalProbability = validTeamComps.reduce(
        (total, [, probability]) => total + probability,
        0,
    );

    return validTeamComps.map(
        ([teamComp, probability]) =>
            [teamComp, probability / totalProbability] as WeightedTeamComp,
    );
}

export type WeightedDraftResult = {
    result: DraftResult;
    weight: number;
};

function mostLikelyValue<T>(weights: Map<T, number>) {
    return [...weights.entries()].reduce((best, entry) =>
        entry[1] > best[1] ? entry : best,
    )[0];
}

export function aggregateDraftResults(results: WeightedDraftResult[]) {
    const totalWeight = results.reduce(
        (total, { weight }) => total + weight,
        0,
    );
    if (totalWeight === 0) {
        return {
            allyChampionRating: { championResults: [], totalRating: 0 },
            enemyChampionRating: { championResults: [], totalRating: 0 },
            allyDuoRating: { duoResults: [], totalRating: 0 },
            enemyDuoRating: { duoResults: [], totalRating: 0 },
            matchupRating: { matchupResults: [], totalRating: 0 },
            totalRating: 0,
            winrate: 0.5,
        } satisfies DraftResult;
    }

    const normalizedResults = results.map(({ result, weight }) => ({
        result,
        weight: weight / totalWeight,
    }));

    const aggregateChampions = (
        getResults: (result: DraftResult) => AnalyzeChampionsResult,
    ) => {
        const byChampion = new Map<
            string,
            AnalyzeChampionResult & { roleWeights: Map<Role, number> }
        >();

        for (const { result, weight } of normalizedResults) {
            for (const champion of getResults(result).championResults) {
                const aggregate = byChampion.get(champion.championKey) ?? {
                    ...champion,
                    rating: 0,
                    wins: 0,
                    games: 0,
                    roleWeights: new Map<Role, number>(),
                };
                aggregate.rating += champion.rating * weight;
                aggregate.wins += champion.wins * weight;
                aggregate.games += champion.games * weight;
                aggregate.roleWeights.set(
                    champion.role,
                    (aggregate.roleWeights.get(champion.role) ?? 0) + weight,
                );
                byChampion.set(champion.championKey, aggregate);
            }
        }

        return {
            championResults: [...byChampion.values()].map(
                ({ roleWeights, ...champion }) => ({
                    ...champion,
                    role: mostLikelyValue(roleWeights),
                }),
            ),
            totalRating: normalizedResults.reduce(
                (total, { result, weight }) =>
                    total + getResults(result).totalRating * weight,
                0,
            ),
        };
    };

    const aggregateDuos = (
        getResults: (result: DraftResult) => AnalyzeDuosResult,
    ) => {
        const byDuo = new Map<
            string,
            AnalyzeDuoResult & { roleWeights: Map<string, number> }
        >();

        for (const { result, weight } of normalizedResults) {
            for (const rawDuo of getResults(result).duoResults) {
                const reverse = rawDuo.championKeyA > rawDuo.championKeyB;
                const duo = reverse
                    ? {
                          ...rawDuo,
                          roleA: rawDuo.roleB,
                          championKeyA: rawDuo.championKeyB,
                          roleB: rawDuo.roleA,
                          championKeyB: rawDuo.championKeyA,
                      }
                    : rawDuo;
                const key = `${duo.championKeyA}:${duo.championKeyB}`;
                const aggregate = byDuo.get(key) ?? {
                    ...duo,
                    rating: 0,
                    wins: 0,
                    games: 0,
                    roleWeights: new Map<string, number>(),
                };
                aggregate.rating += duo.rating * weight;
                aggregate.wins += duo.wins * weight;
                aggregate.games += duo.games * weight;
                const roleKey = `${duo.roleA}:${duo.roleB}`;
                aggregate.roleWeights.set(
                    roleKey,
                    (aggregate.roleWeights.get(roleKey) ?? 0) + weight,
                );
                byDuo.set(key, aggregate);
            }
        }

        return {
            duoResults: [...byDuo.values()].map(
                ({ roleWeights, ...duo }) => {
                    const [roleA, roleB] = mostLikelyValue(roleWeights)
                        .split(":")
                        .map(Number) as [Role, Role];
                    return { ...duo, roleA, roleB };
                },
            ),
            totalRating: normalizedResults.reduce(
                (total, { result, weight }) =>
                    total + getResults(result).totalRating * weight,
                0,
            ),
        };
    };

    const byMatchup = new Map<
        string,
        AnalyzeMatchupResult & { roleWeights: Map<string, number> }
    >();
    for (const { result, weight } of normalizedResults) {
        for (const matchup of result.matchupRating.matchupResults) {
            const key = `${matchup.championKeyA}:${matchup.championKeyB}`;
            const aggregate = byMatchup.get(key) ?? {
                ...matchup,
                rating: 0,
                wins: 0,
                games: 0,
                roleWeights: new Map<string, number>(),
            };
            aggregate.rating += matchup.rating * weight;
            aggregate.wins += matchup.wins * weight;
            aggregate.games += matchup.games * weight;
            const roleKey = `${matchup.roleA}:${matchup.roleB}`;
            aggregate.roleWeights.set(
                roleKey,
                (aggregate.roleWeights.get(roleKey) ?? 0) + weight,
            );
            byMatchup.set(key, aggregate);
        }
    }

    const allyChampionRating = aggregateChampions(
        (result) => result.allyChampionRating,
    );
    const enemyChampionRating = aggregateChampions(
        (result) => result.enemyChampionRating,
    );
    const allyDuoRating = aggregateDuos((result) => result.allyDuoRating);
    const enemyDuoRating = aggregateDuos((result) => result.enemyDuoRating);
    const matchupRating = {
        matchupResults: [...byMatchup.values()].map(
            ({ roleWeights, ...matchup }) => {
                const [roleA, roleB] = mostLikelyValue(roleWeights)
                    .split(":")
                    .map(Number) as [Role, Role];
                return { ...matchup, roleA, roleB };
            },
        ),
        totalRating: normalizedResults.reduce(
            (total, { result, weight }) =>
                total + result.matchupRating.totalRating * weight,
            0,
        ),
    };
    const totalRating = normalizedResults.reduce(
        (total, { result, weight }) => total + result.totalRating * weight,
        0,
    );
    const winrate = normalizedResults.reduce(
        (total, { result, weight }) => total + result.winrate * weight,
        0,
    );

    return {
        allyChampionRating,
        enemyChampionRating,
        allyDuoRating,
        enemyDuoRating,
        matchupRating,
        totalRating,
        winrate,
    };
}

export interface AnalyzeDraftConfig {
    championWinrateInfluence: number;
    riskLevel: RiskLevel;
    minGames: number;
    matchupRoleWeights: RoleWeights;
    duoRoleWeights: RoleWeights;
}

export function getDuoInteractionWeight(
    roleWeights: RoleWeights,
    roleA: Role,
    roleB: Role,
) {
    if (roleWeights[roleA] === 0 || roleWeights[roleB] === 0) return 0;

    return (roleWeights[roleA] + roleWeights[roleB]) / 200;
}

export function getMatchupInteractionWeight(
    roleWeights: RoleWeights,
    enemyRole: Role,
) {
    return roleWeights[enemyRole] / 100;
}

export function analyzeDraft(
    dataset: Dataset,
    fullDataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    config: AnalyzeDraftConfig,
): DraftResult {
    const priorGames = priorGamesByRiskLevel[config.riskLevel];

    const allyChampionRating = analyzeChampions(
        dataset,
        fullDataset,
        team,
        priorGames,
        config.championWinrateInfluence,
    );
    const enemyChampionRating = analyzeChampions(
        dataset,
        fullDataset,
        enemy,
        priorGames,
        config.championWinrateInfluence,
    );

    const allyDuoRating = analyzeDuos(
        fullDataset,
        team,
        priorGames,
        config.duoRoleWeights,
    );
    const enemyDuoRating = analyzeDuos(
        fullDataset,
        enemy,
        priorGames,
        config.duoRoleWeights,
    );
    const matchupRating = analyzeMatchups(
        fullDataset,
        team,
        enemy,
        priorGames,
        config.matchupRoleWeights,
    );

    const totalRating =
        allyChampionRating.totalRating +
        allyDuoRating.totalRating +
        matchupRating.totalRating -
        enemyChampionRating.totalRating -
        enemyDuoRating.totalRating;

    const winrate = ratingToWinrate(totalRating);

    return {
        allyChampionRating,
        enemyChampionRating,
        allyDuoRating,
        enemyDuoRating,
        matchupRating,
        totalRating,
        winrate,
    };
}

export function analyzeDraftWithRoleUncertainty(
    dataset: Dataset,
    fullDataset: Dataset,
    teamComps: WeightedTeamComp[],
    enemyComps: WeightedTeamComp[],
    config: AnalyzeDraftConfig,
) {
    const normalizedTeamComps = normalizeTeamComps(teamComps);
    const normalizedEnemyComps = normalizeTeamComps(enemyComps);
    const results: WeightedDraftResult[] = [];

    for (const [team, teamProbability] of normalizedTeamComps) {
        for (const [enemy, enemyProbability] of normalizedEnemyComps) {
            results.push({
                result: analyzeDraft(dataset, fullDataset, team, enemy, config),
                weight: teamProbability * enemyProbability,
            });
        }
    }

    return aggregateDraftResults(results);
}

export type AnalyzeChampionResult = {
    role: Role;
    championKey: string;
    rating: number;
    wins: number;
    games: number;
};

export type AnalyzeChampionsResult = {
    championResults: AnalyzeChampionResult[];
    totalRating: number;
};

export function analyzeChampions(
    dataset: Dataset,
    synergyMatchupDataset: Dataset,
    team: Map<Role, string>,
    priorGames: number,
    championWinrateInfluence = 100,
): AnalyzeChampionsResult {
    const championResults: AnalyzeChampionResult[] = [];
    let totalRating = 0;
    const influence =
        Math.min(100, Math.max(0, championWinrateInfluence)) / 100;

    for (const [role, championKey] of team) {
        const championResult = analyzeChampion(
            dataset,
            synergyMatchupDataset,
            role,
            championKey,
            priorGames,
        );

        const weightedChampionResult = {
            ...championResult,
            rating: championResult.rating * influence,
        };

        championResults.push(weightedChampionResult);
        totalRating += weightedChampionResult.rating;
    }

    return {
        championResults,
        totalRating,
    };
}

export function analyzeChampion(
    dataset: Dataset,
    fullDataset: Dataset,
    role: Role,
    championKey: string,
    priorGames: number,
) {
    // Get stats for this patch
    const championData = dataset.championData[championKey];
    const roleData = championData.statsByRole[role];

    // Get stats for the full dataset (30days)
    const fullChampionData = fullDataset.championData[championKey] ?? {
        ...championData,
        statsByRole: {
            0: defaultChampionRoleData(),
            1: defaultChampionRoleData(),
            2: defaultChampionRoleData(),
            3: defaultChampionRoleData(),
            4: defaultChampionRoleData(),
        },
    };
    const fullChampionRoleData = fullChampionData.statsByRole[role];
    const fullChampionRoleWinrate =
        fullChampionRoleData.games === 0
            ? 0.5
            : fullChampionRoleData.wins / fullChampionRoleData.games;

    const stats = addStats(
        {
            wins: roleData.wins,
            games: roleData.games,
        },
        // Scale prior stats by winrate of expected rating, as we expect the champion to have a similar winrate to the expected rating
        // We estimate the expected rating to be the rank winrate
        {
            wins: priorGames * fullChampionRoleWinrate,
            games: priorGames,
        },
        // TOOD: if 30 days has no games, add other prior games
    );

    const rating = winrateToRating(stats.wins / stats.games);

    return {
        role,
        championKey,
        rating,
        wins: roleData.wins,
        games: roleData.games,
    };
}

export type AnalyzeDuoResult = {
    roleA: Role;
    championKeyA: string;
    roleB: Role;
    championKeyB: string;
    rating: number;
    wins: number;
    games: number;
};

export type AnalyzeDuosResult = {
    duoResults: AnalyzeDuoResult[];
    totalRating: number;
};

export function analyzeDuos(
    dataset: Dataset,
    team: Map<Role, string>,
    priorGames: number,
    roleWeights: RoleWeights = DEFAULT_ROLE_WEIGHTS,
): AnalyzeDuosResult {
    const teamEntries = Array.from(team.entries()).sort((a, b) => a[0] - b[0]);

    const duoResults: AnalyzeDuoResult[] = [];
    let totalRating = 0;

    for (let i = 0; i < teamEntries.length; i++) {
        for (let j = i + 1; j < teamEntries.length; j++) {
            const [role, championKey] = teamEntries[i];
            const [role2, championKey2] = teamEntries[j];
            const duoResult = analyzeDuo(
                dataset,
                role,
                championKey,
                role2,
                championKey2,
                priorGames,
                roleWeights,
            );

            duoResults.push(duoResult);
            totalRating += duoResult.rating;
        }
    }

    return {
        duoResults,
        totalRating,
    };
}

export function analyzeDuo(
    dataset: Dataset,
    roleA: Role,
    championKeyA: string,
    roleB: Role,
    championKeyB: string,
    priorGames: number,
    roleWeights: RoleWeights = DEFAULT_ROLE_WEIGHTS,
): AnalyzeDuoResult {
    const roleStats = getStats(dataset, championKeyA, roleA);
    const champion2RoleStats = getStats(dataset, championKeyB, roleB);
    const expectedRating =
        winrateToRating(
            roleStats.games === 0 ? 0.5 : roleStats.wins / roleStats.games,
        ) +
        winrateToRating(
            champion2RoleStats.games === 0
                ? 0.5
                : champion2RoleStats.wins / champion2RoleStats.games,
        );
    const expectedWinrate = ratingToWinrate(expectedRating);

    const duoStats = getStats(
        dataset,
        championKeyA,
        roleA,
        "duo",
        roleB,
        championKeyB,
    );
    const champion2DuoStats = getStats(
        dataset,
        championKeyB,
        roleB,
        "duo",
        roleA,
        championKeyA,
    );
    const combinedStats = averageStats(duoStats, champion2DuoStats);

    const adjustedStats = addStats(combinedStats, {
        wins: priorGames * expectedWinrate,
        games: priorGames,
    });
    const winrate = adjustedStats.wins / adjustedStats.games;

    const actualRating = winrateToRating(winrate);
    const rating =
        (actualRating - expectedRating) *
        getDuoInteractionWeight(roleWeights, roleA, roleB);

    return {
        roleA,
        championKeyA,
        roleB,
        championKeyB,
        rating,
        wins:
            combinedStats.games === 0
                ? 0
                : ratingToWinrate(
                      winrateToRating(
                          combinedStats.wins / combinedStats.games,
                      ) - expectedRating,
                  ) * combinedStats.games,
        games: combinedStats.games,
    };
}

export type AnalyzeMatchupResult = {
    roleA: Role;
    championKeyA: string;
    roleB: Role;
    championKeyB: string;
    rating: number;
    wins: number;
    games: number;
};

export type AnalyzeMatchupsResult = {
    matchupResults: AnalyzeMatchupResult[];
    totalRating: number;
};

export function analyzeMatchups(
    dataset: Dataset,
    team: Map<Role, string>,
    enemy: Map<Role, string>,
    priorGames: number,
    roleWeights: RoleWeights = DEFAULT_ROLE_WEIGHTS,
): AnalyzeMatchupsResult {
    const matchupResults: AnalyzeMatchupResult[] = [];
    let totalRating = 0;

    for (const [allyRole, allyChampionKey] of team) {
        for (const [enemyRole, enemyChampionKey] of enemy) {
            const matchupResult = analyzeMatchup(
                dataset,
                allyRole,
                allyChampionKey,
                enemyRole,
                enemyChampionKey,
                priorGames,
                roleWeights,
            );

            matchupResults.push(matchupResult);
            totalRating += matchupResult.rating;
        }
    }

    return {
        matchupResults,
        totalRating,
    };
}

export function analyzeMatchup(
    dataset: Dataset,
    allyRole: Role,
    allyChampionKey: string,
    enemyRole: Role,
    enemyChampionKey: string,
    priorGames: number,
    roleWeights: RoleWeights = DEFAULT_ROLE_WEIGHTS,
): AnalyzeMatchupResult {
    const roleStats = getStats(dataset, allyChampionKey, allyRole);
    const enemyRoleStats = getStats(dataset, enemyChampionKey, enemyRole);

    const expectedRating =
        winrateToRating(
            roleStats.games === 0 ? 0.5 : roleStats.wins / roleStats.games,
        ) -
        winrateToRating(
            enemyRoleStats.games === 0
                ? 0.5
                : enemyRoleStats.wins / enemyRoleStats.games,
        );
    const expectedWinrate = ratingToWinrate(expectedRating);

    const matchupStats = getStats(
        dataset,
        allyChampionKey,
        allyRole,
        "matchup",
        enemyRole,
        enemyChampionKey,
    );
    const enemyMatchupStats = getStats(
        dataset,
        enemyChampionKey,
        enemyRole,
        "matchup",
        allyRole,
        allyChampionKey,
    );
    const enemyLosses = enemyMatchupStats.games - enemyMatchupStats.wins;

    const wins = (matchupStats.wins + enemyLosses) / 2;
    const games = (matchupStats.games + enemyMatchupStats.games) / 2;

    const adjustedStats = addStats(
        {
            wins,
            games,
        },
        {
            wins: priorGames * expectedWinrate,
            games: priorGames,
        },
    );
    const winrate = adjustedStats.wins / adjustedStats.games;

    const actualRating = winrateToRating(winrate);
    const rating =
        (actualRating - expectedRating) *
        getMatchupInteractionWeight(roleWeights, enemyRole);

    return {
        roleA: allyRole,
        championKeyA: allyChampionKey,
        roleB: enemyRole,
        championKeyB: enemyChampionKey,
        rating,
        wins:
            games === 0
                ? 0
                : ratingToWinrate(
                      winrateToRating(wins / games) - expectedRating,
                  ) * games,
        games,
    };
}
