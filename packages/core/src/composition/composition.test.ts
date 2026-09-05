import { describe, expect, test } from "bun:test";
import { getCombatProfile, getCombatProfileIds } from "./combat-profiles";
import { Role, ROLES } from "../models/Role";
import { ChampionData } from "../models/dataset/ChampionData";
import { Dataset } from "../models/dataset/Dataset";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import {
    COMPOSITION_SCORE_WEIGHTS,
    combineCompositionWinrateDeltas,
    getCompositionStageWeight,
    getCompositionWinrateDelta,
    getEnemyCompositionStageWeight,
    getEnemyResponseScore,
    getEnemyResponseWinrateDelta,
    getTeamCompositionScore,
} from "./composition";
import {
    getCompositionProfile,
    getMissingCompositionProfileIds,
} from "./profiles";

function createChampion(id: string): ChampionData {
    return {
        id,
        key: id,
        name: id,
        i18n: {},
        statsByRole: Object.fromEntries(
            ROLES.map((role) => [role, defaultChampionRoleData()]),
        ) as ChampionData["statsByRole"],
    };
}

function createDataset(ids: string[]): Dataset {
    return {
        version: "test",
        date: "test",
        championData: Object.fromEntries(
            ids.map((id) => [id, createChampion(id)]),
        ),
        itemData: {},
        runeData: {},
        runePathData: {},
        statShardData: {},
        summonerSpellData: {},
    };
}

function setDamage(
    dataset: Dataset,
    championId: string,
    role: Role,
    physical: number,
    magic: number,
    trueDamage = 0,
) {
    dataset.championData[championId].statsByRole[role].damageProfile = {
        physical,
        magic,
        true: trueDamage,
    };
}

describe("composition profiles", () => {
    test("uses valid champion IDs and conservative role-specific combat traits", () => {
        expect(getMissingCompositionProfileIds(getCombatProfileIds())).toEqual(
            [],
        );
        expect(getCombatProfile("Brand", Role.Support).tankDamage).toBeLessThan(
            getCombatProfile("Brand", Role.Middle).tankDamage,
        );
        expect(getCombatProfile("Unknown", Role.Middle).tankDamage).toBe(0);
    });

    test("covers each focused curated capability", () => {
        expect(getCompositionProfile("Alistar", Role.Support)?.frontline).toBe(
            1,
        );
        expect(getCompositionProfile("Malphite", Role.Top)?.engage).toBe(1);
        expect(getCompositionProfile("Janna", Role.Support)?.peel).toBe(1);
        expect(
            getCompositionProfile("Leona", Role.Support)?.hardCrowdControl,
        ).toBe(1);
        expect(getCompositionProfile("Anivia", Role.Middle)?.waveclear).toBe(1);
        expect(
            getCompositionProfile("Jinx", Role.Bottom)?.sustainedDamage,
        ).toBe(1);
    });

    test("uses the full five-level capability gradient", () => {
        expect(getCompositionProfile("MasterYi", Role.Jungle)?.frontline).toBe(
            0,
        );
        expect(getCompositionProfile("Camille", Role.Top)?.frontline).toBe(
            0.25,
        );
        expect(getCompositionProfile("Aatrox", Role.Top)?.frontline).toBe(0.5);
        expect(getCompositionProfile("Gragas", Role.Jungle)?.frontline).toBe(
            0.75,
        );
        expect(getCompositionProfile("Alistar", Role.Support)?.frontline).toBe(
            1,
        );
    });

    test("reports unreviewed champions and returns no profile", () => {
        expect(getCompositionProfile("NewChampion", Role.Middle)).toBe(
            undefined,
        );
        expect(
            getMissingCompositionProfileIds(["Ahri", "NewChampion"]),
        ).toEqual(["NewChampion"]);
    });
});

describe("team composition score", () => {
    test("weights broadly applicable fundamentals above contextual ones", () => {
        expect(
            Object.values(COMPOSITION_SCORE_WEIGHTS).reduce(
                (total, weight) => total + weight,
                0,
            ),
        ).toBe(6);
        expect(COMPOSITION_SCORE_WEIGHTS.damageBalance).toBeGreaterThan(
            COMPOSITION_SCORE_WEIGHTS.waveclear,
        );
        expect(COMPOSITION_SCORE_WEIGHTS.waveclear).toBeGreaterThan(
            COMPOSITION_SCORE_WEIGHTS.sustainedDamage,
        );
    });

    test("rewards mixed damage over a single damage type", () => {
        const dataset = createDataset(["Aatrox", "Ahri"]);
        setDamage(dataset, "Aatrox", Role.Top, 100, 0);
        setDamage(dataset, "Ahri", Role.Middle, 0, 100);

        const physicalOnly = getTeamCompositionScore(
            dataset,
            new Map([[Role.Top, "Aatrox"]]),
        );
        const mixed = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "Aatrox"],
                [Role.Middle, "Ahri"],
            ]),
        );
        const magicOnly = getTeamCompositionScore(
            dataset,
            new Map([[Role.Middle, "Ahri"]]),
        );

        expect(physicalOnly.coverage.damageBalance).toBe(0);
        expect(magicOnly.coverage.damageBalance).toBe(0);
        expect(mixed.coverage.damageBalance).toBe(1);
    });

    test("gives full damage-balance credit through a 70/30 split", () => {
        const dataset = createDataset(["Aatrox", "Ahri"]);
        setDamage(dataset, "Aatrox", Role.Top, 70, 0);
        setDamage(dataset, "Ahri", Role.Middle, 0, 30);
        const balancedEnough = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "Aatrox"],
                [Role.Middle, "Ahri"],
            ]),
        );

        setDamage(dataset, "Aatrox", Role.Top, 71, 0);
        setDamage(dataset, "Ahri", Role.Middle, 0, 29);
        const imbalanced = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "Aatrox"],
                [Role.Middle, "Ahri"],
            ]),
        );

        expect(balancedEnough.coverage.damageBalance).toBe(1);
        expect(imbalanced.coverage.damageBalance).toBeLessThan(1);
        expect(imbalanced.coverage.damageBalance).toBeGreaterThan(0);
    });

    test("rewards every focused capability when it is missing", () => {
        const providers = [
            ["frontline", "Alistar", Role.Support],
            ["engage", "Malphite", Role.Top],
            ["peel", "Janna", Role.Support],
            ["hardCrowdControl", "Leona", Role.Support],
            ["waveclear", "Anivia", Role.Middle],
        ] as const;
        const dataset = createDataset([
            "MasterYi",
            ...providers.map(([, championId]) => championId),
        ]);
        setDamage(dataset, "MasterYi", Role.Jungle, 50, 50);
        const neutral = getTeamCompositionScore(
            dataset,
            new Map([[Role.Jungle, "MasterYi"]]),
        );

        for (const [capability, championId, role] of providers) {
            setDamage(dataset, championId, role, 50, 50);
            const provider = getTeamCompositionScore(
                dataset,
                new Map([[role, championId]]),
            );

            expect(provider.coverage[capability]).toBeGreaterThan(
                neutral.coverage[capability],
            );
        }

        const sustainedDataset = createDataset(["Jinx", "Yuumi"]);
        setDamage(sustainedDataset, "Jinx", Role.Bottom, 50, 50);
        setDamage(sustainedDataset, "Yuumi", Role.Support, 50, 50);
        const sustainedProvider = getTeamCompositionScore(
            sustainedDataset,
            new Map([[Role.Bottom, "Jinx"]]),
        );
        const noSustainedDamage = getTeamCompositionScore(
            sustainedDataset,
            new Map([[Role.Support, "Yuumi"]]),
        );

        expect(sustainedProvider.coverage.sustainedDamage).toBeGreaterThan(
            noSustainedDamage.coverage.sustainedDamage,
        );
    });

    test("requires another champion to turn tools into a fight plan", () => {
        const dataset = createDataset([
            "Alistar",
            "Malphite",
            "Ahri",
            "Janna",
            "Jinx",
            "Talon",
        ]);
        const score = (entries: [Role, string][]) =>
            getTeamCompositionScore(dataset, new Map(entries));
        expect(score([[Role.Support, "Alistar"]]).coverage.fightPlan).toBe(0);
        const followUp = score([
            [Role.Top, "Malphite"],
            [Role.Middle, "Ahri"],
        ]);
        const noFollowUp = score([
            [Role.Top, "Malphite"],
            [Role.Support, "Alistar"],
        ]);
        expect(followUp.plans.engage).toBeGreaterThan(noFollowUp.plans.engage);
        const protectCarry = score([
            [Role.Support, "Janna"],
            [Role.Bottom, "Jinx"],
        ]);
        const protectAssassin = score([
            [Role.Support, "Janna"],
            [Role.Middle, "Talon"],
        ]);
        expect(protectCarry.plans.protect).toBeGreaterThan(
            protectAssassin.plans.protect,
        );
    });

    test("values a reliable provider above several minor providers and retains redundancy", () => {
        const dataset = createDataset([
            "Alistar",
            "Braum",
            "Camille",
            "LeeSin",
            "Vi",
            "Rakan",
        ]);
        const one = getTeamCompositionScore(
            dataset,
            new Map([[Role.Support, "Alistar"]]),
        );
        const two = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Support, "Alistar"],
                [Role.Top, "Braum"],
            ]),
        );
        const minor = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "Camille"],
                [Role.Jungle, "LeeSin"],
                [Role.Middle, "Vi"],
                [Role.Support, "Rakan"],
            ]),
        );
        expect(one.coverage.frontline).toBeGreaterThan(
            minor.coverage.frontline,
        );
        expect(two.coverage.frontline).toBeGreaterThan(one.coverage.frontline);
        expect(two.coverage.frontline - one.coverage.frontline).toBeLessThan(
            one.coverage.frontline,
        );
        expect(two.coverage.frontline).toBeLessThan(1);
    });

    test("supports a siege plan without requiring initiation", () => {
        const dataset = createDataset(["Janna", "Xerath", "MasterYi"]);
        const siege = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Support, "Janna"],
                [Role.Middle, "Xerath"],
            ]),
        );
        const melee = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Support, "Janna"],
                [Role.Jungle, "MasterYi"],
            ]),
        );
        expect(siege.coverage.engage).toBe(0);
        expect(siege.plans.siege).toBeGreaterThan(melee.plans.siege);
        expect(siege.coverage.fightPlan).toBeGreaterThan(0);
    });

    test("is independent of member iteration order and stays bounded", () => {
        const dataset = createDataset([
            "Malphite",
            "Vi",
            "Ahri",
            "Jinx",
            "Janna",
        ]);
        const entries: [Role, string][] = [
            [Role.Top, "Malphite"],
            [Role.Jungle, "Vi"],
            [Role.Middle, "Ahri"],
            [Role.Bottom, "Jinx"],
            [Role.Support, "Janna"],
        ];
        const first = getTeamCompositionScore(dataset, new Map(entries));
        const reversed = getTeamCompositionScore(
            dataset,
            new Map(entries.reverse()),
        );
        expect(first.score).toBeCloseTo(reversed.score);
        for (const value of Object.values(first.coverage)) {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        }
    });

    test("marks a team with an unreviewed champion as incomplete", () => {
        const dataset = createDataset(["NewChampion"]);
        const result = getTeamCompositionScore(
            dataset,
            new Map([[Role.Middle, "NewChampion"]]),
        );

        expect(result.hasProfiles).toBe(false);
        expect(Number.isFinite(result.score)).toBe(true);
    });
});

describe("enemy composition response", () => {
    test("responds to waveclear with safe siege rather than more waveclear", () => {
        const dataset = createDataset(["Janna", "Anivia", "Xerath", "Sivir"]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([[Role.Bottom, "Sivir"]]),
        );
        const team = (mid: string) =>
            getTeamCompositionScore(
                dataset,
                new Map([
                    [Role.Middle, mid],
                    [Role.Support, "Janna"],
                ]),
            );
        expect(team("Anivia").coverage.waveclear).toBe(
            team("Xerath").coverage.waveclear,
        );
        expect(
            getEnemyResponseScore(team("Xerath"), enemy).score,
        ).toBeGreaterThan(getEnemyResponseScore(team("Anivia"), enemy).score);
    });

    test("accounts for melee tank killers getting access through allied protection", () => {
        const dataset = createDataset([
            "MasterYi",
            "Janna",
            "Talon",
            "DrMundo",
        ]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([[Role.Top, "DrMundo"]]),
        );
        const response = (ally: string) =>
            getEnemyResponseScore(
                getTeamCompositionScore(
                    dataset,
                    new Map([
                        [Role.Jungle, "MasterYi"],
                        [Role.Support, ally],
                    ]),
                ),
                enemy,
            ).score;
        expect(response("Janna")).toBeGreaterThan(response("Talon"));
    });

    test("retains tank-damage differences in a complete draft", () => {
        const dataset = createDataset([
            "Garen",
            "Vi",
            "Ahri",
            "Janna",
            "Jhin",
            "Jinx",
            "Vayne",
            "Ornn",
            "Sejuani",
            "Braum",
        ]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "Ornn"],
                [Role.Jungle, "Sejuani"],
                [Role.Middle, "Ahri"],
                [Role.Bottom, "Jinx"],
                [Role.Support, "Braum"],
            ]),
        );
        const response = (adc: string) =>
            getEnemyResponseScore(
                getTeamCompositionScore(
                    dataset,
                    new Map([
                        [Role.Top, "Garen"],
                        [Role.Jungle, "Vi"],
                        [Role.Middle, "Ahri"],
                        [Role.Bottom, adc],
                        [Role.Support, "Janna"],
                    ]),
                ),
                enemy,
            ).score;
        expect(response("Jinx")).toBeGreaterThan(response("Jhin"));
        expect(response("Vayne")).toBeGreaterThan(response("Jhin"));
    });

    test("does not substitute CC for tank damage", () => {
        const dataset = createDataset(["Alistar", "Vayne", "DrMundo"]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([[Role.Top, "DrMundo"]]),
        );
        const cc = getEnemyResponseScore(
            getTeamCompositionScore(
                dataset,
                new Map([[Role.Support, "Alistar"]]),
            ),
            enemy,
        );
        const damage = getEnemyResponseScore(
            getTeamCompositionScore(dataset, new Map([[Role.Bottom, "Vayne"]])),
            enemy,
        );
        expect(cc.score).toBe(0);
        expect(damage.score).toBeGreaterThan(cc.score);
    });

    test("values protection of an exposed carry over generic frontline", () => {
        const dataset = createDataset([
            "Jinx",
            "Janna",
            "DrMundo",
            "Malphite",
            "Vi",
        ]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "Malphite"],
                [Role.Jungle, "Vi"],
            ]),
        );
        const response = (support: string) =>
            getEnemyResponseScore(
                getTeamCompositionScore(
                    dataset,
                    new Map([
                        [Role.Bottom, "Jinx"],
                        [Role.Support, support],
                    ]),
                ),
                enemy,
            ).score;
        expect(response("Janna")).toBeGreaterThan(response("DrMundo"));
    });

    test("rewards sustained damage into multiple enemy frontliners", () => {
        const dataset = createDataset([
            "Jinx",
            "Yuumi",
            "DrMundo",
            "TahmKench",
        ]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Top, "DrMundo"],
                [Role.Support, "TahmKench"],
            ]),
        );
        const sustained = getEnemyResponseScore(
            getTeamCompositionScore(dataset, new Map([[Role.Bottom, "Jinx"]])),
            enemy,
        );
        const utility = getEnemyResponseScore(
            getTeamCompositionScore(
                dataset,
                new Map([[Role.Support, "Yuumi"]]),
            ),
            enemy,
        );

        expect(enemy.capabilityTotals.frontline).toBe(2);
        expect(sustained.pressures.frontline).toBe(1);
        expect(sustained.score).toBeGreaterThan(utility.score);
    });

    test("rewards peel into multiple enemy engage threats", () => {
        const dataset = createDataset([
            "Janna",
            "Jinx",
            "MasterYi",
            "Fiddlesticks",
            "Kennen",
        ]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Jungle, "Fiddlesticks"],
                [Role.Top, "Kennen"],
            ]),
        );
        const peel = getEnemyResponseScore(
            getTeamCompositionScore(
                dataset,
                new Map([
                    [Role.Support, "Janna"],
                    [Role.Bottom, "Jinx"],
                ]),
            ),
            enemy,
        );
        const noPeel = getEnemyResponseScore(
            getTeamCompositionScore(
                dataset,
                new Map([
                    [Role.Jungle, "MasterYi"],
                    [Role.Bottom, "Jinx"],
                ]),
            ),
            enemy,
        );

        expect(peel.pressures.engage).toBe(1);
        expect(peel.score).toBeGreaterThan(noPeel.score);
    });

    test("slightly discounts straightforward engage into heavy peel", () => {
        const dataset = createDataset([
            "Malphite",
            "MasterYi",
            "Ahri",
            "Janna",
            "Lulu",
        ]);
        const enemy = getTeamCompositionScore(
            dataset,
            new Map([
                [Role.Support, "Janna"],
                [Role.Middle, "Lulu"],
            ]),
        );
        const engage = getEnemyResponseScore(
            getTeamCompositionScore(
                dataset,
                new Map([
                    [Role.Top, "Malphite"],
                    [Role.Middle, "Ahri"],
                ]),
            ),
            enemy,
        );
        const noEngage = getEnemyResponseScore(
            getTeamCompositionScore(
                dataset,
                new Map([
                    [Role.Jungle, "MasterYi"],
                    [Role.Middle, "Ahri"],
                ]),
            ),
            enemy,
        );

        expect(engage.pressures.peel).toBe(1);
        expect(engage.score).toBeLessThan(noEngage.score);
    });
});

describe("composition winrate delta", () => {
    test("uses conservative quadratic draft-stage scaling", () => {
        expect(getCompositionStageWeight(0)).toBe(0);
        expect(getCompositionStageWeight(1)).toBe(0.0625);
        expect(getCompositionStageWeight(2)).toBe(0.25);
        expect(getCompositionStageWeight(3)).toBe(0.5625);
        expect(getCompositionStageWeight(4)).toBe(1);
        expect(getEnemyCompositionStageWeight(0)).toBe(0);
        expect(getEnemyCompositionStageWeight(1)).toBeCloseTo(0.04);
        expect(getEnemyCompositionStageWeight(3)).toBeCloseTo(0.36);
        expect(getEnemyCompositionStageWeight(5)).toBe(1);
    });

    test("keeps enemy response conservative and inside the overall cap", () => {
        const alliedDelta = getCompositionWinrateDelta(1, 100, 1);
        const enemyDelta = getEnemyResponseWinrateDelta(1, 100, 1);

        expect(enemyDelta).toBeCloseTo(0.005);
        expect(
            combineCompositionWinrateDeltas(alliedDelta, enemyDelta, 100),
        ).toBeCloseTo(0.02);
        expect(getEnemyResponseWinrateDelta(1, 50, 1)).toBeCloseTo(0.0025);
    });

    test("scales with influence and known-pick stage", () => {
        expect(getCompositionWinrateDelta(1, 100, 0)).toBe(0);
        expect(getCompositionWinrateDelta(1, 100, 0.5)).toBeCloseTo(0.01);
        expect(getCompositionWinrateDelta(1, 100, 1)).toBeCloseTo(0.02);
        expect(getCompositionWinrateDelta(1, 50, 1)).toBeCloseTo(0.01);
        expect(getCompositionWinrateDelta(-1, 100, 1)).toBeCloseTo(-0.02);
    });

    test("clamps invalid influence and stage inputs", () => {
        expect(getCompositionWinrateDelta(1, 200, 2)).toBeCloseTo(0.02);
        expect(getCompositionWinrateDelta(1, -10, -1)).toBe(0);
    });
});
