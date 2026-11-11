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
        // Rows are compared with a typical champion at the same evidence, so
        // a few games of any result are negligible rather than signed.
        expect(Math.abs(bad(1))).toBeLessThan(Math.abs(bad(12596)) * 0.01);
        expect(Math.abs(bad(10))).toBeLessThan(Math.abs(bad(12596)) * 0.01);
        expect(bad(100)).toBeLessThan(0);
        expect(bad(1749)).toBeLessThan(bad(100));
        expect(bad(12596)).toBeLessThan(bad(1749));
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
        // One game sits inside the same-evidence baseline's noise.
        expect(sparse.score).toBeLessThan(supported.score * 0.03);
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

    test("ally downside is translation invariant and sparse evidence earns negligible certainty", () => {
        const fit = (winrate: number, games: number) =>
            getAllyBlindability([interaction(winrate, games)], prior, 1000)
                .score;
        expect(fit(0.5, 0)).toBe(0);
        expect(fit(0.5, 1)).toBeLessThan(fit(0.5, 10000) * 0.01);
        // A consistently bad teammate fit belongs to expected performance,
        // not a second mean penalty hidden inside blindability.
        expect(fit(0.4, 1)).toBeCloseTo(fit(0.5, 1), 10);
        expect(fit(0.4, 10000)).toBeCloseTo(fit(0.5, 10000), 10);
        expect(fit(0.6, 10000)).toBeCloseTo(fit(0.5, 10000), 10);
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
    test("a typical pool scores neutral at every sample size", () => {
        // Observed effects at evenly spaced quantiles of the marginal
        // distribution a typical champion would produce at this sample size.
        const typicalPool = (games: number) => {
            const spread = Math.sqrt(prior.variance + 0.25 / games);
            return Array.from({ length: 199 }, (_, index) => {
                const p = (index + 0.5) / 199;
                // Inverse normal CDF by bisection.
                let low = -8;
                let high = 8;
                for (let step = 0; step < 60; step++) {
                    const mid = (low + high) / 2;
                    const cdf = 0.5 * (1 + erf(mid / Math.SQRT2));
                    if (cdf < p) low = mid;
                    else high = mid;
                }
                return interaction(0.5 + spread * low, games);
            });
        };
        const supported = Math.abs(
            getCounterBlindability([interaction(0.42, 12596)], prior, 1000)
                .score,
        );
        for (const games of [10, 300, 3000, 100000]) {
            const score = getCounterBlindability(
                typicalPool(games),
                prior,
                1000,
            ).score;
            expect(Math.abs(score)).toBeLessThan(supported * 0.02);
        }
    });

    test("counterpicks weight a known counter above its forecast share", () => {
        const counter = interaction(0.44, 20000, 0.1);
        const neutral = interaction(0.5, 20000, 0.9);
        const single = (row: ReturnType<typeof interaction>) =>
            getCounterBlindability([{ ...row, weight: 1 }], prior, 1000)
                .counterExposure;
        const pool = getCounterBlindability([counter, neutral], prior, 1000);
        const forecastOnly = 0.1 * single(counter) + 0.9 * single(neutral);
        expect(pool.counterExposure).toBeGreaterThan(forecastOnly);
        const noCounterpicks = getCounterBlindability(
            [counter, neutral],
            prior,
            1000,
            0,
        );
        expect(noCounterpicks.counterExposure).toBeCloseTo(forecastOnly, 10);
        const moreCounterpicks = getCounterBlindability(
            [counter, neutral],
            prior,
            1000,
            0.9,
        );
        expect(moreCounterpicks.score).toBeLessThan(pool.score);
    });
});

function erf(x: number) {
    // Abramowitz and Stegun 7.1.26; accurate to 1.5e-7.
    const sign = Math.sign(x);
    const t = 1 / (1 + 0.3275911 * Math.abs(x));
    const y =
        1 -
        ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t -
            0.284496736) *
            t +
            0.254829592) *
            t *
            Math.exp(-x * x);
    return sign * y;
}
