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
