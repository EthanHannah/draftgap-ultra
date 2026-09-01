import { describe, expect, test } from "bun:test";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { ChampionData } from "../models/dataset/ChampionData";
import { Dataset } from "../models/dataset/Dataset";
import { DEFAULT_ROLE_WEIGHTS, Role, ROLES } from "../models/Role";
import { SuggestionConfig, getSuggestions } from "./suggestions";

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

function makeViable(
    dataset: Dataset,
    championKey: string,
    role: Role,
    games = 100,
) {
    const stats = dataset.championData[championKey].statsByRole[role];
    stats.games = games;
    stats.wins = games / 2;
}

function setDuo(
    dataset: Dataset,
    championKey: string,
    role: Role,
    teammateKey: string,
    teammateRole: Role,
    wins: number,
) {
    dataset.championData[championKey].statsByRole[role].synergy[teammateRole][
        teammateKey
    ] = {
        championKey: teammateKey,
        games: 100,
        wins,
    };
    dataset.championData[teammateKey].statsByRole[teammateRole].synergy[role][
        championKey
    ] = {
        championKey,
        games: 100,
        wins,
    };
}

function setMatchup(
    dataset: Dataset,
    championKey: string,
    role: Role,
    opponentKey: string,
    opponentRole: Role,
    wins: number,
) {
    dataset.championData[championKey].statsByRole[role].matchup[opponentRole][
        opponentKey
    ] = {
        championKey: opponentKey,
        games: 100,
        wins,
    };
    dataset.championData[opponentKey].statsByRole[opponentRole].matchup[role][
        championKey
    ] = {
        championKey,
        games: 100,
        wins: 100 - wins,
    };
}

function createBlindabilityDataset() {
    const dataset = createDataset([
        "stable",
        "volatile",
        "allyA",
        "allyB",
        "enemyA",
        "enemyB",
        "lowGamesEnemy",
    ]);

    makeViable(dataset, "stable", Role.Top);
    makeViable(dataset, "volatile", Role.Top);
    makeViable(dataset, "allyA", Role.Jungle);
    makeViable(dataset, "allyB", Role.Jungle);
    makeViable(dataset, "enemyA", Role.Middle);
    makeViable(dataset, "enemyB", Role.Middle);
    makeViable(dataset, "lowGamesEnemy", Role.Middle, 1);

    setDuo(dataset, "stable", Role.Top, "allyA", Role.Jungle, 50);
    setDuo(dataset, "stable", Role.Top, "allyB", Role.Jungle, 50);
    setDuo(dataset, "volatile", Role.Top, "allyA", Role.Jungle, 70);
    setDuo(dataset, "volatile", Role.Top, "allyB", Role.Jungle, 30);

    setMatchup(dataset, "stable", Role.Top, "enemyA", Role.Middle, 50);
    setMatchup(dataset, "stable", Role.Top, "enemyB", Role.Middle, 50);
    setMatchup(dataset, "volatile", Role.Top, "enemyA", Role.Middle, 70);
    setMatchup(dataset, "volatile", Role.Top, "enemyB", Role.Middle, 30);
    setMatchup(dataset, "stable", Role.Top, "lowGamesEnemy", Role.Middle, 100);

    return dataset;
}

const defaultConfig: SuggestionConfig = {
    championWinrateInfluence: 100,
    riskLevel: "medium",
    minGames: 1,
    matchupRoleWeights: { ...DEFAULT_ROLE_WEIGHTS },
    duoRoleWeights: { ...DEFAULT_ROLE_WEIGHTS },
    synergyBlindabilityWeight: 100,
    matchupBlindabilityWeight: 100,
};

function findTopSuggestion(
    suggestions: ReturnType<typeof getSuggestions>,
    championKey: string,
) {
    return suggestions.find(
        (suggestion) =>
            suggestion.championKey === championKey &&
            suggestion.role === Role.Top,
    )!;
}

describe("suggestion blindability", () => {
    test("rewards a smaller gap relative to same-role peers and sorts by adjusted winrate", () => {
        const dataset = createBlindabilityDataset();
        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const stable = findTopSuggestion(suggestions, "stable");
        const volatile = findTopSuggestion(suggestions, "volatile");

        expect(stable.blindabilityResult.synergyGap).toBeLessThan(
            volatile.blindabilityResult.synergyGap,
        );
        expect(stable.blindabilityResult.matchupGap).toBeLessThan(
            volatile.blindabilityResult.matchupGap,
        );
        expect(stable.blindabilityResult.synergyRating).toBeCloseTo(
            (volatile.blindabilityResult.synergyGap / 2 / 9) *
                stable.blindabilityResult.synergyConfidence,
        );
        expect(stable.blindabilityResult.matchupRating).toBeCloseTo(
            (volatile.blindabilityResult.matchupGap / 2 / 9) *
                stable.blindabilityResult.matchupConfidence,
        );
        expect(stable.blindabilityResult.totalRating).toBeGreaterThan(0);
        expect(volatile.blindabilityResult.totalRating).toBeLessThan(0);
        expect(
            suggestions.findIndex(
                (suggestion) => suggestion.championKey === "stable",
            ),
        ).toBeLessThan(
            suggestions.findIndex(
                (suggestion) => suggestion.championKey === "volatile",
            ),
        );
    });

    test("scales synergy and matchup components independently", () => {
        const dataset = createBlindabilityDataset();
        const full = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map(),
                defaultConfig,
            ),
            "stable",
        );
        const halfSynergy = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...defaultConfig,
                synergyBlindabilityWeight: 50,
                matchupBlindabilityWeight: 0,
            }),
            "stable",
        );
        const disabled = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...defaultConfig,
                synergyBlindabilityWeight: 0,
                matchupBlindabilityWeight: 0,
            }),
            "stable",
        );

        expect(halfSynergy.blindabilityResult.synergyRating).toBeCloseTo(
            full.blindabilityResult.synergyRating * 0.5,
        );
        expect(halfSynergy.blindabilityResult.matchupRating).toBe(0);
        expect(disabled.blindabilityResult.totalRating).toBe(0);
        expect(disabled.blindabilityResult.adjustedWinrate).toBeCloseTo(
            disabled.draftResult.winrate,
        );
    });

    test("keeps sparse interaction data neutral instead of treating it as blindable", () => {
        const dataset = createBlindabilityDataset();
        dataset.championData.unsupported = createChampion("unsupported");
        makeViable(dataset, "unsupported", Role.Top);

        const unsupported = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map(),
                defaultConfig,
            ),
            "unsupported",
        );

        expect(unsupported.blindabilityResult.synergyGap).toBe(0);
        expect(unsupported.blindabilityResult.matchupGap).toBe(0);
        expect(unsupported.blindabilityResult.synergyConfidence).toBe(0);
        expect(unsupported.blindabilityResult.matchupConfidence).toBe(0);
        expect(unsupported.blindabilityResult.totalRating).toBe(0);
    });

    test("removes gap contributions as ally and enemy roles become known", () => {
        const dataset = createBlindabilityDataset();
        const allyRevealed = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map([[Role.Jungle, "allyA"]]),
                new Map(),
                defaultConfig,
            ),
            "volatile",
        );
        const enemyRevealed = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map([[Role.Middle, "enemyA"]]),
                defaultConfig,
            ),
            "volatile",
        );

        expect(allyRevealed.blindabilityResult.synergyGap).toBe(0);
        expect(allyRevealed.blindabilityResult.synergyConfidence).toBe(0);
        expect(enemyRevealed.blindabilityResult.matchupGap).toBe(0);
        expect(enemyRevealed.blindabilityResult.matchupConfidence).toBe(0);
    });

    test("excludes bans and champions below the games threshold from possible counterparts", () => {
        const dataset = createBlindabilityDataset();
        const stable = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map(),
                defaultConfig,
            ),
            "stable",
        );
        const volatileWithBan = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map(),
                defaultConfig,
                ["enemyB"],
            ),
            "volatile",
        );

        expect(stable.blindabilityResult.matchupGap).toBe(0);
        expect(volatileWithBan.blindabilityResult.matchupGap).toBe(0);
    });

    test("returns finite zero adjustments for single-candidate and empty pools", () => {
        const dataset = createBlindabilityDataset();
        delete dataset.championData.volatile;
        const single = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map(),
                defaultConfig,
            ),
            "stable",
        );
        const empty = getSuggestions(dataset, dataset, new Map(), new Map(), {
            ...defaultConfig,
            minGames: 1000,
        });

        expect(single.blindabilityResult.totalRating).toBe(0);
        expect(Number.isFinite(single.blindabilityResult.adjustedWinrate)).toBe(
            true,
        );
        expect(empty).toEqual([]);
    });
});
