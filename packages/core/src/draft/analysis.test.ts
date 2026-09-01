import { describe, expect, test } from "bun:test";
import { analyzeDuos, analyzeMatchups } from "./analysis";
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
    const topStats = top.statsByRole[Role.Top];
    const jungleStats = jungle.statsByRole[Role.Jungle];

    topStats.games = 100;
    topStats.wins = 50;
    jungleStats.games = 100;
    jungleStats.wins = 50;

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

    return {
        version: "test",
        date: "test",
        championData: { top, jungle },
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

    test("scales duo ratings by the average weight of both roles", () => {
        const dataset = createDataset();
        const defaultRating = analyzeDuos(dataset, team, 0).totalRating;
        const halfRating = analyzeDuos(
            dataset,
            team,
            0,
            weights(0, 100),
        ).totalRating;

        expect(halfRating).toBeCloseTo(defaultRating * 0.5);
    });

    test("scales matchup ratings by the average weight of both roles", () => {
        const dataset = createDataset();
        const ally = new Map([[Role.Top, "top"]]);
        const enemy = new Map([[Role.Jungle, "jungle"]]);
        const defaultRating = analyzeMatchups(
            dataset,
            ally,
            enemy,
            0,
        ).totalRating;
        const halfRating = analyzeMatchups(
            dataset,
            ally,
            enemy,
            0,
            weights(0, 100),
        ).totalRating;

        expect(halfRating).toBeCloseTo(defaultRating * 0.5);
    });
});
