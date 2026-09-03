import { describe, expect, test } from "bun:test";
import { getChampionScaling } from "./scaling";

function makeStats(
    winrates: number[],
    games = [10000, 5000, 5000, 5000, 5000],
) {
    const statsByTime = winrates.map((winrate, i) => ({
        wins: winrate * games[i],
        games: games[i],
    }));
    return {
        wins: statsByTime.reduce((sum, stats) => sum + stats.wins, 0),
        games: statsByTime.reduce((sum, stats) => sum + stats.games, 0),
        statsByTime,
    };
}

describe("champion scaling", () => {
    test("identifies early, mid, and late performance peaks", () => {
        expect(
            getChampionScaling(makeStats([0.56, 0.51, 0.5, 0.46, 0.45])),
        ).toBe("early");
        expect(
            getChampionScaling(makeStats([0.46, 0.55, 0.56, 0.48, 0.47])),
        ).toBe("mid");
        expect(
            getChampionScaling(makeStats([0.45, 0.48, 0.49, 0.55, 0.57])),
        ).toBe("late");
    });

    test("recognizes flat profiles regardless of overall champion strength", () => {
        for (const baseline of [0.4, 0.5, 0.6]) {
            expect(getChampionScaling(makeStats(Array(5).fill(baseline)))).toBe(
                "stable",
            );
        }
        expect(
            getChampionScaling(makeStats([0.5, 0.505, 0.51, 0.5, 0.505])),
        ).toBe("stable");
    });

    test("recognizes symmetric and uneven U-shaped curves before a single peak", () => {
        for (const curve of [
            [0.56, 0.48, 0.48, 0.56, 0.56],
            [0.6, 0.48, 0.48, 0.53, 0.55],
            [0.54, 0.48, 0.48, 0.58, 0.6],
        ]) {
            expect(getChampionScaling(makeStats(curve))).toBe("u-shaped");
        }
    });

    test("requires a meaningful mid-game dip below both ends", () => {
        expect(
            getChampionScaling(makeStats([0.56, 0.5, 0.5, 0.505, 0.505])),
        ).toBe("early");
        expect(
            getChampionScaling(makeStats([0.505, 0.5, 0.5, 0.56, 0.56])),
        ).toBe("late");
        expect(
            getChampionScaling(makeStats([0.505, 0.5, 0.5, 0.505, 0.505])),
        ).toBe("stable");
    });

    test("recognizes shallow U-shaped curves before Stable at the adjusted cutoff", () => {
        expect(
            getChampionScaling(makeStats([0.5138, 0.5, 0.5, 0.5138, 0.5138])),
        ).toBe("u-shaped");
        expect(
            getChampionScaling(makeStats([0.5137, 0.5, 0.5, 0.5137, 0.5137])),
        ).toBe("stable");
    });

    test("classifies Karthus jungle as Stable at the stricter cutoff", () => {
        // Rounded win rates from the unchanged 30-day dataset, 2026-09-02.
        const stats = makeStats(
            [0.491459, 0.491273, 0.473056, 0.48266, 0.488682],
            [6881, 10177, 21652, 20191, 30093],
        );
        stats.games = 73571;
        stats.wins = stats.games * 0.487489;
        expect(getChampionScaling(stats)).toBe("stable");
    });

    test("classifies Vladimir bot's observed early and late strengths as U-shaped", () => {
        // Rounded win rates from the 30-day dataset dated 2026-09-02.
        const stats = makeStats(
            [0.527659, 0.455259, 0.484763, 0.514339, 0.522019],
            [3903, 6984, 14393, 11625, 16656],
        );
        stats.games = 43752;
        stats.wins = stats.games * 0.500285;
        expect(getChampionScaling(stats)).toBe("u-shaped");
    });

    test("does not infer a U-shaped curve from sparse or noisy endpoints", () => {
        expect(
            getChampionScaling(
                makeStats(
                    [0.6, 0.48, 0.48, 0.6, 0.6],
                    [499, 5000, 5000, 5000, 5000],
                ),
            ),
        ).toBeUndefined();
        expect(
            getChampionScaling(
                makeStats(
                    [0.518, 0.5, 0.5, 0.518, 0.518],
                    [500, 10000, 10000, 250, 250],
                ),
            ),
        ).toBe("stable");
    });

    test("classifies the curve relative to the champion's own baseline", () => {
        const curve = [0.4, 0.5, 0.5, 0.44, 0.44];
        const games = [12000, 10000, 8000, 3000, 1000];
        for (const offset of [0, 0.1]) {
            expect(
                getChampionScaling(
                    makeStats(
                        curve.map((w) => w + offset),
                        games,
                    ),
                ),
            ).toBe("mid");
        }
    });

    test("weights duration buckets by games when combining a phase", () => {
        // The small 20–25 minute bucket must not turn a late peak into Mid.
        expect(
            getChampionScaling(
                makeStats(
                    [0.45, 0.9, 0.45, 0.57, 0.57],
                    [10000, 500, 20000, 5000, 5000],
                ),
            ),
        ).toBe("late");
    });

    test("shrinks a noisy small phase toward the overall role win rate", () => {
        expect(
            getChampionScaling(
                makeStats(
                    [0.54, 0.5, 0.5, 0.5, 0.5],
                    [500, 10000, 10000, 10000, 10000],
                ),
            ),
        ).toBe("stable");
        expect(getChampionScaling(makeStats([0.54, 0.5, 0.5, 0.5, 0.5]))).toBe(
            "early",
        );
    });

    test("does not label missing or insufficient data Stable", () => {
        expect(getChampionScaling(undefined)).toBeUndefined();
        expect(getChampionScaling(makeStats([]))).toBeUndefined();
        expect(
            getChampionScaling(makeStats([0.5, 0.5, 0.5, 0.5])),
        ).toBeUndefined();
        for (const games of [
            [499, 5000, 5000, 5000, 5000],
            [10000, 200, 299, 5000, 5000],
            [10000, 5000, 5000, 200, 299],
        ]) {
            expect(
                getChampionScaling(makeStats(Array(5).fill(0.5), games)),
            ).toBeUndefined();
        }
    });

    test("rejects invalid baseline and time statistics", () => {
        for (const invalid of [NaN, Infinity, -1]) {
            const stats = makeStats(Array(5).fill(0.5));
            expect(
                getChampionScaling({ ...stats, wins: invalid }),
            ).toBeUndefined();
            expect(
                getChampionScaling({ ...stats, games: invalid }),
            ).toBeUndefined();
            stats.statsByTime[2].wins = invalid;
            expect(getChampionScaling(stats)).toBeUndefined();
        }
        const stats = makeStats(Array(5).fill(0.5));
        expect(getChampionScaling({ ...stats, games: 0 })).toBeUndefined();
        expect(
            getChampionScaling({ ...stats, wins: stats.games + 1 }),
        ).toBeUndefined();
        stats.statsByTime[0].wins = stats.statsByTime[0].games + 1;
        expect(getChampionScaling(stats)).toBeUndefined();
    });

    test("keeps champion roles independent", () => {
        const champion = {
            top: makeStats([0.56, 0.51, 0.5, 0.46, 0.45]),
            jungle: makeStats([0.45, 0.48, 0.49, 0.55, 0.57]),
        };
        expect(getChampionScaling(champion.top)).toBe("early");
        expect(getChampionScaling(champion.jungle)).toBe("late");
    });
});
