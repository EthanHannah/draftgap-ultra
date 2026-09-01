import { describe, expect, test } from "bun:test";
import { analyzeChampions, analyzeDuos, analyzeMatchups } from "./analysis";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { ChampionData } from "../models/dataset/ChampionData";
import { Dataset } from "../models/dataset/Dataset";
import { DEFAULT_ROLE_WEIGHTS, Role, RoleWeights, ROLES } from "../models/Role";

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

function createDataset() {
    const top = createChampion("top");
    const jungle = createChampion("jungle");
    const support = createChampion("support");
    const topStats = top.statsByRole[Role.Top];
    const jungleStats = jungle.statsByRole[Role.Jungle];
    const supportStats = support.statsByRole[Role.Support];

    topStats.games = 100;
    topStats.wins = 50;
    jungleStats.games = 100;
    jungleStats.wins = 50;
    supportStats.games = 100;
    supportStats.wins = 50;

    topStats.synergy[Role.Jungle].jungle = {
        championKey: "jungle",
        games: 100,
        wins: 60,
    };
    jungleStats.synergy[Role.Top].top = {
        championKey: "top",
        games: 100,
        wins: 60,
    };
    topStats.matchup[Role.Jungle].jungle = {
        championKey: "jungle",
        games: 100,
        wins: 60,
    };
    jungleStats.matchup[Role.Top].top = {
        championKey: "top",
        games: 100,
        wins: 40,
    };
    topStats.matchup[Role.Support].support = {
        championKey: "support",
        games: 100,
        wins: 55,
    };
    supportStats.matchup[Role.Top].top = {
        championKey: "top",
        games: 100,
        wins: 45,
    };

    return {
        version: "test",
        date: "test",
        championData: { top, jungle, support },
        itemData: {},
        runeData: {},
        runePathData: {},
        statShardData: {},
        summonerSpellData: {},
    } satisfies Dataset;
}

function weights(top: number, jungle: number): RoleWeights {
    return {
        ...DEFAULT_ROLE_WEIGHTS,
        [Role.Top]: top,
        [Role.Jungle]: jungle,
    };
}

describe("role influence weights", () => {
    const team = new Map([
        [Role.Top, "top"],
        [Role.Jungle, "jungle"],
    ]);

    test("disables duo ratings when either role has zero influence", () => {
        const dataset = createDataset();
        const defaultRating = analyzeDuos(dataset, team, 0).totalRating;
        const zeroRating = analyzeDuos(
            dataset,
            team,
            0,
            weights(0, 100),
        ).totalRating;

        expect(defaultRating).not.toBe(0);
        expect(zeroRating).toBe(0);
    });

    test("applies matchup influence to the enemy role only", () => {
        const dataset = createDataset();
        const ally = new Map([[Role.Top, "top"]]);
        const enemy = new Map([[Role.Jungle, "jungle"]]);
        const defaultRating = analyzeMatchups(
            dataset,
            ally,
            enemy,
            0,
        ).totalRating;
        const allyRoleDisabledRating = analyzeMatchups(
            dataset,
            ally,
            enemy,
            0,
            weights(0, 100),
        ).totalRating;
        const enemyRoleDisabledRating = analyzeMatchups(
            dataset,
            ally,
            enemy,
            0,
            weights(100, 0),
        ).totalRating;

        expect(defaultRating).not.toBe(0);
        expect(allyRoleDisabledRating).toBeCloseTo(defaultRating);
        expect(enemyRoleDisabledRating).toBe(0);
    });

    test("only includes enabled enemy roles in matchup analysis", () => {
        const dataset = createDataset();
        const ally = new Map([[Role.Top, "top"]]);
        const enemy = new Map([
            [Role.Jungle, "jungle"],
            [Role.Support, "support"],
        ]);
        const supportOnlyWeights = {
            ...DEFAULT_ROLE_WEIGHTS,
            [Role.Top]: 0,
            [Role.Jungle]: 0,
            [Role.Middle]: 0,
            [Role.Bottom]: 0,
        };
        const result = analyzeMatchups(
            dataset,
            ally,
            enemy,
            0,
            supportOnlyWeights,
        );

        expect(
            result.matchupResults.find(
                (matchup) => matchup.roleB === Role.Jungle,
            )?.rating,
        ).toBe(0);
        expect(
            result.matchupResults.find(
                (matchup) => matchup.roleB === Role.Support,
            )?.rating,
        ).not.toBe(0);
    });

    test("averages non-zero duo role influence weights", () => {
        const dataset = createDataset();
        const defaultRating = analyzeDuos(dataset, team, 0).totalRating;
        const threeQuarterRating = analyzeDuos(
            dataset,
            team,
            0,
            weights(50, 100),
        ).totalRating;

        expect(threeQuarterRating).toBeCloseTo(defaultRating * 0.75);
    });
});

describe("champion winrate influence", () => {
    test("scales individual champion ratings by the configured percentage", () => {
        const dataset = createDataset();
        dataset.championData.top.statsByRole[Role.Top].wins = 60;
        const team = new Map([[Role.Top, "top"]]);

        const fullRating = analyzeChampions(dataset, dataset, team, 0, 100);
        const halfRating = analyzeChampions(dataset, dataset, team, 0, 50);
        const zeroRating = analyzeChampions(dataset, dataset, team, 0, 0);

        expect(halfRating.totalRating).toBeCloseTo(
            fullRating.totalRating * 0.5,
        );
        expect(halfRating.championResults[0].rating).toBeCloseTo(
            fullRating.championResults[0].rating * 0.5,
        );
        expect(zeroRating.totalRating).toBe(0);
    });
});
