import { describe, expect, test } from "bun:test";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { ChampionData } from "../models/dataset/ChampionData";
import { Dataset } from "../models/dataset/Dataset";
import { Role, ROLES } from "../models/Role";
import { analyzeChampion, analyzeDuo, analyzeMatchup } from "./analysis";
import { getPairPriorGames } from "./pair-prior";
import { getRarePickWinrate } from "./rare-pick-prior";

const PAIR_GAMES = 10_000;

function createChampion(key: string): ChampionData {
    return {
        id: key,
        key,
        name: key,
        i18n: {},
        statsByRole: Object.fromEntries(
            ROLES.map((role) => [role, defaultChampionRoleData()]),
        ) as ChampionData["statsByRole"],
    };
}

function createDataset(keys: string[]): Dataset {
    return {
        version: "test",
        date: "test",
        championData: Object.fromEntries(
            keys.map((key) => [key, createChampion(key)]),
        ),
        itemData: {},
        runeData: {},
        runePathData: {},
        statShardData: {},
        summonerSpellData: {},
    };
}

// Six top laners face six junglers (36 pairs, 360k games). Matchups alternate
// between +2% and -2% so every champion still averages 50%; duos are all
// neutral. The true matchup variance is 0.02², so the fitted pseudo-games are
// 0.25 / (0.02² - 0.25 / 10,000) ≈ 667 at Medium risk.
function createLargeDataset() {
    const tops = Array.from({ length: 6 }, (_, i) => `t${i}`);
    const junglers = Array.from({ length: 6 }, (_, i) => `j${i}`);
    const dataset = createDataset([...tops, ...junglers]);
    for (const [i, top] of tops.entries()) {
        for (const [j, jungler] of junglers.entries()) {
            const effect = (i + j) % 2 ? 0.02 : -0.02;
            const topStats = dataset.championData[top].statsByRole[Role.Top];
            const jungleStats =
                dataset.championData[jungler].statsByRole[Role.Jungle];
            topStats.matchup[Role.Jungle][jungler] = {
                championKey: jungler,
                games: PAIR_GAMES,
                wins: PAIR_GAMES * (0.5 + effect),
            };
            jungleStats.matchup[Role.Top][top] = {
                championKey: top,
                games: PAIR_GAMES,
                wins: PAIR_GAMES * (0.5 - effect),
            };
            topStats.synergy[Role.Jungle][jungler] = {
                championKey: jungler,
                games: PAIR_GAMES,
                wins: PAIR_GAMES / 2,
            };
            jungleStats.synergy[Role.Top][top] = {
                championKey: top,
                games: PAIR_GAMES,
                wins: PAIR_GAMES / 2,
            };
        }
    }
    for (const key of tops)
        Object.assign(dataset.championData[key].statsByRole[Role.Top], {
            games: PAIR_GAMES * 6,
            wins: PAIR_GAMES * 3,
        });
    for (const key of junglers)
        Object.assign(dataset.championData[key].statsByRole[Role.Jungle], {
            games: PAIR_GAMES * 6,
            wins: PAIR_GAMES * 3,
        });
    return dataset;
}

const matchupEffect = (
    dataset: Dataset,
    a: Role,
    keyA: string,
    b: Role,
    keyB: string,
) => analyzeMatchup(dataset, a, keyA, b, keyB, 0);
const duoEffect = (
    dataset: Dataset,
    a: Role,
    keyA: string,
    b: Role,
    keyB: string,
) => analyzeDuo(dataset, a, keyA, b, keyB, 0);

describe("per-pair prior games", () => {
    test("fits pseudo-games to the measured spread of each role pair", () => {
        const dataset = createLargeDataset();
        const fitted = getPairPriorGames(
            dataset,
            "matchup",
            Role.Top,
            Role.Jungle,
            1000,
            matchupEffect,
        );
        expect(fitted).toBeCloseTo(0.25 / (0.02 ** 2 - 0.25 / PAIR_GAMES), 0);
        // One estimate per unordered role pair.
        expect(
            getPairPriorGames(
                dataset,
                "matchup",
                Role.Jungle,
                Role.Top,
                1000,
                matchupEffect,
            ),
        ).toBe(fitted);
        // Risk levels scale caution relative to Medium.
        expect(
            getPairPriorGames(
                dataset,
                "matchup",
                Role.Top,
                Role.Jungle,
                2000,
                matchupEffect,
            ),
        ).toBeCloseTo(fitted * 2, 6);
        // A role pair without real spread is held near neutral.
        expect(
            getPairPriorGames(
                dataset,
                "synergy",
                Role.Top,
                Role.Jungle,
                1000,
                duoEffect,
            ),
        ).toBe(100_000);
    });

    test("strong pairs keep more of their effect than the fixed prior allowed", () => {
        const dataset = createLargeDataset();
        const result = analyzeMatchup(
            dataset,
            Role.Top,
            "t0",
            Role.Jungle,
            "j1",
            2000,
        );
        const shrunk = result.rating;
        const raw = analyzeMatchup(
            dataset,
            Role.Top,
            "t0",
            Role.Jungle,
            "j1",
            0,
        ).rating;
        // Fitted Low-risk prior ≈ 1333 games against 10,000 observed.
        expect(shrunk / raw).toBeGreaterThan(10_000 / (10_000 + 2000));
        expect(shrunk / raw).toBeCloseTo(10_000 / (10_000 + 1333.3), 2);
    });

    test("small datasets keep the risk level's fixed pseudo-games", () => {
        const dataset = createDataset(["a", "b"]);
        expect(
            getPairPriorGames(
                dataset,
                "matchup",
                Role.Top,
                Role.Top,
                2000,
                matchupEffect,
            ),
        ).toBe(2000);
        expect(
            getPairPriorGames(
                createLargeDataset(),
                "matchup",
                Role.Top,
                Role.Jungle,
                0,
                matchupEffect,
            ),
        ).toBe(0);
    });
});

describe("rare-pick prior", () => {
    test("a tiny off-role sample is shrunk toward what rare picks win", () => {
        const dataset = createDataset(["main", "rareA", "rareB", "offRole"]);
        Object.assign(dataset.championData.main.statsByRole[Role.Jungle], {
            games: 100_000,
            wins: 51_000,
        });
        Object.assign(dataset.championData.rareA.statsByRole[Role.Jungle], {
            games: 3000,
            wins: 1200,
        });
        Object.assign(dataset.championData.rareB.statsByRole[Role.Jungle], {
            games: 1000,
            wins: 400,
        });
        Object.assign(dataset.championData.offRole.statsByRole[Role.Jungle], {
            games: 5,
            wins: 5,
        });
        // The off-role sample itself is one of the rare picks.
        expect(getRarePickWinrate(dataset, Role.Jungle)).toBeCloseTo(
            (1200 + 400 + 5) / (3000 + 1000 + 5),
            10,
        );

        const winrate = (key: string) => {
            const { rating } = analyzeChampion(
                dataset,
                dataset,
                Role.Jungle,
                key,
                2000,
            );
            return 1 / (1 + 10 ** (-rating / 400));
        };
        // Five straight wins are evidence, not a 2000-game prior at 100%.
        expect(winrate("offRole")).toBeLessThan(0.41);
        expect(winrate("offRole")).toBeGreaterThan(0.4);
        // Main-role samples are effectively unchanged.
        expect(winrate("main")).toBeCloseTo(0.51, 2);
    });
});
