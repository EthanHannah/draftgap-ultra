import { expect, test } from "bun:test";
import { Role, ROLES } from "../models/Role";
import {
    MATCHUP_ROLE_PRIORITIES,
    DUO_ROLE_PRIORITIES,
    getMatchupInteractionWeight,
    getDuoInteractionWeight,
    getTeamDuoInteractionWeight,
    getBlindMatchupInteractionWeight,
    getBlindCounterpickShare,
    LANE_COUNTERPICK_SHARE,
    CROSS_ROLE_COUNTERPICK_SHARE,
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

test("measured pair effects are not rescaled by role", () => {
    for (const role of ROLES) {
        for (const other of ROLES) {
            expect(getMatchupInteractionWeight(role, other)).toBe(1);
            expect(getDuoInteractionWeight(role, other)).toBe(
                role === other ? 0 : 1,
            );
            expect(getTeamDuoInteractionWeight(role, other)).toBe(
                getDuoInteractionWeight(role, other),
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

test("blind counterpicks target direct opponents", () => {
    expect(LANE_COUNTERPICK_SHARE).toBeGreaterThan(
        CROSS_ROLE_COUNTERPICK_SHARE,
    );
    for (const role of ROLES) {
        expect(getBlindCounterpickShare(role, role)).toBe(
            LANE_COUNTERPICK_SHARE,
        );
        for (const other of ROLES) {
            expect(getBlindCounterpickShare(role, other)).toBe(
                getBlindCounterpickShare(other, role),
            );
        }
    }
    expect(getBlindCounterpickShare(Role.Bottom, Role.Support)).toBe(
        LANE_COUNTERPICK_SHARE,
    );
    expect(getBlindCounterpickShare(Role.Jungle, Role.Middle)).toBe(
        CROSS_ROLE_COUNTERPICK_SHARE,
    );
    expect(getBlindCounterpickShare(Role.Top, Role.Support)).toBe(
        CROSS_ROLE_COUNTERPICK_SHARE,
    );
});
