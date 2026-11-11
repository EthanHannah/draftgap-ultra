import { describe, expect, test } from "bun:test";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { ChampionData } from "../models/dataset/ChampionData";
import { Dataset } from "../models/dataset/Dataset";
import { Role, ROLES } from "../models/Role";
import { analyzeDuo, analyzeMatchup } from "./analysis";
import { getViewRatingOffset } from "./view-baseline";

const GAMES = 1_000_000;

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

// Ten junglers face ten top laners. "skewed" wins 52% by its own rows, but
// its opponents' rows record it winning 50%; every other pair agrees on 50%.
// This mirrors the real dataset, where each champion's rows are sampled from
// its own players and the two views of the same pairing can disagree.
function createDataset(field: "matchup" | "synergy") {
    const junglers = [
        "skewed",
        ...Array.from({ length: 9 }, (_, i) => `j${i}`),
    ];
    const tops = Array.from({ length: 10 }, (_, i) => `t${i}`);
    const dataset: Dataset = {
        version: "test",
        date: "test",
        championData: Object.fromEntries(
            [...junglers, ...tops].map((key) => [key, createChampion(key)]),
        ),
        itemData: {},
        runeData: {},
        runePathData: {},
        statShardData: {},
        summonerSpellData: {},
    };
    for (const jungler of junglers) {
        const own = dataset.championData[jungler].statsByRole[Role.Jungle];
        own.games = GAMES * tops.length;
        own.wins = own.games * (jungler === "skewed" ? 0.52 : 0.5);
        for (const top of tops) {
            own[field][Role.Top][top] = {
                championKey: top,
                games: GAMES,
                wins: GAMES * (jungler === "skewed" ? 0.52 : 0.5),
            };
        }
    }
    for (const top of tops) {
        const own = dataset.championData[top].statsByRole[Role.Top];
        own.games = GAMES * junglers.length;
        own.wins = own.games / 2;
        for (const jungler of junglers) {
            own[field][Role.Jungle][jungler] = {
                championKey: jungler,
                games: GAMES,
                wins: GAMES / 2,
            };
        }
    }
    return dataset;
}

describe("view baseline", () => {
    test("a one-sided view disagreement no longer shifts every matchup", () => {
        const dataset = createDataset("matchup");
        const effect = analyzeMatchup(
            dataset,
            Role.Jungle,
            "skewed",
            Role.Top,
            "t0",
            0,
        );
        // Both views average to 51%, against an own win rate of 52%. Without
        // the offset every matchup would read about one point below expected.
        expect(Math.abs(effect.wins / effect.games - 0.5)).toBeLessThan(0.002);
        expect(
            getViewRatingOffset(dataset, "skewed", Role.Jungle, "matchup"),
        ).toBeLessThan(0);
        expect(getViewRatingOffset(dataset, "j0", Role.Jungle, "matchup")).toBe(
            0,
        );
    });

    test("the same correction applies to duo rows", () => {
        const dataset = createDataset("synergy");
        const effect = analyzeDuo(
            dataset,
            Role.Jungle,
            "skewed",
            Role.Top,
            "t0",
            0,
        );
        expect(Math.abs(effect.wins / effect.games - 0.5)).toBeLessThan(0.002);
    });

    test("symmetric views and sparse disagreements leave baselines alone", () => {
        const dataset = createDataset("matchup");
        expect(getViewRatingOffset(dataset, "j3", Role.Jungle, "matchup")).toBe(
            0,
        );
        // A champion with no rows has nothing to correct.
        expect(
            getViewRatingOffset(dataset, "skewed", Role.Middle, "matchup"),
        ).toBe(0);
        const sparse = createDataset("matchup");
        for (const row of Object.values(
            sparse.championData.skewed.statsByRole[Role.Jungle].matchup[
                Role.Top
            ],
        )) {
            row.games = 10;
            row.wins = 5.2;
        }
        for (const top of Object.keys(sparse.championData).filter((key) =>
            key.startsWith("t"),
        )) {
            const row =
                sparse.championData[top].statsByRole[Role.Top].matchup[
                    Role.Jungle
                ].skewed;
            row.games = 10;
            row.wins = 5;
        }
        expect(
            Math.abs(
                getViewRatingOffset(sparse, "skewed", Role.Jungle, "matchup"),
            ),
        ).toBeLessThan(
            Math.abs(
                getViewRatingOffset(dataset, "skewed", Role.Jungle, "matchup"),
            ) * 0.02,
        );
    });
});
