import { describe, expect, test } from "bun:test";
import { getContextRatings } from "./context";

const priorGames = 1000;
const row = (
    rating: number,
    games: number,
    metaWeight: number,
    available = true,
) => ({
    rating,
    games,
    metaWeight,
    available,
});
const adjustment = (result: ReturnType<typeof getContextRatings>) =>
    result.meta - result.observed;

describe("situational coverage", () => {
    test("a conditional forecast cannot inflate confidence in a poorly observed pool", () => {
        const result = getContextRatings(
            [
                { ...row(20, 1e7, 9), coverageWeight: 1 },
                { ...row(0, 0, 1), coverageWeight: 99 },
            ],
            priorGames,
            1,
        );
        expect(result.metaConfidence).toBeLessThan(0.01);
        expect(Math.abs(adjustment(result))).toBeLessThan(0.021);
    });
    test("missing evidence stays neutral", () => {
        for (const rows of [[], [row(0, 0, 9), row(0, 0, 1)]]) {
            for (const openProbability of [0, 0.5, 1]) {
                const result = getContextRatings(
                    rows,
                    priorGames,
                    openProbability,
                );
                expect(adjustment(result)).toBe(0);
                expect(result.observedConfidence).toBe(0);
                expect(result.metaConfidence).toBe(0);
            }
        }
    });

    test("one enormous sample cannot conceal a mostly unknown target mix in either direction", () => {
        for (const sign of [-1, 1]) {
            const result = getContextRatings(
                [row(sign * 20, 10000000, 1), row(0, 0, 99)],
                priorGames,
                1,
            );
            const original = result.rawMeta - result.rawObserved;
            expect(Math.sign(adjustment(result))).toBe(Math.sign(original));
            expect(Math.abs(adjustment(result))).toBeLessThan(
                Math.abs(original) * 0.01,
            );
            expect(result.observedConfidence).toBeGreaterThan(0.99);
            expect(result.metaConfidence).toBeLessThan(0.01);
        }
    });

    test("uses a shared multiplier so equal means remain equal despite uneven support", () => {
        const result = getContextRatings(
            [row(12, 100, 9), row(12, 100000, 1)],
            priorGames,
            1,
        );
        expect(result.observedConfidence).toBeGreaterThan(
            result.metaConfidence,
        );
        expect(adjustment(result)).toBeCloseTo(0, 12);
    });

    test("retains well-supported contrasts and increases support smoothly with more evidence", () => {
        let previousMagnitude = 0;
        for (const games of [1, 10, 100, 1000, 10000, 1000000]) {
            const result = getContextRatings(
                [row(20, games * 9, 1), row(-20, games, 9)],
                priorGames,
                1,
            );
            const magnitude = Math.abs(adjustment(result));
            expect(magnitude).toBeGreaterThan(previousMagnitude);
            expect(magnitude).toBeLessThan(
                Math.abs(result.rawMeta - result.rawObserved),
            );
            if (games === 1000000)
                expect(magnitude).toBeGreaterThan(
                    Math.abs(result.rawMeta - result.rawObserved) * 0.999,
                );
            previousMagnitude = magnitude;
        }
    });

    test("more conservative risk settings reduce unsupported corrections", () => {
        const rows = [row(20, 2000, 1), row(0, 0, 9)];
        const cautious = getContextRatings(rows, 3000, 1);
        const permissive = getContextRatings(rows, 250, 1);
        expect(Math.abs(adjustment(cautious))).toBeLessThan(
            Math.abs(adjustment(permissive)),
        );
    });

    test("known roles retain historical centering without relying on missing future matchups", () => {
        const rows = [row(20, 10000, 1, false), row(0, 0, 99)];
        const open = getContextRatings(rows, priorGames, 1);
        const known = getContextRatings(rows, priorGames, 0);
        const uncertain = getContextRatings(rows, priorGames, 0.25);
        const historicalOnly = getContextRatings([rows[0]!], priorGames, 0);
        expect(adjustment(open)).toBe(0);
        expect(known.observed).toBeGreaterThan(18);
        expect(known.meta).toBe(0);
        expect(adjustment(known)).toBe(adjustment(historicalOnly));
        expect(adjustment(uncertain)).toBeCloseTo(
            adjustment(open) * 0.25 + adjustment(known) * 0.75,
            12,
        );
    });
});
