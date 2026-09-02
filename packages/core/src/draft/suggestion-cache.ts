import { Dataset } from "../models/dataset/Dataset";
import { WeightedTeamComp } from "./analysis";
import {
    getSuggestionsWithRoleUncertainty,
    INTERACTION_MIN_GAMES,
    Suggestion,
    SuggestionConfig,
} from "./suggestions";
import { getStats } from "./utils";

const MAX_CACHED_DRAFTS = 4;

// Scoped to a UI session with immutable fetched datasets. Replacing either
// dataset invalidates all entries; config, bans and draft maps are snapshotted
// by value so reactive stores can safely mutate between requests.
export function createSuggestionCache(
    calculate = getSuggestionsWithRoleUncertainty,
) {
    let previousDataset: Dataset | undefined;
    let previousInteractions: Dataset | undefined;
    const entries = new Map<string, Suggestion[]>();

    return (
        dataset: Dataset,
        interactions: Dataset,
        team: WeightedTeamComp[],
        enemy: WeightedTeamComp[],
        config: SuggestionConfig,
        bans: Iterable<string> = [],
    ) => {
        if (
            dataset !== previousDataset ||
            interactions !== previousInteractions
        ) {
            entries.clear();
            previousDataset = dataset;
            previousInteractions = interactions;
        }
        // Calculate all scoring-baseline candidates once. Higher recommendation
        // thresholds then filter cached results without recalculating scores.
        const scoringConfig = {
            ...config,
            minGames: Math.min(config.minGames, INTERACTION_MIN_GAMES),
        };
        const bannedKeys = [...bans];
        const key = JSON.stringify([
            team.map(([comp, weight]) => [[...comp], weight]),
            enemy.map(([comp, weight]) => [[...comp], weight]),
            scoringConfig,
            [...bannedKeys].sort(),
        ]);
        let result = entries.get(key);
        if (result) {
            entries.delete(key);
        } else {
            result = calculate(
                dataset,
                interactions,
                team,
                enemy,
                scoringConfig,
                bannedKeys,
            );
        }
        entries.set(key, result);
        if (entries.size > MAX_CACHED_DRAFTS)
            entries.delete(entries.keys().next().value!);

        // Return a separate array so table sorting cannot mutate the cache.
        return result.filter(
            ({ championKey, role }) =>
                (getStats(interactions, championKey, role).games / 30) * 7 >=
                config.minGames,
        );
    };
}
