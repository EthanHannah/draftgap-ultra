import { Dataset } from "../models/dataset/Dataset";
import { Role } from "../models/Role";
import { winrateToRating } from "../rating/ratings";

// Prior pair-games for the view offset. The two views come from different
// samples, so each aggregate carries binomial noise of roughly 0.25 / games.
// Real offsets are on the order of 0.5%, giving 0.25 / 0.005² = 10,000.
const VIEW_OFFSET_PRIOR_GAMES = 10_000;

type Field = "matchup" | "synergy";

// Per dataset, one map per field and role, keyed by champion. Nested maps
// avoid building a string key on every analyzeMatchup/analyzeDuo call.
type FieldCache = Map<string, number>[];
const cache = new WeakMap<Dataset, Record<Field, FieldCache>>();

// Each interaction appears in two tables: the champion's own row and the other
// champion's row for it. Analysis averages both views, but the champion's own
// win rate only describes the first. In real data the views disagree
// systematically (by up to ~2% for some champions), which would otherwise
// shift every interaction of that champion by the same amount. Returns the
// rating offset that moves the champion's own win rate onto the scale of the
// averaged views, shrunk toward zero when the views have little support.
export function getViewRatingOffset(
    dataset: Dataset,
    championKey: string,
    role: Role,
    field: Field,
) {
    let datasetCache = cache.get(dataset);
    if (!datasetCache) {
        datasetCache = { matchup: [], synergy: [] };
        cache.set(dataset, datasetCache);
    }
    const roleCache = (datasetCache[field][role] ??= new Map());
    const cached = roleCache.get(championKey);
    if (cached !== undefined) return cached;

    const rowsByRole =
        dataset.championData[championKey]?.statsByRole[role]?.[field];
    let ownWins = 0;
    let ownGames = 0;
    let otherWins = 0;
    let otherGames = 0;
    for (const [otherRoleKey, rows] of Object.entries(rowsByRole ?? {})) {
        const otherRole = Number(otherRoleKey) as Role;
        for (const [otherKey, row] of Object.entries(rows ?? {})) {
            const reverse =
                dataset.championData[otherKey]?.statsByRole[otherRole]?.[
                    field
                ]?.[role]?.[championKey];
            if (
                !reverse ||
                !(row.games > 0) ||
                !(reverse.games > 0) ||
                !Number.isFinite(row.wins) ||
                !Number.isFinite(reverse.wins)
            )
                continue;
            ownWins += row.wins;
            ownGames += row.games;
            // Matchup rows record the opponent's wins; synergy rows share them.
            otherWins +=
                field === "matchup"
                    ? reverse.games - reverse.wins
                    : reverse.wins;
            otherGames += reverse.games;
        }
    }

    let offset = 0;
    if (ownGames > 0 && otherGames > 0) {
        const clamp = (winrate: number) =>
            Math.min(1 - 1e-6, Math.max(1e-6, winrate));
        const averaged = clamp((ownWins + otherWins) / (ownGames + otherGames));
        const own = clamp(ownWins / ownGames);
        const support = Math.min(ownGames, otherGames);
        offset =
            (winrateToRating(averaged) - winrateToRating(own)) *
            (support / (support + VIEW_OFFSET_PRIOR_GAMES));
    }
    roleCache.set(championKey, offset);
    return offset;
}
