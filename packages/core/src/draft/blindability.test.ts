import { describe, expect, test } from "bun:test";
import {
    getAllyBlindability,
    getBlindInteractionPrior,
    getCounterBlindability,
} from "./blindability";

const prior = getBlindInteractionPrior([
    { wins: 4800, games: 10000 },
    { wins: 5200, games: 10000 },
]);

function interaction(winrate: number, games: number, weight = 1) {
    return { wins: winrate * games, games, weight };
}

describe("blindability uncertainty", () => {
    test("no observations retain ordinary exposure and give no safety or ally-fit bonus", () => {
        const rows = [interaction(0.5, 0)];
        const counter = getCounterBlindability(rows, prior, 1000);
        expect(counter.counterExposure).toBeGreaterThan(0);
        expect(counter.counterExposure).toBe(prior.counterExposure);
        expect(counter.score).toBe(0);
        expect(getAllyBlindability(rows, prior, 1000).score).toBe(0);
    });

    test("small samples approach neutral instead of inheriting a safety bonus", () => {
        const bad = (games: number) =>
            getCounterBlindability([interaction(0.42, games)], prior, 3000)
                .score;
        expect(bad(0)).toBe(0);
        expect(bad(1)).toBeLessThan(0);
        expect(bad(100)).toBeLessThan(bad(1));
        expect(bad(1749)).toBeLessThan(bad(100));
        expect(bad(12596)).toBeLessThan(bad(1749));
        expect(Math.abs(bad(1))).toBeLessThan(Math.abs(bad(12596)) * 0.01);
    });

    test("neutral matchup means retain downside uncertainty until supported by data", () => {
        const sparse = getCounterBlindability(
            [interaction(0.5, 1)],
            prior,
            1000,
        );
        const supported = getCounterBlindability(
            [interaction(0.5, 10000)],
            prior,
            1000,
        );
        expect(sparse.counterExposure).toBeGreaterThan(
            supported.counterExposure,
        );
        expect(sparse.score).toBeGreaterThan(0);
        expect(sparse.score).toBeLessThan(supported.score * 0.01);
        expect(supported.score).toBeGreaterThan(0);
    });

    test("unknown opponents do not offset an observed counter", () => {
        const known = interaction(0.42, 1749, 0.2);
        const sparsePool = getCounterBlindability(
            [known, interaction(0.5, 0, 0.8)],
            prior,
            3000,
        );
        const expandedPool = getCounterBlindability(
            [
                known,
                ...Array.from({ length: 80 }, () => interaction(0.5, 0, 0.01)),
            ],
            prior,
            3000,
        );
        expect(sparsePool.score).toBeLessThan(0);
        expect(expandedPool.score).toBeCloseTo(sparsePool.score, 10);
    });

    test("sparse teammate data does not gain a flat-profile bonus", () => {
        const fit = (winrate: number, games: number) =>
            getAllyBlindability([interaction(winrate, games)], prior, 1000)
                .score;
        expect(fit(0.5, 0)).toBe(0);
        expect(fit(0.5, 1)).toBeLessThan(fit(0.5, 10000) * 0.01);
        expect(fit(0.4, 1)).toBeLessThan(0);
        expect(fit(0.4, 10000)).toBeLessThan(fit(0.4, 1));
        expect(fit(0.6, 10000)).toBeGreaterThan(fit(0.5, 10000));
    });

    test("tiny noisy samples do not inflate the learned role baseline", () => {
        // This distribution is exactly binomial sampling noise from 50%:
        // half of two-game samples split, a quarter win both, a quarter lose both.
        const noisy = getBlindInteractionPrior([
            { wins: 0, games: 2 },
            { wins: 1, games: 2 },
            { wins: 1, games: 2 },
            { wins: 2, games: 2 },
        ]);
        expect(noisy.standardDeviation).toBe(0);
        expect(noisy.counterExposure).toBe(0);
        expect(getBlindInteractionPrior([]).counterExposure).toBe(0);
    });

    test("exposure preserves uncertainty but never exceeds the requested cap of eight", () => {
        const severe = getCounterBlindability(
            [interaction(0.35, 1e8)],
            prior,
            1000,
        );
        const extreme = getCounterBlindability(
            [interaction(0, 1e8)],
            prior,
            1000,
        );
        expect(severe.counterExposure).toBeCloseTo(8, 10);
        expect(extreme.counterExposure).toBeCloseTo(8, 10);
        expect(severe.counterExposure).toBeLessThanOrEqual(8);
        expect(extreme.counterExposure).toBeLessThanOrEqual(8);
    });

    test("risk settings temper evidence without making a supported counter a safety bonus", () => {
        const score = (priorGames: number) =>
            getCounterBlindability([interaction(0.42, 1749)], prior, priorGames)
                .score;
        expect(score(3000)).toBeLessThan(0);
        expect(score(250)).toBeLessThan(score(3000));
    });
});
