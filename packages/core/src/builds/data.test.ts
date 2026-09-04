import { describe, expect, test } from "bun:test";
import { QueryClient } from "@tanstack/query-core";
import { fetchBuildData, partialDatasetFromLolalyticsData } from "./data";
import {
    BuildRequest,
    LolalyticsBuildData,
    parseLolalyticsBuildPage,
} from "./lolalytics";
import { analyzeBuild } from "./analysis";
import { Dataset } from "../models/dataset/Dataset";
import { Role, DEFAULT_ROLE_WEIGHTS } from "../models/Role";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { FullBuildSets } from "./combined-builds";

function buildData(patch = "16.17"): LolalyticsBuildData {
    return {
        header: { cid: 103, patch, lane: "middle", n: 1000, wr: 52 },
        suggestedRunePage: {
            primary: [8112, 8126, 8140, 8106],
            secondary: [9111, 9104],
            shards: [5008, 5008, 5001],
        },
        runes: {
            stats: {
                "8112": [[80, 53, 800]],
                "5008": [[70, 52, 700]],
                "5008f": [[90, 54, 900]],
                "99999": [[1, 50, 10]],
            },
        },
        boots: [
            [1001, 51, 20, 200],
            [3020, 55, 50, 500],
        ],
        startSet: [
            ["2003_1056_2003", 52, 90, 900],
            [1056, 50, 5, 50],
            ["99999_2003", 60, 1, 10],
        ],
        spells: [
            ["14_4", 54, 80, 800],
            ["99999_4", 50, 1, 10],
        ],
        item1: [
            [3118, 55, 80, 800],
            [99999, 60, 1, 10],
        ],
        item2: [],
        item3: [],
        item4: [],
        item5: [],
        skillOrder: [
            ["QWE", 53.2, 91.3, 500],
            ["BAD", 60, 1, 10],
        ],
        skillEarly: [
            [
                [52, 20, 200],
                [53, 80, 800],
                [0, 0, 0],
                [0, 0, 0],
            ],
        ],
    };
}

function dataset(): Dataset {
    const champion = (id: string, key: string) => ({
        id,
        key,
        name: id,
        i18n: {},
        statsByRole: {
            0: defaultChampionRoleData(),
            1: defaultChampionRoleData(),
            2: defaultChampionRoleData(),
            3: defaultChampionRoleData(),
            4: defaultChampionRoleData(),
        },
    });
    return {
        version: "16.17.1",
        date: "2026-09-04",
        championData: {
            "103": champion("Ahri", "103"),
            "238": champion("Zed", "238"),
            "62": champion("MonkeyKing", "62"),
        },
        itemData: Object.fromEntries(
            [1001, 3020, 1056, 2003, 3118].map((id) => [
                id,
                { id, name: String(id), gold: 100 },
            ]),
        ),
        runeData: {
            ...Object.fromEntries(
                [
                    [8126, 8100, 1],
                    [8140, 8100, 2],
                    [8106, 8100, 3],
                    [9111, 8000, 1],
                    [9104, 8000, 2],
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
            ),
            8112: {
                id: 8112,
                name: "Electrocute",
                key: "Electrocute",
                icon: "",
                pathId: 8100,
                slot: 0,
                index: 0,
            },
        },
        runePathData: {},
        statShardData: {
            5001: {
                id: 5001,
                key: "Health",
                name: "Health",
                positions: [{ slot: 2, index: 0 }],
            },
            5008: {
                id: 5008,
                key: "AdaptiveForce",
                name: "Adaptive Force",
                positions: [
                    { slot: 0, index: 0 },
                    { slot: 1, index: 0 },
                ],
            },
        },
        summonerSpellData: {
            4: { id: "SummonerFlash", key: 4, name: "Flash" },
            14: { id: "SummonerDot", key: 14, name: "Ignite" },
        },
    };
}

// A minimal Qwik object graph, preserving the same reference format as live pages.
function page(data: unknown) {
    const objects: unknown[] = [];
    const encode = (value: unknown): string => {
        const index = objects.length;
        objects.push(null);
        objects[index] = Array.isArray(value)
            ? value.map(encode)
            : value !== null && typeof value === "object"
              ? Object.fromEntries(
                    Object.entries(value).map(([key, entry]) => [
                        key,
                        encode(entry),
                    ]),
                )
              : value;
        return index.toString(36);
    };
    encode(data);
    return `<script type="qwik/json">${JSON.stringify({ objs: objects })}</script>`;
}

const loadBuild = async (request: BuildRequest) => ({
    ...buildData(request.patch),
    header: {
        ...buildData(request.patch).header,
        ...(request.matchupId
            ? {
                  vs: request.matchupId === "Zed" ? 238 : 62,
                  vsLane: request.matchupRole,
              }
            : {}),
    },
});
const enemies = new Map([
    [Role.Middle, "238"],
    [Role.Jungle, "62"],
]);

describe("Lolalytics build page adapter", () => {
    test("extracts exact and actually-built core sets for the combined strategy", () => {
        const data = buildData();
        data.itemSets = {
            itemBootSet1: { "3118": [100, 20] },
            itemBootSet2: { "3118_3020": [60, 24] },
            itemBootSet3: { "3118_3020_1056": [30, 18] },
        };
        data.builtBootSet3 = [["3118_3020_1056", 60, 9, 90]];
        const parsed = parseLolalyticsBuildPage(page(data));
        expect(parsed.itemSets).toEqual(data.itemSets);
        const result = partialDatasetFromLolalyticsData(
            dataset(),
            "103",
            Role.Middle,
            parsed,
        );
        expect(result.items.combinedSets?.["3118_3020_1056"]).toEqual({
            games: 250,
            wins: 98,
            completedGames: 90,
            extrapolatedGames: 160,
        });
    });

    test("optional malformed core data does not break individual build tables", () => {
        const data = buildData();
        const malformed = {
            ...data,
            itemSets: {
                itemBootSet1: { "3118": [5, 10] },
                itemBootSet2: {},
                itemBootSet3: {},
            },
            builtBootSet3: [["3118_3020_1056", 60, 9, 90]],
        };
        const parsed = parseLolalyticsBuildPage(page(malformed));
        expect(parsed.itemSets).toBeUndefined();
        expect(parsed.builtBootSet3).toBeUndefined();
        expect(parsed.item1).toEqual(data.item1);
    });

    test("decodes baseline and matchup pages without requiring an enemy table", () => {
        const data = buildData();
        delete data.suggestedRunePage;
        expect(parseLolalyticsBuildPage(page(data))).toEqual(data);
        data.header.vs = 238;
        data.header.vsLane = "middle";
        expect(parseLolalyticsBuildPage(page(data)).header.vs).toBe(238);
    });

    test("extracts suggested rune choices without claiming their summary counts as full-page evidence", () => {
        const data = buildData();
        const choices = data.suggestedRunePage!;
        const parsed = parseLolalyticsBuildPage(
            page({
                ...data,
                summary: {
                    pick: {
                        runes: {
                            n: 123,
                            wr: 99,
                            set: {
                                pri: choices.primary,
                                sec: choices.secondary,
                                mod: choices.shards,
                            },
                        },
                    },
                },
            }),
        );
        expect(parsed.suggestedRunePage).toEqual(choices);
        expect(parsed.runes.stats[8112][0][2]).toBe(800);
        expect(
            parseLolalyticsBuildPage(
                page({
                    ...data,
                    summary: { pick: { runes: { set: { pri: "invalid" } } } },
                }),
            ).suggestedRunePage,
        ).toBeUndefined();
    });

    test("rejects errors, corrupt graphs, zero-game data, and changed statistic layouts", () => {
        for (const html of [
            "<html>Access denied</html>",
            '<script type="qwik/json">invalid</script>',
            page({ error: "not found" }),
            '<script type="qwik/json">{"objs":[{"header":"0","runes":"0","skillOrder":"0","item1":"0"}]}</script>',
        ]) {
            expect(() => parseLolalyticsBuildPage(html)).toThrow();
        }
        const data = buildData();
        data.header.n = 0;
        expect(() => parseLolalyticsBuildPage(page(data))).toThrow("No games");
        data.header.n = 1000;
        expect(() =>
            parseLolalyticsBuildPage(
                page({ ...data, skillEarly: [[[200, 104]]] }),
            ),
        ).toThrow("skill");
        expect(() =>
            parseLolalyticsBuildPage(
                page({ ...data, item1: [[3118, 101, 50, 500]] }),
            ),
        ).toThrow("item1");
    });

    test("allows missing later item slots", () => {
        const { item5: _, ...data } = buildData();
        expect(parseLolalyticsBuildPage(page(data)).item5).toEqual([]);
    });

    test("converts current skill percentages correctly and filters unknown entities", () => {
        const result = partialDatasetFromLolalyticsData(
            dataset(),
            "103",
            Role.Middle,
            buildData(),
        );
        expect(result.games).toBe(1000);
        expect(result.wins).toBe(520);
        expect(result.skills.order.QWE).toEqual({ wins: 266, games: 500 });
        expect(result.skills.level[0].Q).toEqual({ wins: 104, games: 200 });
        expect(Object.keys(result.skills.order)).toEqual(["QWE"]);
        expect(result.runes.primary[8112]).toEqual({ wins: 424, games: 800 });
        expect(result.runes.shards.offense[5008].games).toBe(700);
        expect(result.runes.shards.flex[5008].games).toBe(900);
        expect(result.runes.primary[99999]).toBeUndefined();
        expect(result.items.boots[1001]).toBeUndefined();
        expect(result.items.statsByOrder[0][99999]).toBeUndefined();
        expect(result.items.startingSets["1056_2003_2003"].games).toBe(900);
        expect(result.items.startingSets["1056"].games).toBe(50);
        expect(result.items.startingSets["2003_99999"]).toBeUndefined();
        expect(Object.keys(result.summonerSpells)).toEqual(["14_4"]);
    });
});

describe("desktop build orchestration", () => {
    test("core recommendations honor the selected range without padding or automatic fallback", async () => {
        const client = new QueryClient();
        let currentGames = 2;
        const loadSets = async (
            request: BuildRequest,
        ): Promise<FullBuildSets> => {
            const empty = {
                itemBootSet1: {},
                itemBootSet2: {},
                itemBootSet3: {},
                itemBootSet4: {},
                itemBootSet5: {},
                itemBootSet6: {},
            };
            return {
                ...empty,
                itemBootSet1: { "3118": [1000, 500] },
                itemBootSet4: {
                    "3118_3020_1056_2003": [
                        request.patch === "30" ? 600 : currentGames,
                        request.patch === "30" ? 330 : currentGames / 2,
                    ],
                },
                coreSets: {
                    ...empty,
                    itemBootSet3: {
                        "3118_1056_2003": [
                            request.patch === "30" ? 600 : currentGames,
                            request.patch === "30" ? 330 : currentGames / 2,
                        ],
                    },
                },
            };
        };
        const first = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
            "30-days",
        );
        expect(first.coreRecommendations.dataRange).toBe("30-days");
        expect(first.coreRecommendations.options).toHaveLength(1);
        expect(first.coreRecommendations.options[0].opening).toEqual({
            itemIds: [3118, 3020, 1056, 2003],
            games: 600,
        });
        const sparse = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
            "current-patch",
        );
        expect(sparse.coreRecommendations.options).toEqual([]);
        expect(sparse.coreRecommendations.dataRange).toBe("current-patch");
        client.clear();
        currentGames = 500;
        const next = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
        );
        expect(next.coreRecommendations.dataRange).toBe("current-patch");
        expect(next.coreRecommendations.options).toHaveLength(1);
        expect(next.coreRecommendations.options[0].opening?.games).toBe(500);
        client.clear();
    });
    test("invalid suggested rune pages are retried without refetching baseline data", async () => {
        const client = new QueryClient();
        let fail = true;
        let baselineCalls = 0;
        let pageCalls = 0;
        const load = async (request: BuildRequest) => {
            const data = await loadBuild(request);
            if (request.keystone) {
                pageCalls++;
                if (fail) data.suggestedRunePage = undefined;
            } else baselineCalls++;
            return data;
        };
        const first = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            load,
        );
        expect(first.runeRecommendations.options[0].page).toBeUndefined();
        fail = false;
        const next = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            load,
        );
        expect(next.runeRecommendations.options[0].page?.primary[0]).toBe(8112);
        expect(next.warnings).toEqual([]);
        expect(baselineCalls).toBe(2);
        expect(pageCalls).toBe(2);
        client.clear();
    });

    test("runes and their suggested pages switch ranges without reusing the other range's stats", async () => {
        const client = new QueryClient();
        const requestedPages: string[] = [];
        const load = async (request: BuildRequest) => {
            const data = await loadBuild(request);
            data.runes.stats[8112] = [
                [80, request.patch === "30" ? 60 : 50, 800],
            ];
            if (request.keystone) requestedPages.push(request.patch);
            return data;
        };
        const month = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            load,
            undefined,
            "30-days",
        );
        expect(month.runeRecommendations.dataRange).toBe("30-days");
        expect(month.runeRecommendations.options[0].winrate).toBe(0.6);
        const current = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            load,
            undefined,
            "current-patch",
        );
        expect(current.runeRecommendations.options[0].winrate).toBe(0.5);
        await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            load,
            undefined,
            "30-days",
        );
        expect(requestedPages).toEqual(["30", "16.17"]);
        client.clear();
    });

    test("missing monthly rune data never silently substitutes current-patch recommendations", async () => {
        const client = new QueryClient();
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            async (request) => {
                if (request.patch === "30") throw new Error("unavailable");
                return loadBuild(request);
            },
            undefined,
            "30-days",
        );
        expect(result.runeRecommendations.dataRange).toBe("30-days");
        expect(result.runeRecommendations.options).toEqual([]);
        expect(result.warnings).toContain(
            "30-day data is unavailable; matchup adjustments are omitted.",
        );
        client.clear();
    });

    test("loads all path lengths separately and caches successful requests", async () => {
        const client = new QueryClient();
        let calls = 0;
        const sets: FullBuildSets = {
            itemBootSet1: { "3118": [100, 50] },
            itemBootSet2: {},
            itemBootSet3: {},
            itemBootSet4: {},
            itemBootSet5: {},
            itemBootSet6: {},
        };
        const loadSets = async () => {
            calls++;
            return sets;
        };
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
        );
        expect(result.buildPaths?.byLength).toHaveLength(6);
        expect(result.buildPaths?.dataRange).toBe("current-patch");
        await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
        );
        expect(calls).toBe(2);
        client.clear();
    });

    test("purchase data stays in the selected range and retries failed sources", async () => {
        const client = new QueryClient();
        let fail = true;
        let calls = 0;
        const sets: FullBuildSets = {
            itemBootSet1: { "3118": [100, 50] },
            itemBootSet2: {},
            itemBootSet3: {},
            itemBootSet4: {},
            itemBootSet5: {},
            itemBootSet6: {},
        };
        const loadSets = async (request: BuildRequest) => {
            calls++;
            if (fail && request.patch !== "30") throw new Error("offline");
            return sets;
        };
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
        );
        expect(result.buildPaths).toBeUndefined();
        expect(result.coreRecommendations.dataRange).toBe("current-patch");
        expect(result.coreRecommendations.options).toEqual([]);
        fail = false;
        const retried = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            loadSets,
        );
        expect(retried.buildPaths?.dataRange).toBe("current-patch");
        expect(calls).toBe(3);
        client.clear();
    });

    test("purchase endpoint failures preserve other build data and expose retry warnings", async () => {
        const client = new QueryClient();
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            new Map(),
            loadBuild,
            async () => {
                throw new Error("offline");
            },
        );
        expect(result.buildPaths).toBeUndefined();
        expect(result.partialDataset.games).toBe(1000);
        expect(result.warnings[0]).toContain(
            "Build-path recommendations are unavailable",
        );
        client.clear();
    });

    test("requests patch, month, and each matchup and reuses cached responses", async () => {
        const client = new QueryClient();
        const requests: BuildRequest[] = [];
        const load = async (request: BuildRequest) => {
            requests.push(request);
            return loadBuild(request);
        };
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            load,
        );
        expect(requests).toHaveLength(5);
        expect(requests[0].patch).toBe("16.17");
        expect(requests[3].matchupId).toBe("MonkeyKing");
        expect(result.fullDataset.matchups).toHaveLength(2);
        expect(result.warnings).toEqual([]);
        await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            load,
        );
        expect(requests).toHaveLength(5);
        client.clear();
    });

    test("keeps successful matchups and retries only missing data", async () => {
        const client = new QueryClient();
        let fail = true;
        let calls = 0;
        const load = async (request: BuildRequest) => {
            calls++;
            if (fail && request.matchupId === "Zed")
                throw new Error("HTTP 404");
            return loadBuild(request);
        };
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            load,
        );
        expect(result.fullDataset.matchups).toHaveLength(1);
        expect(result.warnings[0]).toContain("1 matchup");
        fail = false;
        const retried = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            load,
        );
        expect(retried.warnings).toEqual([]);
        expect(calls).toBe(6);
        client.clear();
    });

    test("falls back to 30 days when current patch is unavailable", async () => {
        const client = new QueryClient();
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            async (request) => {
                if (request.patch !== "30") throw new Error("new patch");
                return loadBuild(request);
            },
        );
        expect(result.warnings[0]).toContain(
            "Current-patch data is unavailable",
        );
        expect(result.runeRecommendations.options).toEqual([]);
        expect(result.fullDataset.matchups).toHaveLength(2);
        client.clear();
    });

    test("does not mix current-patch priors with 30-day matchups", async () => {
        const client = new QueryClient();
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            async (request) => {
                if (request.patch === "30" && !request.matchupId)
                    throw new Error("month unavailable");
                return loadBuild(request);
            },
        );
        expect(result.warnings).toEqual([]);
        expect(result.fullDataset.matchups).toEqual([]);
        client.clear();
    });

    test("reports complete failure and rejects incorrect response identities", async () => {
        const client = new QueryClient();
        await expect(
            fetchBuildData(
                client,
                dataset(),
                "103",
                Role.Middle,
                new Map(),
                async () => {
                    throw new Error("offline");
                },
            ),
        ).rejects.toThrow("offline");
        await expect(
            fetchBuildData(
                client,
                dataset(),
                "103",
                Role.Middle,
                new Map(),
                async (request) => ({
                    ...buildData(request.patch),
                    header: { ...buildData(request.patch).header, cid: 1 },
                }),
            ),
        ).rejects.toThrow("different champion");
        const result = await fetchBuildData(
            client,
            dataset(),
            "103",
            Role.Middle,
            enemies,
            async (request) => buildData(request.patch),
        );
        expect(result.fullDataset.matchups).toHaveLength(0);
        expect(result.warnings[0]).toContain("2 matchups");
        client.clear();
    });

    test("produces finite analysis with missing rune and skill observations", () => {
        const metadata = dataset();
        const partial = partialDatasetFromLolalyticsData(
            metadata,
            "103",
            Role.Middle,
            buildData(),
        );
        const sparse = partialDatasetFromLolalyticsData(
            metadata,
            "103",
            Role.Middle,
            buildData("30"),
        );
        sparse.runes.primary = {};
        sparse.skills.level = [];
        sparse.skills.order = {} as typeof sparse.skills.order;
        const full = {
            ...sparse,
            matchups: [{ ...sparse, championKey: "238" }],
        };
        const result = analyzeBuild(metadata, metadata, partial, full, {
            riskLevel: "medium",
            minGames: 0,
            championWinrateInfluence: 100,
            matchupRoleWeights: DEFAULT_ROLE_WEIGHTS,
            duoRoleWeights: DEFAULT_ROLE_WEIGHTS,
        });
        const check = (value: unknown) => {
            if (typeof value === "number")
                expect(Number.isFinite(value)).toBe(true);
            else if (value && typeof value === "object")
                Object.values(value).forEach(check);
        };
        check(result);
    });
});
