import { Dataset } from "../models/dataset/Dataset";
import { Role } from "../models/Role";

// Champion-roles below this many games are rare picks: mostly off-role or
// experimental. Pooled together they win well below 50% (about 36-48% in
// recent data, lowest for the rarest), which is the right expectation for a
// champion-role whose own sample is too small to speak for itself.
const RARE_PICK_GAMES = 5000;

const cache = new WeakMap<Dataset, Map<Role, number>>();

export function getRarePickWinrate(dataset: Dataset, role: Role) {
    let datasetCache = cache.get(dataset);
    if (!datasetCache) {
        datasetCache = new Map();
        cache.set(dataset, datasetCache);
    }
    const cached = datasetCache.get(role);
    if (cached !== undefined) return cached;
    let wins = 0;
    let games = 0;
    for (const champion of Object.values(dataset.championData)) {
        const stats = champion.statsByRole[role];
        if (
            !stats ||
            !(stats.games > 0) ||
            stats.games >= RARE_PICK_GAMES ||
            !Number.isFinite(stats.wins)
        )
            continue;
        wins += stats.wins;
        games += stats.games;
    }
    const winrate = games > 0 ? wins / games : 0.5;
    datasetCache.set(role, winrate);
    return winrate;
}

// The prior win rate for a champion-role: its own long-window win rate,
// shrunk toward the rare-pick win rate by the same pseudo-games used for the
// current-patch estimate. Main-role samples are effectively unchanged; a
// five-game off-role sample no longer acts like thousands of games.
export function getChampionPriorWinrate(
    dataset: Dataset,
    role: Role,
    stats: { wins: number; games: number },
    priorGames: number,
) {
    const rareWinrate = getRarePickWinrate(dataset, role);
    const games = Number.isFinite(stats.games) ? Math.max(0, stats.games) : 0;
    const wins = games > 0 && Number.isFinite(stats.wins) ? stats.wins : 0;
    const pseudoGames = Math.max(0, priorGames);
    if (games + pseudoGames === 0) return rareWinrate;
    return (wins + pseudoGames * rareWinrate) / (games + pseudoGames);
}
