import { describe, expect, test } from "bun:test";
import { parseFullBuildSets, FullBuildSets } from "./combined-builds";
import {
    addCoreOpenings,
    rankCoreBuilds,
    rankKeystones,
    validateRunePage,
} from "./recommendations";
import { LolalyticsBuildData } from "./lolalytics";

const items = {
    itemData: Object.fromEntries(
        [1, 2, 3, 4, 5, 6, 7, 8, 9].map((id) => [
            id,
            { id, name: String(id), gold: 3000 },
        ]),
    ),
};
const empty: FullBuildSets = {
    itemBootSet1: {},
    itemBootSet2: {},
    itemBootSet3: {},
    itemBootSet4: {},
    itemBootSet5: {},
    itemBootSet6: {},
};

describe("boots within core openings", () => {
    const cores = rankCoreBuilds(
        { ...empty, itemBootSet3: { "1_2_3": [3000, 1600] } },
        items,
    );
    const boots = new Set([8, 9]);

    test("preserves early boots at their observed position and counts longer games once", () => {
        const result = addCoreOpenings(
            cores,
            {
                ...empty,
                itemBootSet4: { "1_9_2_3": [600, 300], "1_8_2_3": [500, 250] },
                itemBootSet5: { "1_9_2_3_4": [400, 200] },
                itemBootSet6: { "1_9_2_3_4_5": [200, 100] },
            },
            boots,
            items,
        );
        expect(result[0].opening).toEqual({
            itemIds: [1, 9, 2, 3],
            games: 1200,
        });
        expect(result[0].score).toBe(cores[0].score);
        expect(result[0].observed).toBe(3000);
    });

    test("does not pull late boots forward and allows three-item openings", () => {
        const result = addCoreOpenings(
            cores,
            {
                ...empty,
                itemBootSet3: { "1_2_3": [400, 200] },
                itemBootSet4: { "1_2_3_9": [500, 250], "1_9_2_3": [600, 300] },
                itemBootSet5: { "1_2_3_4_8": [300, 150] },
            },
            boots,
            items,
        );
        expect(result[0].opening).toEqual({ itemIds: [1, 2, 3], games: 1200 });
    });

    test("keeps boot-first orders and never borrows boots from another core", () => {
        const result = addCoreOpenings(
            cores,
            {
                ...empty,
                itemBootSet4: {
                    "9_2_1_3": [500, 250],
                    "1_8_4_5": [2000, 1000],
                },
            },
            boots,
            items,
        );
        expect(result[0].opening).toEqual({
            itemIds: [9, 2, 1, 3],
            games: 500,
        });
    });

    test("falls back to the core when boot timing is sparse, unavailable, or invalid", () => {
        for (const sets of [
            undefined,
            {
                ...empty,
                itemBootSet4: {
                    "1_9_2_3": [499, 250],
                    "1_99_2_3": [1000, 500],
                    "1_9_1_2": [1000, 500],
                },
            } satisfies FullBuildSets,
        ]) {
            const result = addCoreOpenings(cores, sets, boots, items);
            expect(result[0].opening).toBeUndefined();
            expect(result[0].itemIds).toEqual([1, 2, 3]);
        }
    });
});

describe("supported core choices", () => {
    test("reads non-boots sets and includes longer games in three-item cores", () => {
        const sets = parseFullBuildSets({
            itemSets: {
                ...Object.fromEntries(
                    [1, 2, 3, 4, 5, 6].map((n) => [`itemBootSet${n}`, []]),
                ),
                ...Object.fromEntries(
                    [1, 2, 3, 4, 5].map((n) => [
                        `itemSet${n}`,
                        n === 4 ? [["1_2_3_4", 600, 330]] : [],
                    ]),
                ),
            },
        });
        expect(rankCoreBuilds(sets.coreSets, items)[0].observed).toBe(600);
        expect(rankCoreBuilds(sets.coreSets, items)[0].itemIds).toEqual([
            1, 2, 3,
        ]);
        expect(rankCoreBuilds(undefined, items)).toEqual([]);
    });
    test("pools order variants, uses the popular order, and returns at most three distinct cores", () => {
        const ranked = rankCoreBuilds(
            {
                ...empty,
                itemBootSet3: {
                    "1_2_3": [400, 240],
                    "2_1_3": [700, 420],
                    "4_5_6": [600, 330],
                    "7_8_9": [600, 300],
                    "1_5_9": [600, 280],
                    "1_2_9": [2, 2],
                },
            },
            items,
        );
        expect(ranked).toHaveLength(3);
        expect(ranked[0].itemIds).toEqual([2, 1, 3]);
        expect(ranked[0].observed).toBe(1100);
        expect(ranked[0].share).toBeCloseTo(1100 / 2902);
    });
    test("extrapolation cannot qualify a niche core or increase its evidence count", () => {
        expect(
            rankCoreBuilds(
                {
                    ...empty,
                    itemBootSet1: { "1": [100000, 90000] },
                    itemBootSet2: { "1_2": [10000, 9000] },
                    itemBootSet3: { "1_2_3": [2, 2] },
                },
                items,
            ),
        ).toEqual([]);
        expect(
            rankCoreBuilds(
                {
                    ...empty,
                    itemBootSet3: {
                        "1_2_3": [500, 400],
                        "4_5_6": [100000, 50000],
                    },
                },
                items,
            ).map((core) => core.itemIds),
        ).toEqual([[4, 5, 6]]);
        expect(
            rankCoreBuilds(
                { ...empty, itemBootSet3: { "1_2_3": [0, 0] } },
                items,
            ),
        ).toEqual([]);
    });
});

const runeData = Object.fromEntries(
    [
        [1, 10, 0],
        [2, 10, 1],
        [3, 10, 2],
        [4, 10, 3],
        [5, 20, 1],
        [6, 20, 2],
        [7, 20, 0],
        [8, 30, 0],
        [9, 40, 0],
    ].map(([id, pathId, slot]) => [
        id,
        {
            id,
            pathId,
            slot,
            name: String(id),
            key: String(id),
            icon: "",
            index: 0,
        },
    ]),
);
const metadata = {
    runeData,
    statShardData: {
        11: {
            id: 11,
            key: "",
            name: "",
            positions: [
                { slot: 0, index: 0 },
                { slot: 1, index: 0 },
                { slot: 2, index: 0 },
            ],
        },
    },
};
const page = { primary: [1, 2, 3, 4], secondary: [5, 6], shards: [11, 11, 11] };
describe("rune options", () => {
    test("ranks supported keystones only, without treating minor rune counts as page evidence", () => {
        const data = {
            header: { n: 100000 },
            runes: {
                stats: {
                    1: [[20, 55, 20000]],
                    7: [[10, 54, 10000]],
                    8: [[0.5, 99, 500]],
                    9: [[0, 100, 2]],
                    2: [[50, 99, 50000]],
                },
            },
        } as unknown as LolalyticsBuildData;
        expect(rankKeystones(data, metadata).map((rune) => rune.id)).toEqual([
            1, 7,
        ]);
    });
    test("requires a legal complete page for the requested keystone", () => {
        expect(validateRunePage(page, 1, metadata)).toEqual(page);
        for (const invalid of [
            undefined,
            { ...page, primary: [1, 2, 2, 4] },
            { ...page, secondary: [5, 5] },
            { ...page, secondary: [2, 3] },
            { ...page, shards: [11, 11, 99] },
        ]) {
            expect(validateRunePage(invalid, 1, metadata)).toBeUndefined();
        }
        expect(validateRunePage(page, 7, metadata)).toBeUndefined();
    });
});
