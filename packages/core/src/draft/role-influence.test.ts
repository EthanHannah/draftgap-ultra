import { expect, test } from "bun:test";
import { Role, ROLES } from "../models/Role";
import {
    MATCHUP_ROLE_PRIORITIES,
    DUO_ROLE_PRIORITIES,
    getMatchupInteractionWeight,
    getDuoInteractionWeight,
    getTeamDuoInteractionWeight,
    getBlindMatchupInteractionWeight,
} from "./role-influence";

test("percentage matrices preserve scoring budgets and team symmetry", () => {
    for (const role of ROLES) {
        for (const matrix of [MATCHUP_ROLE_PRIORITIES, DUO_ROLE_PRIORITIES]) {
            expect(
                matrix[role].reduce((sum: number, value) => sum + value, 0),
            ).toBe(100);
        }
        expect(getDuoInteractionWeight(role, role)).toBe(0);
        expect(
            ROLES.reduce(
                (sum, other) => sum + getMatchupInteractionWeight(role, other),
                0,
            ),
        ).toBeCloseTo(5);
        expect(
            ROLES.reduce(
                (sum, other) => sum + getDuoInteractionWeight(role, other),
                0,
            ),
        ).toBeCloseTo(4);
        expect(
            ROLES.reduce(
                (sum, other) =>
                    sum + getBlindMatchupInteractionWeight(role, other),
                0,
            ),
        ).toBeCloseTo(1.5);
        for (const other of ROLES) {
            expect(getMatchupInteractionWeight(role, other)).toBe(
                (MATCHUP_ROLE_PRIORITIES[role][other] / 100) * 5,
            );
            expect(getMatchupInteractionWeight(role, other)).toBe(
                getMatchupInteractionWeight(other, role),
            );
            expect(getTeamDuoInteractionWeight(role, other)).toBe(
                getTeamDuoInteractionWeight(other, role),
            );
            expect(getBlindMatchupInteractionWeight(role, other)).toBeCloseTo(
                getMatchupInteractionWeight(role, other) * 0.3,
            );
        }
    }
});

test("top counter matchups have the largest spread and all other rows stay closer", () => {
    expect(MATCHUP_ROLE_PRIORITIES[Role.Top]).toEqual([35, 20, 15, 15, 15]);
    for (const role of ROLES) {
        const matchup = MATCHUP_ROLE_PRIORITIES[role];
        expect(Math.max(...matchup) - Math.min(...matchup)).toBeLessThanOrEqual(
            role === Role.Top ? 20 : 15,
        );
        const duo = DUO_ROLE_PRIORITIES[role].filter(
            (_, other) => other !== role,
        );
        expect(Math.max(...duo) - Math.min(...duo)).toBeLessThanOrEqual(10);
    }
    for (const role of ROLES.filter((role) => role !== Role.Jungle)) {
        expect(
            MATCHUP_ROLE_PRIORITIES[Role.Jungle][Role.Jungle],
        ).toBeGreaterThan(MATCHUP_ROLE_PRIORITIES[Role.Jungle][role]);
    }
});

test("bot and support prioritize their partnership and the enemy bot lane", () => {
    for (const role of [Role.Bottom, Role.Support]) {
        const partner = role === Role.Bottom ? Role.Support : Role.Bottom;
        expect(DUO_ROLE_PRIORITIES[role][partner]).toBe(30);
        expect(
            MATCHUP_ROLE_PRIORITIES[role][Role.Bottom] +
                MATCHUP_ROLE_PRIORITIES[role][Role.Support],
        ).toBe(50);
        for (const distantRole of [Role.Top, Role.Jungle, Role.Middle]) {
            expect(MATCHUP_ROLE_PRIORITIES[role][Role.Bottom]).toBeGreaterThan(
                MATCHUP_ROLE_PRIORITIES[role][distantRole],
            );
            expect(MATCHUP_ROLE_PRIORITIES[role][Role.Support]).toBeGreaterThan(
                MATCHUP_ROLE_PRIORITIES[role][distantRole],
            );
        }
    }
});

test("jungle gives every teammate equal synergy priority", () => {
    for (const role of ROLES.filter((role) => role !== Role.Jungle)) {
        expect(DUO_ROLE_PRIORITIES[Role.Jungle][role]).toBe(25);
        expect(getDuoInteractionWeight(Role.Jungle, role)).toBe(1);
    }
});
