import { CombinedBuildStats } from "../models/build/BuildDataset";
import { Dataset } from "../models/dataset/Dataset";

export type ExactBuildSets = {
    itemBootSet1: Record<string, [number, number]>;
    itemBootSet2: Record<string, [number, number]>;
    itemBootSet3: Record<string, [number, number]>;
};

export type FullBuildSets = ExactBuildSets & {
    coreSets?: FullBuildSets;
    itemBootSet4: Record<string, [number, number]>;
    itemBootSet5: Record<string, [number, number]>;
    itemBootSet6: Record<string, [number, number]>;
};

export function parseFullBuildSets(value: unknown) {
    if (
        !value ||
        typeof value !== "object" ||
        !("itemSets" in value) ||
        !value.itemSets ||
        typeof value.itemSets !== "object"
    ) {
        throw new Error("Lolalytics did not return purchase-order data.");
    }
    const source = value.itemSets as Record<string, unknown>;
    const result = {} as FullBuildSets;
    for (const count of [1, 2, 3, 4, 5, 6] as const) {
        const key = `itemBootSet${count}` as const;
        const rows = source[key];
        if (!Array.isArray(rows))
            throw new Error("Lolalytics item-set format has changed.");
        const bucket: Record<string, [number, number]> = {};
        for (const row of rows) {
            if (
                !Array.isArray(row) ||
                typeof row[0] !== "string" ||
                !/^\d+(?:_\d+)*$/.test(row[0]) ||
                row[0].split("_").length !== count ||
                !Number.isFinite(row[1]) ||
                !Number.isFinite(row[2]) ||
                row[1] < 0 ||
                row[2] < 0 ||
                row[2] > row[1] ||
                bucket[row[0]] !== undefined
            ) {
                throw new Error("Lolalytics returned invalid item-set counts.");
            }
            bucket[row[0]] = [row[1], row[2]];
        }
        result[key] = bucket;
    }
    // The non-boots buckets preserve major-item purchase order.
    if ([1, 2, 3, 4, 5].every((n) => Array.isArray(source[`itemSet${n}`]))) {
        const nonBoots = parseFullBuildSets({
            itemSets: {
                ...Object.fromEntries(
                    [1, 2, 3, 4, 5].map((n) => [
                        `itemBootSet${n}`,
                        source[`itemSet${n}`],
                    ]),
                ),
                itemBootSet6: [],
            },
        });
        result.coreSets = nonBoots;
    }
    return result;
}

export function combinedBuildPaths(exact: FullBuildSets) {
    const buckets = [
        exact.itemBootSet1,
        exact.itemBootSet2,
        exact.itemBootSet3,
        exact.itemBootSet4,
        exact.itemBootSet5,
        exact.itemBootSet6,
    ];
    let unfinished: Record<string, { wins: number; games: number }> = {};
    return buckets.map((bucket, index) => {
        const completed: Record<string, { wins: number; games: number }> = {};
        for (const later of buckets.slice(index)) {
            for (const [key, [games, wins]] of Object.entries(later)) {
                const prefix = key
                    .split("_")
                    .slice(0, index + 1)
                    .join("_");
                const total = (completed[prefix] ??= { games: 0, wins: 0 });
                total.games += games;
                total.wins += wins;
            }
        }
        const paths: Record<string, CombinedBuildStats> = {};
        for (const [prefix, stats] of Object.entries(completed)) {
            const early = unfinished[prefix] ?? { games: 0, wins: 0 };
            // Preserve the entire observed prefix. Different build paths must
            // not be merged just because they buy the same item in this slot.
            paths[prefix] = {
                games: stats.games + early.games,
                wins: stats.wins + early.wins,
                completedGames: stats.games,
                extrapolatedGames: early.games,
            };
        }
        const next = buckets[index + 1] ?? {};
        const continuationTotals = new Map<string, number>();
        for (const [key, [games]] of Object.entries(next)) {
            const prefix = key.split("_").slice(0, -1).join("_");
            continuationTotals.set(
                prefix,
                (continuationTotals.get(prefix) ?? 0) + games,
            );
        }
        const allocated: typeof unfinished = {};
        for (const [key, [games]] of Object.entries(next)) {
            const prefix = key.split("_").slice(0, -1).join("_");
            const total = continuationTotals.get(prefix) ?? 0;
            if (total <= 0) continue;
            const probability = games / total;
            const ended = bucket[prefix] ?? [0, 0];
            const early = unfinished[prefix] ?? { games: 0, wins: 0 };
            allocated[key] = {
                games: (ended[0] + early.games) * probability,
                wins: (ended[1] + early.wins) * probability,
            };
        }
        unfinished = allocated;
        return paths;
    });
}

export function purchasesByOrder(exact: FullBuildSets) {
    return combinedBuildPaths(exact).map((paths, index) => {
        const purchases: Record<string, CombinedBuildStats> = {};
        for (const [key, stats] of Object.entries(paths)) {
            const itemId = key.split("_")[index];
            const total = (purchases[itemId] ??= {
                games: 0,
                wins: 0,
                completedGames: 0,
                extrapolatedGames: 0,
            });
            total.games += stats.games;
            total.wins += stats.wins;
            total.completedGames += stats.completedGames;
            total.extrapolatedGames += stats.extrapolatedGames;
        }
        return purchases;
    });
}

export function rankPurchaseOptions(
    orders: Record<string, CombinedBuildStats>[],
    dataset: Pick<Dataset, "itemData">,
) {
    return orders.map((stats) =>
        Object.entries(stats)
            .filter(
                ([id, value]) =>
                    dataset.itemData[Number(id)] &&
                    Number.isFinite(value.games) &&
                    value.games > 0 &&
                    Number.isFinite(value.wins) &&
                    value.wins >= 0 &&
                    value.wins <= value.games,
            )
            .map(([id, value]) => ({
                itemId: Number(id),
                ...value,
                winrate: value.wins / value.games,
                lowerBound: buildLowerBound(value.wins, value.games),
            }))
            .sort(
                (a, b) =>
                    b.lowerBound - a.lowerBound ||
                    b.games - a.games ||
                    a.itemId - b.itemId,
            ),
    );
}

// The creator's one-sided 99% z score, not the two-sided 99% value (2.576).
// Method: https://github.com/Jayensee/LolalyticsExtrapOverride
const BUILD_CONFIDENCE_Z = 2.326;

export function buildLowerBound(wins: number, games: number) {
    if (
        !Number.isFinite(wins) ||
        !Number.isFinite(games) ||
        games <= 0 ||
        wins < 0 ||
        wins > games
    )
        return 0;
    // Continuity correction: subtract half a success before applying Wilson.
    const p = Math.max(0, (wins - 0.5) / games);
    if (p === 0) return 0;
    const zSquared = BUILD_CONFIDENCE_Z ** 2;
    const center = p + zSquared / (2 * games);
    const radius =
        BUILD_CONFIDENCE_Z *
        Math.sqrt((p * (1 - p)) / games + zSquared / (4 * games ** 2));
    return Math.max(0, (center - radius) / (1 + zSquared / games));
}

export function combineBuildSets(
    exact: ExactBuildSets,
    completed: Record<string, { wins: number; games: number }>,
) {
    // For each prefix, estimate its continuation distribution from the next
    // exact-count bucket. Preserve purchase order and fractional estimates.
    const continuationTotals = (sets: Record<string, [number, number]>) => {
        const totals = new Map<string, number>();
        for (const [key, [games]] of Object.entries(sets)) {
            const prefix = key.split("_").slice(0, -1).join("_");
            totals.set(prefix, (totals.get(prefix) ?? 0) + games);
        }
        return totals;
    };
    const secondTotals = continuationTotals(exact.itemBootSet2);
    const thirdTotals = continuationTotals(exact.itemBootSet3);
    const combined: Record<string, CombinedBuildStats> = {};
    for (const [key, stats] of Object.entries(completed)) {
        const ids = key.split("_");
        if (ids.length !== 3 || new Set(ids).size !== 3) continue;
        const firstKey = ids[0];
        const secondKey = ids.slice(0, 2).join("_");
        const first = exact.itemBootSet1[firstKey];
        const second = exact.itemBootSet2[secondKey];
        const third = exact.itemBootSet3[key];
        const thirdTotal = thirdTotals.get(secondKey) ?? 0;
        const secondTotal = secondTotals.get(firstKey) ?? 0;
        const fromSecond = thirdTotal > 0 ? (third?.[0] ?? 0) / thirdTotal : 0;
        const fromFirst =
            secondTotal > 0
                ? (fromSecond * (second?.[0] ?? 0)) / secondTotal
                : 0;
        const extrapolatedGames =
            (second?.[0] ?? 0) * fromSecond + (first?.[0] ?? 0) * fromFirst;
        const extrapolatedWins =
            (second?.[1] ?? 0) * fromSecond + (first?.[1] ?? 0) * fromFirst;
        // Actually built already includes exact-three AND longer games.
        // Combined = actually built + extrapolated - exact-three, so only
        // the allocated one/two-item games are added here.
        combined[key] = {
            wins: stats.wins + extrapolatedWins,
            games: stats.games + extrapolatedGames,
            completedGames: stats.games,
            extrapolatedGames,
        };
    }
    return combined;
}

export function rankCombinedBuilds(
    sets: Record<string, CombinedBuildStats> | undefined,
    dataset: Pick<Dataset, "itemData">,
) {
    return rankBuildPaths(sets, dataset, 3);
}

export function rankBuildPaths(
    sets: Record<string, CombinedBuildStats> | undefined,
    dataset: Pick<Dataset, "itemData">,
    length: number,
) {
    return Object.entries(sets ?? {})
        .filter(([key, stats]) => {
            const ids = key.split("_").map(Number);
            return (
                length >= 1 &&
                length <= 6 &&
                ids.length === length &&
                new Set(ids).size === length &&
                ids.every((id) => dataset.itemData[id]) &&
                Number.isFinite(stats.games) &&
                stats.games > 0 &&
                Number.isFinite(stats.wins) &&
                stats.wins >= 0 &&
                stats.wins <= stats.games
            );
        })
        .map(([key, stats]) => ({
            key,
            itemIds: key.split("_").map(Number),
            ...stats,
            winrate: stats.wins / stats.games,
            lowerBound: buildLowerBound(stats.wins, stats.games),
        }))
        .sort(
            (a, b) =>
                b.lowerBound - a.lowerBound ||
                b.games - a.games ||
                a.key.localeCompare(b.key),
        );
}
