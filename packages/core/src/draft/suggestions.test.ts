import { describe, expect, test } from "bun:test";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import { ChampionData } from "../models/dataset/ChampionData";
import { Dataset } from "../models/dataset/Dataset";
import { DEFAULT_ROLE_WEIGHTS, Role, ROLES } from "../models/Role";
import {
    SuggestionConfig,
    getSuggestions,
    getSuggestionsWithRoleUncertainty,
} from "./suggestions";

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
    games = 100,
) {
    dataset.championData[championKey].statsByRole[role].matchup[opponentRole][
        opponentKey
    ] = {
        championKey: opponentKey,
        games,
        wins,
    };
    dataset.championData[opponentKey].statsByRole[opponentRole].matchup[role][
        championKey
    ] = {
        championKey,
        games,
        wins: games - wins,
    };
}

function setDamage(
    dataset: Dataset,
    championKey: string,
    role: Role,
    physical: number,
    magic: number,
    trueDamage = 0,
) {
    dataset.championData[championKey].statsByRole[role].damageProfile = {
        physical,
        magic,
        true: trueDamage,
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
    contextInfluence: 100,
    blindabilityWeight: 100,
    enemySafetyPriority: 75,
    compositionInfluence: 50,
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
    test("modestly penalizes worse ally-fit downside when expected synergy is equal", () => {
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
        expect(stable.blindabilityResult.synergyScore).toBeGreaterThan(
            volatile.blindabilityResult.synergyScore,
        );
        expect(stable.blindabilityResult.rating).toBeGreaterThan(0);
        expect(volatile.blindabilityResult.rating).toBeLessThan(0);
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

    test("rewards consistently strong interactions over consistently weak ones", () => {
        const dataset = createDataset([
            "strong",
            "weak",
            "allyA",
            "allyB",
            "enemyA",
            "enemyB",
        ]);
        makeViable(dataset, "strong", Role.Top);
        makeViable(dataset, "weak", Role.Top);
        makeViable(dataset, "allyA", Role.Jungle);
        makeViable(dataset, "allyB", Role.Jungle);
        makeViable(dataset, "enemyA", Role.Top);
        makeViable(dataset, "enemyB", Role.Top);

        setDuo(dataset, "strong", Role.Top, "allyA", Role.Jungle, 60);
        setDuo(dataset, "strong", Role.Top, "allyB", Role.Jungle, 60);
        setDuo(dataset, "weak", Role.Top, "allyA", Role.Jungle, 40);
        setDuo(dataset, "weak", Role.Top, "allyB", Role.Jungle, 40);
        setMatchup(dataset, "strong", Role.Top, "enemyA", Role.Top, 60);
        setMatchup(dataset, "strong", Role.Top, "enemyB", Role.Top, 60);
        setMatchup(dataset, "weak", Role.Top, "enemyA", Role.Top, 40);
        setMatchup(dataset, "weak", Role.Top, "enemyB", Role.Top, 40);

        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const strong = findTopSuggestion(suggestions, "strong");
        const weak = findTopSuggestion(suggestions, "weak");

        expect(strong.blindabilityResult.synergyGap).toBeCloseTo(
            weak.blindabilityResult.synergyGap,
        );
        expect(strong.blindabilityResult.synergyScore).toBeGreaterThan(
            weak.blindabilityResult.synergyScore,
        );
        expect(strong.blindabilityResult.matchupScore).toBeGreaterThan(
            weak.blindabilityResult.matchupScore,
        );
        expect(strong.blindabilityResult.rating).toBeGreaterThan(0);
        expect(weak.blindabilityResult.rating).toBeLessThan(0);
    });

    test("does not treat extra favorable matchups as additional blind safety", () => {
        const dataset = createDataset([
            "upside",
            "neutral",
            "enemyA",
            "enemyB",
            "enemyC",
        ]);
        makeViable(dataset, "upside", Role.Top);
        makeViable(dataset, "neutral", Role.Top);
        makeViable(dataset, "enemyA", Role.Top);
        makeViable(dataset, "enemyB", Role.Top);
        makeViable(dataset, "enemyC", Role.Top);

        setMatchup(dataset, "upside", Role.Top, "enemyA", Role.Top, 50);
        setMatchup(dataset, "upside", Role.Top, "enemyB", Role.Top, 50);
        setMatchup(dataset, "upside", Role.Top, "enemyC", Role.Top, 60);
        setMatchup(dataset, "neutral", Role.Top, "enemyA", Role.Top, 50);
        setMatchup(dataset, "neutral", Role.Top, "enemyB", Role.Top, 50);
        setMatchup(dataset, "neutral", Role.Top, "enemyC", Role.Top, 50);

        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const upside = findTopSuggestion(suggestions, "upside");
        const neutral = findTopSuggestion(suggestions, "neutral");

        expect(upside.blindabilityResult.matchupScore).toBeCloseTo(
            neutral.blindabilityResult.matchupScore,
        );
        expect(upside.blindabilityResult.rating).toBeCloseTo(
            neutral.blindabilityResult.rating,
        );
    });

    test("counts a hard counter more heavily than several ordinary counters", () => {
        const dataset = createDataset([
            "hardExposed",
            "softExposed",
            "enemyA",
            "enemyB",
        ]);
        for (const championKey of Object.keys(dataset.championData)) {
            makeViable(dataset, championKey, Role.Top);
        }

        setMatchup(dataset, "hardExposed", Role.Top, "enemyA", Role.Top, 0);
        setMatchup(dataset, "hardExposed", Role.Top, "enemyB", Role.Top, 60);
        setMatchup(dataset, "softExposed", Role.Top, "enemyA", Role.Top, 40);
        setMatchup(dataset, "softExposed", Role.Top, "enemyB", Role.Top, 40);

        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const hardExposed = findTopSuggestion(suggestions, "hardExposed");
        const softExposed = findTopSuggestion(suggestions, "softExposed");

        expect(hardExposed.blindabilityResult.hardCounterRate).toBeGreaterThan(
            softExposed.blindabilityResult.hardCounterRate,
        );
        expect(hardExposed.blindabilityResult.matchupScore).toBeLessThan(
            softExposed.blindabilityResult.matchupScore,
        );
    });

    test("changes counter exposure smoothly across the hard-counter threshold", () => {
        const dataset = createDataset([
            "justAbove",
            "justBelow",
            "neutral",
            "enemy",
        ]);
        for (const championKey of Object.keys(dataset.championData)) {
            makeViable(dataset, championKey, Role.Top);
        }

        setMatchup(dataset, "justAbove", Role.Top, "enemy", Role.Top, 29);
        setMatchup(dataset, "justBelow", Role.Top, "enemy", Role.Top, 28);

        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const justAbove = findTopSuggestion(suggestions, "justAbove");
        const justBelow = findTopSuggestion(suggestions, "justBelow");

        expect(justBelow.blindabilityResult.hardCounterRate).toBeGreaterThan(
            justAbove.blindabilityResult.hardCounterRate,
        );
        expect(justBelow.blindabilityResult.counterExposure).toBeGreaterThan(
            justAbove.blindabilityResult.counterExposure,
        );
        expect(justBelow.blindabilityResult.counterExposure).toBeLessThan(
            justAbove.blindabilityResult.counterExposure * 1.2,
        );
    });

    test("makes sparse negative matchups contribute less than established counters", () => {
        const dataset = createDataset([
            "sparseExposed",
            "supportedExposed",
            "neutral",
            "enemy",
        ]);
        for (const championKey of Object.keys(dataset.championData)) {
            makeViable(dataset, championKey, Role.Top);
        }

        setMatchup(dataset, "sparseExposed", Role.Top, "enemy", Role.Top, 0, 1);
        setMatchup(
            dataset,
            "supportedExposed",
            Role.Top,
            "enemy",
            Role.Top,
            40,
        );

        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const sparseExposed = findTopSuggestion(suggestions, "sparseExposed");
        const supportedExposed = findTopSuggestion(
            suggestions,
            "supportedExposed",
        );

        expect(
            sparseExposed.blindabilityResult.counterExposure,
        ).toBeGreaterThan(0);
        expect(sparseExposed.blindabilityResult.counterExposure).toBeLessThan(
            supportedExposed.blindabilityResult.counterExposure,
        );
        expect(sparseExposed.blindabilityResult.matchupScore).toBeGreaterThan(
            supportedExposed.blindabilityResult.matchupScore,
        );
    });

    test("scales counter exposure continuously with matchup role influence", () => {
        const dataset = createDataset(["candidate", "neutral", "enemy"]);
        for (const championKey of Object.keys(dataset.championData)) {
            makeViable(dataset, championKey, Role.Top);
        }
        setMatchup(dataset, "candidate", Role.Top, "enemy", Role.Top, 40);

        const getCandidateAtWeight = (weight: number) =>
            findTopSuggestion(
                getSuggestions(dataset, dataset, new Map(), new Map(), {
                    ...defaultConfig,
                    matchupRoleWeights: {
                        ...defaultConfig.matchupRoleWeights,
                        [Role.Top]: weight,
                    },
                }),
                "candidate",
            );
        const disabled = getCandidateAtWeight(0);
        const half = getCandidateAtWeight(50);
        const double = getCandidateAtWeight(200);

        expect(disabled.blindabilityResult.matchupScore).toBe(0);
        expect(half.blindabilityResult.matchupScore).toBeLessThan(0);
        expect(double.blindabilityResult.matchupScore).toBeCloseTo(
            half.blindabilityResult.matchupScore * 4,
        );
    });

    test("weights teammate fit by pick rate and counter exposure by blended coverage", () => {
        const dataset = createDataset([
            "commonFavored",
            "rareFavored",
            "neutral",
            "common",
            "rare",
        ]);
        makeViable(dataset, "commonFavored", Role.Top);
        makeViable(dataset, "rareFavored", Role.Top);
        makeViable(dataset, "neutral", Role.Top);
        makeViable(dataset, "common", Role.Jungle, 9000);
        makeViable(dataset, "rare", Role.Jungle, 1000);
        makeViable(dataset, "common", Role.Top, 9000);
        makeViable(dataset, "rare", Role.Top, 1000);

        for (const role of [Role.Jungle, Role.Top]) {
            const setInteraction = role === Role.Jungle ? setDuo : setMatchup;

            setInteraction(
                dataset,
                "commonFavored",
                Role.Top,
                "common",
                role,
                60,
            );
            setInteraction(
                dataset,
                "commonFavored",
                Role.Top,
                "rare",
                role,
                40,
            );
            setInteraction(
                dataset,
                "rareFavored",
                Role.Top,
                "common",
                role,
                40,
            );
            setInteraction(dataset, "rareFavored", Role.Top, "rare", role, 60);
            setInteraction(dataset, "neutral", Role.Top, "common", role, 50);
            setInteraction(dataset, "neutral", Role.Top, "rare", role, 50);
        }

        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            defaultConfig,
        );
        const commonFavored = findTopSuggestion(suggestions, "commonFavored");
        const rareFavored = findTopSuggestion(suggestions, "rareFavored");
        const neutral = findTopSuggestion(suggestions, "neutral");

        expect(commonFavored.blindabilityResult.synergyScore).toBeGreaterThan(
            neutral.blindabilityResult.synergyScore,
        );
        expect(commonFavored.blindabilityResult.matchupScore).toBeLessThan(
            neutral.blindabilityResult.matchupScore,
        );
        expect(commonFavored.blindabilityResult.matchupScore).toBeGreaterThan(
            rareFavored.blindabilityResult.matchupScore,
        );
        expect(rareFavored.blindabilityResult.counterExposure).toBeGreaterThan(
            commonFavored.blindabilityResult.counterExposure * 3,
        );
        expect(rareFavored.blindabilityResult.synergyScore).toBeLessThan(
            neutral.blindabilityResult.synergyScore,
        );
        expect(rareFavored.blindabilityResult.matchupScore).toBeLessThan(
            neutral.blindabilityResult.matchupScore,
        );
    });

    test("scales ally fit and counter exposure as one blindability value", () => {
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
        const halfBlindability = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...defaultConfig,
                blindabilityWeight: 50,
            }),
            "stable",
        );
        const disabled = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...defaultConfig,
                blindabilityWeight: 0,
            }),
            "stable",
        );

        expect(halfBlindability.blindabilityResult.rating).toBeCloseTo(
            full.blindabilityResult.rating * 0.5,
        );
        expect(disabled.blindabilityResult.rating).toBe(0);
        expect(disabled.blindabilityResult.adjustedWinrate).toBeCloseTo(
            disabled.draftResult.winrate,
        );
    });

    test("lets enemy safety take priority over unknown ally fit", () => {
        const dataset = createDataset([
            "allyFit",
            "enemySafe",
            "ally",
            "enemy",
        ]);
        makeViable(dataset, "allyFit", Role.Top);
        makeViable(dataset, "enemySafe", Role.Top);
        makeViable(dataset, "ally", Role.Jungle);
        makeViable(dataset, "enemy", Role.Top);

        setDuo(dataset, "allyFit", Role.Top, "ally", Role.Jungle, 60);
        setDuo(dataset, "enemySafe", Role.Top, "ally", Role.Jungle, 40);
        setMatchup(dataset, "allyFit", Role.Top, "enemy", Role.Top, 40);
        setMatchup(dataset, "enemySafe", Role.Top, "enemy", Role.Top, 60);

        const getCandidatesAtPriority = (enemySafetyPriority: number) => {
            const suggestions = getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map(),
                {
                    ...defaultConfig,
                    enemySafetyPriority,
                },
            );

            return {
                allyFit: findTopSuggestion(suggestions, "allyFit"),
                enemySafe: findTopSuggestion(suggestions, "enemySafe"),
            };
        };
        const allyFocused = getCandidatesAtPriority(25);
        const enemyFocused = getCandidatesAtPriority(75);

        expect(allyFocused.allyFit.blindabilityResult.rating).toBeGreaterThan(
            allyFocused.enemySafe.blindabilityResult.rating,
        );
        expect(
            enemyFocused.enemySafe.blindabilityResult.rating,
        ).toBeGreaterThan(enemyFocused.allyFit.blindabilityResult.rating);
        expect(enemyFocused.allyFit.draftResult.winrate).toBeCloseTo(
            allyFocused.allyFit.draftResult.winrate,
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
        expect(unsupported.blindabilityResult.rating).toBe(0);
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

        expect(single.blindabilityResult.rating).toBe(0);
        expect(Number.isFinite(single.blindabilityResult.adjustedWinrate)).toBe(
            true,
        );
        expect(empty).toEqual([]);
    });
});

describe("suggestion context standardization", () => {
    test("lowers a selectively picked champion in an open draft and restores it in a favorable matchup", () => {
        const dataset = createDataset([
            "situational",
            "generalist",
            "commonEnemy",
            "rareEnemy",
        ]);
        makeViable(dataset, "situational", Role.Top, 10000);
        makeViable(dataset, "generalist", Role.Top, 10000);
        makeViable(dataset, "commonEnemy", Role.Top, 9000);
        makeViable(dataset, "rareEnemy", Role.Top, 1000);
        dataset.championData.situational.statsByRole[Role.Top].wins = 5500;
        dataset.championData.generalist.statsByRole[Role.Top].wins = 5200;

        // The situational champion was mostly selected into its rare, excellent
        // matchup even though the ordinary meta is mostly the bad matchup.
        setMatchup(
            dataset,
            "situational",
            Role.Top,
            "commonEnemy",
            Role.Top,
            450,
            1000,
        );
        setMatchup(
            dataset,
            "situational",
            Role.Top,
            "rareEnemy",
            Role.Top,
            5400,
            9000,
        );

        const config = {
            ...defaultConfig,
            riskLevel: "very-high" as const,
            blindabilityWeight: 0,
            compositionInfluence: 0,
        };
        const openSuggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            config,
        );
        const openSituational = findTopSuggestion(
            openSuggestions,
            "situational",
        );
        const openGeneralist = findTopSuggestion(openSuggestions, "generalist");
        const favorableSuggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map([[Role.Top, "rareEnemy"]]),
            config,
        );
        const favorableSituational = findTopSuggestion(
            favorableSuggestions,
            "situational",
        );
        const favorableGeneralist = findTopSuggestion(
            favorableSuggestions,
            "generalist",
        );
        const disabledContext = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...config,
                contextInfluence: 0,
            }),
            "situational",
        );
        const doubleContext = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...config,
                contextInfluence: 200,
            }),
            "situational",
        );

        expect(openSituational.contextResult.rating).toBeLessThan(0);
        expect(openSituational.contextResult.adjustedWinrate).toBeLessThan(
            openSituational.draftResult.winrate,
        );
        expect(openSituational.adjustedWinrate).toBeLessThan(
            openGeneralist.adjustedWinrate,
        );
        expect(favorableSituational.adjustedWinrate).toBeGreaterThan(
            openSituational.adjustedWinrate,
        );
        expect(favorableSituational.adjustedWinrate).toBeGreaterThan(
            favorableGeneralist.adjustedWinrate,
        );
        expect(disabledContext.contextResult.rating).toBe(0);
        expect(disabledContext.contextResult.adjustedWinrate).toBeCloseTo(
            disabledContext.draftResult.winrate,
        );
        expect(doubleContext.contextResult.rating).toBeCloseTo(
            openSituational.contextResult.rating * 2,
        );
    });

    test("does not penalize low pick volume by itself", () => {
        const dataset = createDataset(["rare", "popular"]);
        makeViable(dataset, "rare", Role.Top, 100);
        makeViable(dataset, "popular", Role.Top, 10000);

        const rare = findTopSuggestion(
            getSuggestions(dataset, dataset, new Map(), new Map(), {
                ...defaultConfig,
                blindabilityWeight: 0,
                compositionInfluence: 0,
            }),
            "rare",
        );

        expect(rare.contextResult.rating).toBe(0);
        expect(rare.contextResult.adjustedWinrate).toBeCloseTo(
            rare.draftResult.winrate,
        );
    });
});

describe("flex-pick suggestion uncertainty", () => {
    test("weights a suggestion against every possible enemy role", () => {
        const dataset = createDataset(["candidate", "flexEnemy"]);
        makeViable(dataset, "candidate", Role.Top);
        makeViable(dataset, "flexEnemy", Role.Middle);
        makeViable(dataset, "flexEnemy", Role.Support);
        setMatchup(
            dataset,
            "candidate",
            Role.Top,
            "flexEnemy",
            Role.Middle,
            60,
        );
        setMatchup(
            dataset,
            "candidate",
            Role.Top,
            "flexEnemy",
            Role.Support,
            40,
        );
        const config = {
            ...defaultConfig,
            blindabilityWeight: 0,
        };
        const middle = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map([[Role.Middle, "flexEnemy"]]),
                config,
            ),
            "candidate",
        );
        const support = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map(),
                new Map([[Role.Support, "flexEnemy"]]),
                config,
            ),
            "candidate",
        );
        const uncertain = findTopSuggestion(
            getSuggestionsWithRoleUncertainty(
                dataset,
                dataset,
                [[new Map(), 1]],
                [
                    [new Map([[Role.Middle, "flexEnemy"]]), 0.75],
                    [new Map([[Role.Support, "flexEnemy"]]), 0.25],
                ],
                config,
            ),
            "candidate",
        );

        expect(uncertain.draftResult.totalRating).toBeCloseTo(
            middle.draftResult.totalRating * 0.75 +
                support.draftResult.totalRating * 0.25,
        );
        expect(uncertain.draftResult.winrate).toBeCloseTo(
            middle.draftResult.winrate * 0.75 +
                support.draftResult.winrate * 0.25,
        );
        expect(uncertain.blindabilityResult.adjustedWinrate).toBeCloseTo(
            uncertain.contextResult.adjustedWinrate,
        );
    });

    test("conditions ally assignments on the suggested role being open", () => {
        const dataset = createDataset(["candidate", "flexAlly"]);
        makeViable(dataset, "candidate", Role.Top);
        makeViable(dataset, "flexAlly", Role.Top);
        makeViable(dataset, "flexAlly", Role.Jungle);
        setDuo(dataset, "candidate", Role.Top, "flexAlly", Role.Jungle, 60);
        const config = {
            ...defaultConfig,
            blindabilityWeight: 0,
        };
        const jungle = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map([[Role.Jungle, "flexAlly"]]),
                new Map(),
                config,
            ),
            "candidate",
        );
        const uncertain = findTopSuggestion(
            getSuggestionsWithRoleUncertainty(
                dataset,
                dataset,
                [
                    [new Map([[Role.Top, "flexAlly"]]), 0.75],
                    [new Map([[Role.Jungle, "flexAlly"]]), 0.25],
                ],
                [[new Map(), 1]],
                config,
            ),
            "candidate",
        );

        expect(uncertain.draftResult.totalRating).toBeCloseTo(
            jungle.draftResult.totalRating,
        );
        expect(uncertain.draftResult.winrate).toBeCloseTo(
            jungle.draftResult.winrate,
        );
    });
});

describe("composition suggestions", () => {
    function createDamageBalanceDraft() {
        const dataset = createDataset([
            "Ahri",
            "Talon",
            "Aatrox",
            "Darius",
            "Draven",
            "Garen",
        ]);
        const team = new Map([
            [Role.Top, "Aatrox"],
            [Role.Jungle, "Darius"],
            [Role.Bottom, "Draven"],
            [Role.Support, "Garen"],
        ]);

        makeViable(dataset, "Ahri", Role.Middle);
        makeViable(dataset, "Talon", Role.Middle);
        for (const [role, championKey] of team) {
            makeViable(dataset, championKey, role);
            setDamage(dataset, championKey, role, 100, 0);
        }
        setDamage(dataset, "Ahri", Role.Middle, 0, 100);
        setDamage(dataset, "Talon", Role.Middle, 100, 0);

        return { dataset, team };
    }

    function findMiddleSuggestion(
        suggestions: ReturnType<typeof getSuggestions>,
        championKey: string,
    ) {
        return suggestions.find(
            (suggestion) =>
                suggestion.championKey === championKey &&
                suggestion.role === Role.Middle,
        )!;
    }

    test("raises an AP candidate when completing a physical-damage team", () => {
        const { dataset, team } = createDamageBalanceDraft();
        const suggestions = getSuggestions(dataset, dataset, team, new Map(), {
            ...defaultConfig,
            blindabilityWeight: 0,
            compositionInfluence: 100,
        });
        const ahri = findMiddleSuggestion(suggestions, "Ahri");
        const talon = findMiddleSuggestion(suggestions, "Talon");

        expect(ahri.compositionResult.winrateDelta).toBeGreaterThan(0);
        expect(talon.compositionResult.winrateDelta).toBeLessThan(0);
        expect(ahri.adjustedWinrate).toBeGreaterThan(talon.adjustedWinrate);
        expect(suggestions.indexOf(ahri)).toBeLessThan(
            suggestions.indexOf(talon),
        );
    });

    test("can disable composition influence without changing blindability", () => {
        const { dataset, team } = createDamageBalanceDraft();
        const suggestions = getSuggestions(dataset, dataset, team, new Map(), {
            ...defaultConfig,
            compositionInfluence: 0,
        });

        for (const suggestion of suggestions) {
            expect(suggestion.compositionResult.winrateDelta).toBe(0);
            expect(suggestion.adjustedWinrate).toBeCloseTo(
                suggestion.blindabilityResult.adjustedWinrate,
            );
        }
    });

    test("does not apply composition influence with no known teammates", () => {
        const { dataset } = createDamageBalanceDraft();
        const suggestions = getSuggestions(
            dataset,
            dataset,
            new Map(),
            new Map(),
            {
                ...defaultConfig,
                compositionInfluence: 100,
            },
        );

        for (const suggestion of suggestions) {
            expect(suggestion.compositionResult.stageWeight).toBe(0);
            expect(suggestion.compositionResult.winrateDelta).toBe(0);
        }
    });

    test("conservatively rewards responses to a known enemy composition", () => {
        const dataset = createDataset([
            "Jinx",
            "Jhin",
            "Ornn",
            "Amumu",
            "Ahri",
            "Yuumi",
            "DrMundo",
            "Shaco",
            "Akali",
            "Ezreal",
            "TahmKench",
        ]);
        const team = new Map([
            [Role.Top, "Ornn"],
            [Role.Jungle, "Amumu"],
            [Role.Middle, "Ahri"],
            [Role.Support, "Yuumi"],
        ]);
        const enemy = new Map([
            [Role.Top, "DrMundo"],
            [Role.Jungle, "Shaco"],
            [Role.Middle, "Akali"],
            [Role.Bottom, "Ezreal"],
            [Role.Support, "TahmKench"],
        ]);
        makeViable(dataset, "Jinx", Role.Bottom);
        makeViable(dataset, "Jhin", Role.Bottom);
        setDamage(dataset, "Jinx", Role.Bottom, 100, 0);
        setDamage(dataset, "Jhin", Role.Bottom, 100, 0);
        const suggestions = getSuggestions(dataset, dataset, team, enemy, {
            ...defaultConfig,
            blindabilityWeight: 0,
            compositionInfluence: 100,
        });
        const jinx = suggestions.find(
            (suggestion) => suggestion.championKey === "Jinx",
        )!;
        const jhin = suggestions.find(
            (suggestion) => suggestion.championKey === "Jhin",
        )!;

        expect(jinx.compositionResult.enemyResponse.stageWeight).toBe(1);
        expect(jinx.compositionResult.enemyResponse.pressures.frontline).toBe(
            1,
        );
        expect(
            jinx.compositionResult.enemyResponse.winrateDelta,
        ).toBeGreaterThan(jhin.compositionResult.enemyResponse.winrateDelta);

        const withoutEnemies = getSuggestions(
            dataset,
            dataset,
            team,
            new Map(),
            {
                ...defaultConfig,
                blindabilityWeight: 0,
                compositionInfluence: 100,
            },
        );
        for (const suggestion of withoutEnemies) {
            expect(suggestion.compositionResult.enemyResponse.stageWeight).toBe(
                0,
            );
            expect(
                suggestion.compositionResult.enemyResponse.winrateDelta,
            ).toBe(0);
        }
    });

    test("keeps an unreviewed candidate neutral and finite", () => {
        const { dataset, team } = createDamageBalanceDraft();
        dataset.championData.Unknown = createChampion("Unknown");
        makeViable(dataset, "Unknown", Role.Middle);
        setDamage(dataset, "Unknown", Role.Middle, 0, 100);
        const unknown = findMiddleSuggestion(
            getSuggestions(dataset, dataset, team, new Map(), {
                ...defaultConfig,
                compositionInfluence: 100,
            }),
            "Unknown",
        );

        expect(unknown.compositionResult.winrateDelta).toBe(0);
        expect(Number.isFinite(unknown.adjustedWinrate)).toBe(true);
    });

    test("weights composition scores across flex-role assignments", () => {
        const dataset = createDataset(["Aatrox", "Galio"]);
        makeViable(dataset, "Aatrox", Role.Top);
        makeViable(dataset, "Galio", Role.Middle);
        makeViable(dataset, "Galio", Role.Support);
        setDamage(dataset, "Aatrox", Role.Top, 100, 0);
        setDamage(dataset, "Galio", Role.Middle, 0, 100);
        setDamage(dataset, "Galio", Role.Support, 0, 100);
        const config = { ...defaultConfig, compositionInfluence: 100 };
        const middle = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map([[Role.Middle, "Galio"]]),
                new Map(),
                config,
            ),
            "Aatrox",
        );
        const support = findTopSuggestion(
            getSuggestions(
                dataset,
                dataset,
                new Map([[Role.Support, "Galio"]]),
                new Map(),
                config,
            ),
            "Aatrox",
        );
        const uncertain = findTopSuggestion(
            getSuggestionsWithRoleUncertainty(
                dataset,
                dataset,
                [
                    [new Map([[Role.Middle, "Galio"]]), 0.75],
                    [new Map([[Role.Support, "Galio"]]), 0.25],
                ],
                [[new Map(), 1]],
                config,
            ),
            "Aatrox",
        );

        expect(uncertain.compositionResult.rawScore).toBeCloseTo(
            middle.compositionResult.rawScore * 0.75 +
                support.compositionResult.rawScore * 0.25,
        );
        expect(uncertain.compositionResult.coverage.frontline).toBeCloseTo(
            middle.compositionResult.coverage.frontline * 0.75 +
                support.compositionResult.coverage.frontline * 0.25,
        );
    });

    test("weights role centering by recent role pick volume", () => {
        const { dataset, team } = createDamageBalanceDraft();
        const { dataset: synergyMatchupDataset } = createDamageBalanceDraft();
        makeViable(synergyMatchupDataset, "Ahri", Role.Middle, 900);
        makeViable(synergyMatchupDataset, "Talon", Role.Middle, 100);
        const suggestions = getSuggestions(
            dataset,
            synergyMatchupDataset,
            team,
            new Map(),
            {
                ...defaultConfig,
                compositionInfluence: 100,
            },
        );
        const ahri = findMiddleSuggestion(suggestions, "Ahri");
        const talon = findMiddleSuggestion(suggestions, "Talon");
        const weightedMean =
            (ahri.compositionResult.rawScore * 900 +
                talon.compositionResult.rawScore * 100) /
            1000;

        expect(ahri.compositionResult.centeredScore).toBeCloseTo(
            ahri.compositionResult.rawScore - weightedMean,
        );
        expect(talon.compositionResult.centeredScore).toBeCloseTo(
            talon.compositionResult.rawScore - weightedMean,
        );
    });

    test("excludes banned candidates from role centering", () => {
        const { dataset, team } = createDamageBalanceDraft();
        dataset.championData.Anivia = createChampion("Anivia");
        makeViable(dataset, "Anivia", Role.Middle);
        setDamage(dataset, "Anivia", Role.Middle, 0, 100);
        const suggestions = getSuggestions(
            dataset,
            dataset,
            team,
            new Map(),
            { ...defaultConfig, compositionInfluence: 100 },
            ["Anivia"],
        );
        const ahri = findMiddleSuggestion(suggestions, "Ahri");
        const talon = findMiddleSuggestion(suggestions, "Talon");

        expect(ahri.compositionResult.centeredScore).toBeCloseTo(
            ahri.compositionResult.rawScore -
                (ahri.compositionResult.rawScore +
                    talon.compositionResult.rawScore) /
                    2,
        );
    });
});
