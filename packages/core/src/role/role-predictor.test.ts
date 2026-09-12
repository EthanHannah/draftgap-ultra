import { describe, expect, test } from "bun:test";
import { Role, ROLES } from "../models/Role";
import { ChampionData } from "../models/dataset/ChampionData";
import { defaultChampionRoleData } from "../models/dataset/ChampionRoleData";
import predictRoles, { getTeamComps } from "./role-predictor";

function createChampion(key: string, games: number[]): ChampionData {
    return {
        key,
        id: key,
        name: key,
        i18n: {},
        statsByRole: Object.fromEntries(
            ROLES.map((role) => [
                role,
                { ...defaultChampionRoleData(), games: games[role] },
            ]),
        ) as ChampionData["statsByRole"],
    };
}

describe("automatic role play-rate cutoff", () => {
    test("excludes roles below 1% and retains exactly 1%", () => {
        const champion = createChampion("a", [9801, 100, 99, 0, 0]);
        const comps = getTeamComps([champion]);

        expect(comps.map(([comp]) => [...comp.keys()])).toEqual([
            [Role.Top],
            [Role.Jungle],
        ]);
        const probabilities = predictRoles(comps).get("a")!;
        expect(probabilities.get(Role.Top)).toBeCloseTo(9801 / 9901);
        expect(probabilities.get(Role.Jungle)).toBeCloseTo(100 / 9901);
    });

    test("preserves manually assigned roles below the cutoff", () => {
        const champion = createChampion("a", [9801, 100, 99, 0, 0]);
        expect(getTeamComps([{ ...champion, role: Role.Middle }])).toEqual([
            [new Map([[Role.Middle, "a"]]), 1],
        ]);
    });

    test("does not promote rare roles when a popular role is occupied", () => {
        const champion = createChampion("a", [9901, 99, 0, 0, 0]);
        const teammate = createChampion("b", [10000, 0, 0, 0, 0]);
        expect(
            getTeamComps([champion, { ...teammate, role: Role.Top }]),
        ).toEqual([]);
    });

    test("does not generate invalid probabilities without game data", () => {
        expect(getTeamComps([createChampion("a", [0, 0, 0, 0, 0])])).toEqual(
            [],
        );
    });
});
