import { Dataset } from "../models/dataset/Dataset";
import {
    buildLowerBound,
    combinedBuildPaths,
    FullBuildSets,
} from "./combined-builds";
import { LolalyticsBuildData } from "./lolalytics";

export const MIN_RECOMMENDATION_GAMES = 500;
export const MIN_RECOMMENDATION_SHARE = 0.01;

export function rankCoreBuilds(
    sets: FullBuildSets | undefined,
    dataset: Pick<Dataset, "itemData">,
) {
    const paths = sets ? combinedBuildPaths(sets)[2] : {};
    const total = Object.values(paths).reduce(
        (sum, stats) => sum + stats.completedGames,
        0,
    );
    const groups = new Map<
        string,
        {
            itemIds: number[];
            games: number;
            wins: number;
            observed: number;
            orderGames: number;
        }
    >();
    for (const [key, stats] of Object.entries(paths)) {
        const ids = key.split("_").map(Number);
        if (
            ids.length !== 3 ||
            new Set(ids).size !== 3 ||
            !ids.every((id) => dataset.itemData[id])
        )
            continue;
        const groupKey = [...ids].sort((a, b) => a - b).join("_");
        const group = groups.get(groupKey) ?? {
            itemIds: ids,
            games: 0,
            wins: 0,
            observed: 0,
            orderGames: -1,
        };
        group.games += stats.games;
        group.wins += stats.wins;
        group.observed += stats.completedGames;
        // Pool mutually exclusive purchase orders, showing the most-used order.
        if (stats.completedGames > group.orderGames) {
            group.itemIds = ids;
            group.orderGames = stats.completedGames;
        }
        groups.set(groupKey, group);
    }
    return [...groups.entries()]
        .flatMap(([key, stats]) => {
            const share = total > 0 ? stats.observed / total : 0;
            if (
                stats.observed < MIN_RECOMMENDATION_GAMES ||
                share < MIN_RECOMMENDATION_SHARE ||
                stats.games <= 0
            )
                return [];
            const winrate = stats.wins / stats.games;
            return [
                {
                    key,
                    ...stats,
                    share,
                    winrate,
                    // Extrapolation adjusts the estimate, never the evidence count.
                    // This is a conservative ranking heuristic, not a calibrated CI.
                    score: buildLowerBound(
                        winrate * stats.observed,
                        stats.observed,
                    ),
                },
            ];
        })
        .sort(
            (a, b) =>
                b.score - a.score ||
                b.observed - a.observed ||
                a.key.localeCompare(b.key),
        )
        .slice(0, 3);
}

export function addCoreOpenings(
    cores: ReturnType<typeof rankCoreBuilds>,
    sets: FullBuildSets | undefined,
    boots: ReadonlySet<number>,
    dataset: Pick<Dataset, "itemData">,
) {
    const openings = new Map<
        string,
        Map<string, { itemIds: number[]; games: number }>
    >();
    // These exact-length buckets are disjoint. Count each observed game once,
    // stopping at the third major item so later boots never move into the core.
    for (const count of [3, 4, 5, 6] as const) {
        for (const [key, [games]] of Object.entries(
            sets?.[`itemBootSet${count}`] ?? {},
        )) {
            if (!Number.isFinite(games) || games <= 0) continue;
            const prefix: number[] = [];
            const major: number[] = [];
            for (const id of key.split("_").map(Number)) {
                prefix.push(id);
                if (!boots.has(id)) major.push(id);
                if (major.length === 3) break;
            }
            if (
                major.length !== 3 ||
                prefix.length > 4 ||
                new Set(prefix).size !== prefix.length ||
                !prefix.every((id) => dataset.itemData[id])
            )
                continue;
            const coreKey = [...major].sort((a, b) => a - b).join("_");
            if (!cores.some((core) => core.key === coreKey)) continue;
            const variants =
                openings.get(coreKey) ??
                new Map<string, { itemIds: number[]; games: number }>();
            const prefixKey = prefix.join("_");
            const variant = variants.get(prefixKey) ?? {
                itemIds: prefix,
                games: 0,
            };
            variant.games += games;
            variants.set(prefixKey, variant);
            openings.set(coreKey, variants);
        }
    }
    return cores.map((core) => {
        const opening = [...(openings.get(core.key)?.values() ?? [])]
            .filter(
                (variant) =>
                    variant.games >= MIN_RECOMMENDATION_GAMES &&
                    variant.games / core.observed >= MIN_RECOMMENDATION_SHARE,
            )
            .sort(
                (a, b) =>
                    b.games - a.games ||
                    a.itemIds.join("_").localeCompare(b.itemIds.join("_")),
            )[0];
        return { ...core, opening };
    });
}

export function rankKeystones(
    data: LolalyticsBuildData,
    dataset: Pick<Dataset, "runeData">,
) {
    return Object.values(dataset.runeData)
        .filter((rune) => rune.slot === 0)
        .flatMap((rune) => {
            const row = data.runes.stats[rune.id]?.[0];
            if (
                !row ||
                row[2] < MIN_RECOMMENDATION_GAMES ||
                row[2] / data.header.n < MIN_RECOMMENDATION_SHARE
            )
                return [];
            return [
                {
                    id: rune.id,
                    games: row[2],
                    winrate: row[1] / 100,
                    share: row[2] / data.header.n,
                    score: buildLowerBound((row[2] * row[1]) / 100, row[2]),
                },
            ];
        })
        .sort((a, b) => b.score - a.score || b.games - a.games || a.id - b.id)
        .slice(0, 3);
}

export type SuggestedRunePage = {
    primary: number[];
    secondary: number[];
    shards: number[];
};

export function validateRunePage(
    page: SuggestedRunePage | undefined,
    keystone: number,
    dataset: Pick<Dataset, "runeData" | "statShardData">,
) {
    if (
        !page ||
        page.primary.length !== 4 ||
        page.secondary.length !== 2 ||
        page.shards.length !== 3 ||
        page.primary[0] !== keystone
    )
        return undefined;
    const primary = page.primary.map((id) => dataset.runeData[id]);
    const secondary = page.secondary.map((id) => dataset.runeData[id]);
    if (
        primary.some(
            (rune, slot) =>
                !rune ||
                rune.slot !== slot ||
                rune.pathId !== primary[0]?.pathId,
        )
    )
        return undefined;
    if (
        secondary.some(
            (rune) =>
                !rune ||
                rune.slot === 0 ||
                rune.pathId === primary[0]?.pathId ||
                rune.pathId !== secondary[0]?.pathId,
        ) ||
        secondary[0].slot === secondary[1].slot
    )
        return undefined;
    if (
        page.shards.some(
            (id, slot) =>
                !dataset.statShardData[id]?.positions.some(
                    (position) => position.slot === slot,
                ),
        )
    )
        return undefined;
    return page;
}
