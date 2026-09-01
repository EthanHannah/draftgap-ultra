import { describe, expect, test } from "bun:test";
import {
    analyzeChampions,
    analyzeDuo,
    analyzeDraft,
    analyzeDraftWithRoleUncertainty,
    analyzeDuos,
    analyzeMatchup,
    analyzeMatchups,
} from "./analysis";
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

describe("interaction sample-size shrinkage", () => {
    test("trusts the same observed result more as its sample grows", () => {
        const sparse = createDataset();
        const dense = createDataset();
        const denseTop = dense.championData.top.statsByRole[Role.Top];
        const denseJungle = dense.championData.jungle.statsByRole[Role.Jungle];

        denseTop.synergy[Role.Jungle].jungle = {
            championKey: "jungle",
            games: 1000,
            wins: 600,
        };
        denseJungle.synergy[Role.Top].top = {
            championKey: "top",
            games: 1000,
            wins: 600,
        };
        denseTop.matchup[Role.Jungle].jungle = {
            championKey: "jungle",
            games: 1000,
            wins: 600,
        };
        denseJungle.matchup[Role.Top].top = {
            championKey: "top",
            games: 1000,
            wins: 400,
        };

        const sparseDuo = analyzeDuo(
            sparse,
            Role.Top,
            "top",
            Role.Jungle,
            "jungle",
            1000,
        );
        const denseDuo = analyzeDuo(
            dense,
            Role.Top,
            "top",
            Role.Jungle,
            "jungle",
            1000,
        );
        const sparseMatchup = analyzeMatchup(
            sparse,
            Role.Top,
            "top",
            Role.Jungle,
            "jungle",
            1000,
        );
        const denseMatchup = analyzeMatchup(
            dense,
            Role.Top,
            "top",
            Role.Jungle,
            "jungle",
            1000,
        );

        expect(denseDuo.rating).toBeGreaterThan(sparseDuo.rating);
        expect(denseMatchup.rating).toBeGreaterThan(sparseMatchup.rating);
    });

    test("trusts sparse interactions monotonically more at higher risk", () => {
        const dataset = createDataset();
        const priorGames = [3000, 2000, 1000, 500, 250];
        const duoRatings = priorGames.map(
            (prior) =>
                analyzeDuo(
                    dataset,
                    Role.Top,
                    "top",
                    Role.Jungle,
                    "jungle",
                    prior,
                ).rating,
        );
        const matchupRatings = priorGames.map(
            (prior) =>
                analyzeMatchup(
                    dataset,
                    Role.Top,
                    "top",
                    Role.Jungle,
                    "jungle",
                    prior,
                ).rating,
        );

        for (let i = 1; i < priorGames.length; i++) {
            expect(duoRatings[i]).toBeGreaterThan(duoRatings[i - 1]);
            expect(matchupRatings[i]).toBeGreaterThan(matchupRatings[i - 1]);
        }
    });
});

describe("flex-pick uncertainty", () => {
    test("averages draft results across role assignments by probability", () => {
        const dataset = createDataset();
        const topStats = dataset.championData.top.statsByRole[Role.Top];
        const jungleStats = dataset.championData.top.statsByRole[Role.Jungle];
        topStats.games = 100;
        topStats.wins = 60;
        jungleStats.games = 100;
        jungleStats.wins = 40;
        const config = {
            championWinrateInfluence: 100,
            riskLevel: "medium" as const,
            minGames: 0,
            matchupRoleWeights: DEFAULT_ROLE_WEIGHTS,
            duoRoleWeights: DEFAULT_ROLE_WEIGHTS,
        };
        const top = analyzeDraft(
            dataset,
            dataset,
            new Map([[Role.Top, "top"]]),
            new Map(),
            config,
        );
        const jungle = analyzeDraft(
            dataset,
            dataset,
            new Map([[Role.Jungle, "top"]]),
            new Map(),
            config,
        );

        const uncertain = analyzeDraftWithRoleUncertainty(
            dataset,
            dataset,
            [
                [new Map([[Role.Top, "top"]]), 0.75],
                [new Map([[Role.Jungle, "top"]]), 0.25],
            ],
            [[new Map(), 1]],
            config,
        );

        expect(uncertain.totalRating).toBeCloseTo(
            top.totalRating * 0.75 + jungle.totalRating * 0.25,
        );
        expect(uncertain.winrate).toBeCloseTo(
            top.winrate * 0.75 + jungle.winrate * 0.25,
        );
        expect(uncertain.allyChampionRating.championResults[0].role).toBe(
            Role.Top,
        );
    });
});
