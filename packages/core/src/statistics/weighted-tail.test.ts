import { describe, expect, test } from "bun:test";
import { weightedLowerTailSum } from "./weighted-tail";

function sortedTail(
    rows: { rating: number; weight: number }[],
    weight: number,
) {
    let sum = 0;
    for (const row of [...rows].sort((a, b) => a.rating - b.rating)) {
        const included = Math.min(weight, row.weight);
        sum += included * row.rating;
        weight -= included;
        if (weight <= 0) break;
    }
    return sum;
}

describe("weighted tail selection", () => {
    test("matches sorted tails across ties, fractional weights, and input orders", () => {
        const rows = Array.from({ length: 1500 }, (_, i) => ({
            rating: ((i * 37) % 103) - 51,
            weight: (((i * 13) % 41) + 1) / 100,
        }));
        const orders = [
            rows,
            [...rows].reverse(),
            [...rows].sort((a, b) => a.rating - b.rating),
        ];
        for (const ordered of orders) {
            const total = ordered.reduce((sum, row) => sum + row.weight, 0);
            for (const fraction of [0.0001, 0.2, 0.5, 0.9999, 1]) {
                expect(
                    weightedLowerTailSum([...ordered], total * fraction),
                ).toBeCloseTo(sortedTail(ordered, total * fraction), 8);
            }
        }
    });

    test("includes only the required fraction of a dominant observation", () => {
        expect(
            weightedLowerTailSum(
                [
                    { rating: 10, weight: 1 },
                    { rating: -5, weight: 100 },
                    { rating: -20, weight: 1 },
                ],
                10,
            ),
        ).toBe(-65);
        expect(
            weightedLowerTailSum(
                Array.from({ length: 100 }, () => ({ rating: -3, weight: 1 })),
                20,
            ),
        ).toBe(-60);
        expect(weightedLowerTailSum([], 0)).toBe(0);
    });
});
