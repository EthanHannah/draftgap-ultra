import { describe, expect, test } from "bun:test";
import { Dataset } from "../models/dataset/Dataset";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { Role, ROLES } from "../models/Role";
import { getDraftPickDistribution, PickAnchor } from "./pick-distribution";

function fixture() {
    const dataset = {
        championData: Object.fromEntries(
            ["common", "rare", "anchor"].map((id) => [
                id,
                {
                    id,
                    key: id,
                    name: id,
                    i18n: {},
                    statsByRole: Object.fromEntries(
                        ROLES.map((role) => [role, defaultChampionRoleData()]),
                    ),
                },
            ]),
        ),
    } as unknown as Dataset;
    const pool = [
        { championKey: "common", pickWeight: 9000 },
        { championKey: "rare", pickWeight: 1000 },
    ];
    const anchor: PickAnchor = {
        championKey: "anchor",
        role: Role.Top,
        family: "matchup",
    };
    const setCounts = (common: number, rare: number) => {
        for (const [key, games] of [
            ["common", common],
            ["rare", rare],
        ] as const) {
            dataset.championData.anchor.statsByRole[Role.Top].matchup[
                Role.Middle
            ][key] = {
                championKey: key,
                games,
                wins: games / 2,
            };
        }
    };
    return { dataset, pool, anchor, setCounts };
}

describe("draft-conditioned pick forecasts", () => {
    test("missing pair evidence retains ordinary pick rates rather than uniform counter coverage", () => {
        const { dataset, pool, anchor } = fixture();
        const result = getDraftPickDistribution(dataset, Role.Middle, pool, [
            anchor,
        ]);
        expect(result.get("common")).toBeCloseTo(0.9);
        expect(result.get("rare")).toBeCloseTo(0.1);
        expect(
            getDraftPickDistribution(dataset, Role.Middle, [], [anchor]).size,
        ).toBe(0);
    });

    test("supported conditional selection increases rare-pick likelihood while sparse data stays near meta", () => {
        const { dataset, pool, anchor, setCounts } = fixture();
        setCounts(100, 900);
        const supported = getDraftPickDistribution(dataset, Role.Middle, pool, [
            anchor,
        ]).get("rare")!;
        setCounts(0.1, 0.9);
        const sparse = getDraftPickDistribution(dataset, Role.Middle, pool, [
            anchor,
        ]).get("rare")!;
        expect(supported).toBeGreaterThan(0.2);
        expect(supported).toBeLessThan(0.5);
        expect(sparse).toBeGreaterThan(0.1);
        expect(sparse - 0.1).toBeLessThan(0.001);
    });

    test("a huge sample for a rare pick cannot hide missing evidence for the common pick", () => {
        const { dataset, pool, anchor, setCounts } = fixture();
        setCounts(0, 1e7);
        const probability = getDraftPickDistribution(
            dataset,
            Role.Middle,
            pool,
            [anchor],
        ).get("rare")!;
        expect(probability).toBeGreaterThan(0.1);
        expect(probability).toBeLessThan(0.15);
    });

    test("reverse and forward records are two views, not twice the evidence", () => {
        const { dataset, pool, anchor, setCounts } = fixture();
        setCounts(100, 900);
        const before = getDraftPickDistribution(dataset, Role.Middle, pool, [
            anchor,
        ]);
        for (const key of ["common", "rare"]) {
            const pair =
                dataset.championData.anchor.statsByRole[Role.Top].matchup[
                    Role.Middle
                ][key];
            dataset.championData[key].statsByRole[Role.Middle].matchup[
                Role.Top
            ].anchor = {
                ...pair,
                championKey: "anchor",
            };
        }
        expect(
            getDraftPickDistribution(dataset, Role.Middle, pool, [anchor]),
        ).toEqual(before);
        expect(
            getDraftPickDistribution(dataset, Role.Middle, pool, [
                anchor,
                anchor,
            ]),
        ).toEqual(before);
    });

    test("uses the correct same-team relationship and excludes unavailable picks", () => {
        const { dataset, pool, anchor, setCounts } = fixture();
        setCounts(100, 900);
        const duoAnchor = { ...anchor, family: "duo" as const };
        expect(
            getDraftPickDistribution(dataset, Role.Middle, pool, [
                duoAnchor,
            ]).get("rare"),
        ).toBeCloseTo(0.1);
        dataset.championData.anchor.statsByRole[Role.Top].synergy[Role.Middle] =
            dataset.championData.anchor.statsByRole[Role.Top].matchup[
                Role.Middle
            ];
        expect(
            getDraftPickDistribution(dataset, Role.Middle, pool, [
                duoAnchor,
            ]).get("rare"),
        ).toBeGreaterThan(0.2);
        const available = getDraftPickDistribution(
            dataset,
            Role.Middle,
            pool.slice(0, 1),
            [anchor],
        );
        expect(available.get("common")).toBe(1);
        expect(available.has("rare")).toBe(false);
        const withAnchor = [
            ...pool,
            { championKey: "anchor", pickWeight: 10000 },
        ];
        expect(
            getDraftPickDistribution(dataset, Role.Middle, withAnchor, [
                anchor,
            ]).has("anchor"),
        ).toBe(false);
    });

    test("combines conflicting evidence without depending on anchor order", () => {
        const { dataset, pool, anchor, setCounts } = fixture();
        setCounts(100, 900);
        dataset.championData.anchor.statsByRole[Role.Top].synergy[Role.Middle] =
            {
                common: { championKey: "common", wins: 450, games: 900 },
                rare: { championKey: "rare", wins: 50, games: 100 },
            };
        const anchors = [anchor, { ...anchor, family: "duo" as const }];
        const result = getDraftPickDistribution(
            dataset,
            Role.Middle,
            pool,
            anchors,
        );
        const reverse = getDraftPickDistribution(
            dataset,
            Role.Middle,
            pool,
            anchors.reverse(),
        );
        expect(result.get("rare")).toBeCloseTo(reverse.get("rare")!, 12);
        expect([...result.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    });
});
