import { AnalyzeDraftConfig } from "../draft/analysis";
import { Role } from "../models/Role";
import {
    PartialBuildDataset,
    FullBuildDataset,
    BuildMatchupData,
} from "../models/build/BuildDataset";
import { ratingToWinrate, winrateToRating } from "../rating/ratings";
import { buildPriorGamesByRiskLevel } from "../risk/risk-level";
import { addStats } from "../stats";

export type EntityAnalysisResult = {
    baseResult: BaseEntityAnalysisResult;
    matchupResult: EntityMatchupsAnalysisResult;
    totalRating: number;
};

export type BaseEntityAnalysisResult = {
    rating: number;
};

export type EntityMatchupAnalysisResult = {
    championKey: string;
    role: Role;
    rating: number;
    wins: number;
    games: number;
};

export type EntityMatchupsAnalysisResult = {
    matchupResults: EntityMatchupAnalysisResult[];
    totalRating: number;
};

export type EntityStats = {
    wins: number;
    games: number;
};

export type EntityStatsGetter<T> = (
    dataset: PartialBuildDataset,
    entity: T,
) => EntityStats | undefined;

function getWinrate(stats: EntityStats | undefined, fallback: number) {
    if (!stats || stats.games <= 0) return fallback;
    // A finite rating is needed even for tiny samples with zero losses or wins.
    return Math.min(1 - 1e-6, Math.max(1e-6, stats.wins / stats.games));
}

export function analyzeEntity<T>(
    partialBuildDataset: PartialBuildDataset,
    fullBuildDataset: FullBuildDataset,
    config: AnalyzeDraftConfig,
    getStats: EntityStatsGetter<T>,
    entity: T,
) {
    const baseResult = analyzeBaseEntity(
        partialBuildDataset,
        fullBuildDataset,
        config,
        getStats,
        entity,
    );
    const matchupResult = analyzeEntityMatchups(
        partialBuildDataset,
        fullBuildDataset,
        config,
        getStats,
        entity,
    );

    const totalRating = baseResult.rating + matchupResult.totalRating;

    return {
        baseResult,
        matchupResult,
        totalRating,
    };
}

export function analyzeBaseEntity<T>(
    partialBuildDataset: PartialBuildDataset,
    fullBuildDataset: FullBuildDataset,
    config: AnalyzeDraftConfig,
    getStats: EntityStatsGetter<T>,
    entity: T,
) {
    const priorGames = buildPriorGamesByRiskLevel[config.riskLevel];

    const championWinrate = getWinrate(partialBuildDataset, 0.5);

    const previousEntityStats = getStats(fullBuildDataset, entity);
    const previousEntityWinrate = getWinrate(
        previousEntityStats,
        championWinrate,
    );
    const currentEntityStats = getStats(partialBuildDataset, entity) ?? {
        wins: 0,
        games: 0,
    };

    const entityStats = addStats(currentEntityStats, {
        wins: priorGames * previousEntityWinrate,
        games: priorGames,
    });
    const entityWinrate = getWinrate(entityStats, championWinrate);
    const entityRating = winrateToRating(entityWinrate);

    const rating = entityRating - winrateToRating(championWinrate);

    return {
        rating,
    };
}

export function analyzeEntityMatchups<T>(
    partialBuildDataset: PartialBuildDataset,
    fullBuildDataset: FullBuildDataset,
    config: AnalyzeDraftConfig,
    getStats: EntityStatsGetter<T>,
    entity: T,
) {
    const matchupResults = fullBuildDataset.matchups.map((m) =>
        analyzeEntityMatchup(
            partialBuildDataset,
            fullBuildDataset,
            config,
            getStats,
            entity,
            m,
        ),
    );

    const totalRating = matchupResults.reduce(
        (total, r) => total + r.rating,
        0,
    );

    return {
        matchupResults,
        totalRating,
    };
}

export function analyzeEntityMatchup<T>(
    _partialBuildDataset: PartialBuildDataset,
    fullBuildDataset: FullBuildDataset,
    config: AnalyzeDraftConfig,
    getStats: EntityStatsGetter<T>,
    entity: T,
    matchup: BuildMatchupData,
) {
    const priorGames = buildPriorGamesByRiskLevel[config.riskLevel];

    // Calculate entity rating
    const championWinrate = getWinrate(fullBuildDataset, 0.5);
    const championWithEntityStats = getStats(fullBuildDataset, entity);
    const championWithEntityWinrate = getWinrate(
        championWithEntityStats,
        championWinrate,
    );

    const entityRating =
        winrateToRating(championWithEntityWinrate) -
        winrateToRating(championWinrate);

    // Calculate entity rating in matchup
    const matchupWinrate = getWinrate(matchup, championWinrate);
    const matchupRating = winrateToRating(matchupWinrate);
    const expectedWithEntityMatchupRating = matchupRating + entityRating;
    const expectedWithEntityMatchupWinrate = ratingToWinrate(
        expectedWithEntityMatchupRating,
    );

    const rawMatchupWithEntityStats = getStats(matchup, entity) ?? {
        wins: 0,
        games: 0,
    };

    const matchupWithEntityStats = addStats(rawMatchupWithEntityStats, {
        wins: priorGames * expectedWithEntityMatchupWinrate,
        games: priorGames,
    });
    const matchupWithEntityWinrate = getWinrate(
        matchupWithEntityStats,
        expectedWithEntityMatchupWinrate,
    );
    const matchupWithEntityRating = winrateToRating(matchupWithEntityWinrate);
    const entityRatingInMatchup = matchupWithEntityRating - matchupRating;

    // Calculate final rating
    const rating = entityRatingInMatchup - entityRating;

    return {
        championKey: matchup.championKey,
        role: matchup.role,
        rating: isNaN(rating) ? 0 : rating,
        games: rawMatchupWithEntityStats.games,
        wins:
            ratingToWinrate(
                winrateToRating(
                    getWinrate(
                        rawMatchupWithEntityStats,
                        expectedWithEntityMatchupWinrate,
                    ),
                ) - expectedWithEntityMatchupRating,
            ) * rawMatchupWithEntityStats.games,
        raw: {
            games: rawMatchupWithEntityStats.games,
            wins: rawMatchupWithEntityStats.wins,
        },
        expected: expectedWithEntityMatchupWinrate,
    };
}
