import { describe, expect, test } from "bun:test";
import {
    buildLowerBound,
    combineBuildSets,
    ExactBuildSets,
    rankCombinedBuilds,
    FullBuildSets,
    parseFullBuildSets,
    purchasesByOrder,
    rankPurchaseOptions,
    combinedBuildPaths,
    rankBuildPaths,
} from "./combined-builds";

const exact: ExactBuildSets = {
    itemBootSet1: { "10001": [100, 20] },
    itemBootSet2: { "10001_20002": [60, 24], "10001_30003": [40, 16] },
    itemBootSet3: {
        "10001_20002_30003": [30, 18],
        "10001_20002_40004": [10, 4],
    },
};
const completed = {
    "10001_20002_30003": { games: 90, wins: 54 },
    "10001_20002_40004": { games: 20, wins: 12 },
};
const metadata = {
    itemData: Object.fromEntries(
        [10001, 20002, 30003, 40004].map((id) => [
            id,
            { id, name: String(id), gold: 100 },
        ]),
    ),
};

describe("ordered build paths", () => {
    const sets: FullBuildSets = {
        ...exact,
        itemBootSet4: { "10001_20002_30003_40004": [60, 36] },
        itemBootSet5: { "10001_20002_30003_40004_50005": [20, 10] },
        itemBootSet6: {
            "10001_20002_30003_40004_50005_60006": [10, 6],
            "30003_20002_10001_40004_50005_60006": [100, 60],
        },
    };
    const allMetadata = {
        itemData: {
            ...metadata.itemData,
            50005: { id: 50005, name: "E", gold: 100 },
            60006: { id: 60006, name: "F", gold: 100 },
        },
    };

    test("keeps paths sharing a final item separate without inventing combinations", () => {
        const paths = combinedBuildPaths(sets);
        expect(paths).toHaveLength(6);
        expect(Object.keys(paths[5])).toEqual(Object.keys(sets.itemBootSet6));
        expect(paths[5]["10001_20002_30003_40004_50005_60006"]).toEqual({
            games: 210,
            wins: 97,
            completedGames: 10,
            extrapolatedGames: 200,
        });
        expect(paths[5]["30003_20002_10001_40004_50005_60006"]).toEqual({
            games: 100,
            wins: 60,
            completedGames: 100,
            extrapolatedGames: 0,
        });
        const combined = combineBuildSets(exact, {
            "10001_20002_30003": { games: 120, wins: 70 },
            "10001_20002_40004": { games: 10, wins: 4 },
        });
        expect(paths[2]["10001_20002_30003"]).toEqual(
            combined["10001_20002_30003"],
        );
    });

    test("ranks whole six-item paths and preserves the original purchase order", () => {
        const paths = combinedBuildPaths(sets);
        const ranked = rankBuildPaths(paths[5], allMetadata, 6);
        expect(ranked).toHaveLength(2);
        expect(ranked[0].itemIds).toEqual([
            30003, 20002, 10001, 40004, 50005, 60006,
        ]);
        expect(ranked[0].lowerBound).toBe(buildLowerBound(60, 100));
        expect(rankBuildPaths(paths[5], metadata, 6)).toEqual([]);
        expect(rankBuildPaths(paths[5], allMetadata, 3)).toEqual([]);
        expect(
            rankBuildPaths(
                {
                    "10001_20002_30003_40004_50005_50005": {
                        games: 100,
                        wins: 70,
                        completedGames: 100,
                        extrapolatedGames: 0,
                    },
                    "10001_20002_30003_40004_50005_60006": {
                        games: 10,
                        wins: 11,
                        completedGames: 10,
                        extrapolatedGames: 0,
                    },
                },
                allMetadata,
                6,
            ),
        ).toEqual([]);
    });
});

describe("purchase options for all six slots", () => {
    const path = [10001, 20002, 30003, 40004, 50005, 60006];
    const source = {
        itemSets: Object.fromEntries(
            path.map((_, i) => [
                `itemBootSet${i + 1}`,
                [[path.slice(0, i + 1).join("_"), (i + 1) * 10, (i + 1) * 5]],
            ]),
        ),
    };

    test("reads full endpoint rows and propagates early games through purchase six", () => {
        const sets = parseFullBuildSets(source);
        expect(Object.keys(sets)).toHaveLength(6);
        const orders = purchasesByOrder(sets);
        expect(orders).toHaveLength(6);
        for (let i = 0; i < 6; i++) {
            expect(orders[i][path[i]].games).toBeCloseTo(210, 10);
            expect(orders[i][path[i]].wins).toBeCloseTo(105, 10);
        }
        expect(orders[0][10001].completedGames).toBe(210);
        expect(orders[0][10001].extrapolatedGames).toBe(0);
        expect(orders[5][60006].completedGames).toBe(60);
        expect(orders[5][60006].extrapolatedGames).toBe(150);
    });

    test("matches combined-set allocation while pooling each slot separately", () => {
        const sets: FullBuildSets = {
            ...exact,
            itemBootSet4: {
                "10001_20002_30003_50005": [60, 36],
                "10001_20002_40004_50005": [10, 8],
            },
            itemBootSet5: {},
            itemBootSet6: {},
        };
        const orders = purchasesByOrder(sets);
        expect(orders[2][30003]).toEqual({
            games: 180,
            wins: 81,
            completedGames: 90,
            extrapolatedGames: 90,
        });
        expect(orders[2][40004]).toEqual({
            games: 50,
            wins: 21,
            completedGames: 20,
            extrapolatedGames: 30,
        });
        expect(orders[1][20002].games).toBe(230);
        expect(orders[1][30003].games).toBe(80);
        // Paths without observed continuations are not forced into other builds.
        expect(
            Object.values(orders[2]).reduce((sum, item) => sum + item.games, 0),
        ).toBe(230);
        expect(orders[5]).toEqual({});
    });

    test("pools counts, not confidence scores, and filters missing metadata", () => {
        const orders = purchasesByOrder(parseFullBuildSets(source));
        const ranked = rankPurchaseOptions(orders, metadata);
        expect(ranked[0][0].itemId).toBe(10001);
        expect(ranked[0][0].lowerBound).toBe(buildLowerBound(105, 210));
        expect(ranked[4]).toEqual([]);
        expect(ranked[5]).toEqual([]);
    });

    test("rejects missing buckets, bad counts, wrong path lengths, and duplicate rows", () => {
        for (const value of [
            null,
            {},
            { itemSets: {} },
            {
                itemSets: {
                    ...source.itemSets,
                    itemBootSet6: [["1_2", 10, 5]],
                },
            },
            { itemSets: { ...source.itemSets, itemBootSet1: [["1", 5, 10]] } },
            {
                itemSets: {
                    ...source.itemSets,
                    itemBootSet1: [
                        ["1", 10, 5],
                        ["1", 10, 5],
                    ],
                },
            },
        ]) {
            expect(() => parseFullBuildSets(value)).toThrow();
        }
    });
});

describe("video strategy: combined item sets", () => {
    test("allocates unfinished builds and counts exact-three and later games once", () => {
        const combined = combineBuildSets(exact, completed);
        // Third item C gets 3/4 of AB's 60 games and 3/4 * 3/5 of A's 100.
        expect(combined["10001_20002_30003"]).toEqual({
            games: 180,
            wins: 81,
            completedGames: 90,
            extrapolatedGames: 90,
        });
        expect(combined["10001_20002_40004"]).toEqual({
            games: 50,
            wins: 21,
            completedGames: 20,
            extrapolatedGames: 30,
        });
        // The actually-built 90 already includes the exact-three 30.
        expect(combined["10001_20002_30003"].games).not.toBe(210);
    });

    test("preserves purchase order and variable-length item IDs", () => {
        const result = combineBuildSets(exact, {
            ...completed,
            "20002_10001_30003": { games: 10, wins: 6 },
        });
        expect(result["10001_20002_30003"].extrapolatedGames).toBe(90);
        expect(result["20002_10001_30003"].extrapolatedGames).toBe(0);
    });

    test("retains fractional extrapolations instead of truncating evidence", () => {
        const sparse: ExactBuildSets = {
            itemBootSet1: { "1": [1, 1] },
            itemBootSet2: { "1_2": [1, 1], "1_3": [2, 0] },
            itemBootSet3: { "1_2_3": [1, 1], "1_2_4": [2, 0] },
        };
        const result = combineBuildSets(sparse, {
            "1_2_3": { games: 1, wins: 1 },
        });
        expect(result["1_2_3"].extrapolatedGames).toBeCloseTo(4 / 9, 12);
        expect(result["1_2_3"].wins).toBeCloseTo(13 / 9, 12);
    });

    test("handles absent continuations without inventing extrapolated games", () => {
        const sets: ExactBuildSets = {
            itemBootSet1: { "1": [100, 0] },
            itemBootSet2: {},
            itemBootSet3: {},
        };
        const result = combineBuildSets(sets, {
            "1_2_3": { games: 20, wins: 12 },
        });
        expect(result["1_2_3"]).toEqual({
            games: 20,
            wins: 12,
            completedGames: 20,
            extrapolatedGames: 0,
        });
    });
});

describe("continuity-corrected one-sided 99% Wilson ranking", () => {
    test("matches the creator's z=2.326 and half-success correction", () => {
        expect(buildLowerBound(50, 100)).toBeCloseTo(0.3819859153776453, 12);
        expect(buildLowerBound(600, 1000)).toBeCloseTo(0.5630159661061767, 12);
        expect(buildLowerBound(600, 1000)).toBeGreaterThan(
            buildLowerBound(60, 100),
        );
        expect(buildLowerBound(600, 1000)).toBeLessThan(0.6);
        // The corrected bound is lower than uncorrected Wilson for the same data.
        expect(buildLowerBound(50, 100)).toBeLessThan(0.387);
    });

    test("returns finite conservative bounds at the boundaries", () => {
        for (const [wins, games] of [
            [0, 0],
            [0, 1],
            [1, 1],
            [10, 10],
            [0, 100],
        ]) {
            const score = buildLowerBound(wins, games);
            expect(Number.isFinite(score)).toBe(true);
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThanOrEqual(games ? wins / games : 0);
        }
        for (const [wins, games] of [
            [NaN, 10],
            [1, Infinity],
            [11, 10],
            [-1, 10],
            [0, -1],
        ])
            expect(buildLowerBound(wins, games)).toBe(0);
    });

    test("ranks evidence rather than raw win rate and filters unknown items", () => {
        const stats = (wins: number, games: number) => ({
            wins,
            games,
            completedGames: games,
            extrapolatedGames: 0,
        });
        const sets = {
            "10001_20002_30003": stats(10, 10),
            "10001_20002_40004": stats(650, 1000),
            "10001_20002_99999": stats(1000, 1000),
        };
        const ranked = rankCombinedBuilds(sets, metadata);
        expect(ranked).toHaveLength(2);
        expect(ranked[0].key).toBe("10001_20002_40004");
        expect(ranked[0].winrate).toBe(0.65);
        expect(ranked[1].winrate).toBe(1);
        expect(rankCombinedBuilds(undefined, metadata)).toEqual([]);
    });

    test("ranking ties are deterministic", () => {
        const a = {
            wins: 60,
            games: 100,
            completedGames: 100,
            extrapolatedGames: 0,
        };
        const sets = { "10001_20002_40004": a, "10001_20002_30003": a };
        expect(
            rankCombinedBuilds(sets, metadata).map((build) => build.key),
        ).toEqual(["10001_20002_30003", "10001_20002_40004"]);
    });
});
