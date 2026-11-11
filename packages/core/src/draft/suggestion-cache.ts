import { Dataset } from "../models/dataset/Dataset";
import { WeightedTeamComp } from "./analysis";
import {
    getSuggestionsWithRoleUncertainty,
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
    // Keyed by draft and every scoring input except the display threshold.
    // Each entry was scored at some minimum-games threshold; it contains every
    // candidate a stricter threshold would show, so stricter requests filter
    // it while looser ones rescore the draft.
    const entries = new Map<
        string,
        { minGames: number; suggestions: Suggestion[] }
    >();

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
        const bannedKeys = [...bans];
        const { minGames, ...scoringConfig } = config;
        const key = JSON.stringify([
            team.map(([comp, weight]) => [[...comp], weight]),
            enemy.map(([comp, weight]) => [[...comp], weight]),
            scoringConfig,
            [...bannedKeys].sort(),
        ]);
        let entry = entries.get(key);
        if (entry && entry.minGames <= minGames) {
            entries.delete(key);
        } else {
            entries.delete(key);
            entry = {
                minGames,
                suggestions: calculate(
                    dataset,
                    interactions,
                    team,
                    enemy,
                    config,
                    bannedKeys,
                ),
            };
        }
        entries.set(key, entry);
        if (entries.size > MAX_CACHED_DRAFTS)
            entries.delete(entries.keys().next().value!);

        // Return a separate array so table sorting cannot mutate the cache.
        return entry.suggestions.filter(
            ({ championKey, role }) =>
                (getStats(interactions, championKey, role).games / 30) * 7 >=
                minGames,
        );
    };
}
