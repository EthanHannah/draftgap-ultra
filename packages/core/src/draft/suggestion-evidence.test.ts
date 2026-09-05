import { describe, expect, test } from "bun:test";
import {
    getPickEvidence,
    summarizeSuggestionEvidence,
} from "./suggestion-evidence";
import { aggregateDraftResults, WeightedDraftResult } from "./analysis";
import { Role } from "../models/Role";

function draft(games: number, rating: number): WeightedDraftResult {
    const result = aggregateDraftResults([]);
    result.allyChampionRating.championResults.push({
        championKey: "ahri",
        role: Role.Middle,
        games,
        wins: games / 2,
        rating,
    });
    return { result, weight: 1 };
}

describe("suggestion evidence", () => {
    test("poor scores with substantial evidence are not marked uncertain", () => {
        const evidence = getPickEvidence(
            [draft(20000, -15)],
            "ahri",
            1000,
            true,
        );
        expect(summarizeSuggestionEvidence(evidence).level).toBe("supported");
    });

    test("sparse and absent base data remain uncertain even at a neutral score", () => {
        for (const games of [0, 100, NaN]) {
            const evidence = getPickEvidence(
                [draft(games, 0)],
                "ahri",
                1000,
                true,
            );
            expect(summarizeSuggestionEvidence(evidence).level).toBe(
                "very-limited",
            );
        }
    });

    test("a sparse matchup driving the ranking outweighs abundant base games", () => {
        const row = draft(100000, 2);
        row.result.matchupRating.matchupResults.push({
            championKeyA: "ahri",
            championKeyB: "zed",
            roleA: Role.Middle,
            roleB: Role.Middle,
            games: 100,
            wins: 60,
            rating: 15,
        });
        expect(
            summarizeSuggestionEvidence(
                getPickEvidence([row], "ahri", 1000, true),
            ).level,
        ).toBe("very-limited");
        row.result.matchupRating.matchupResults[0].games = 20000;
        expect(
            summarizeSuggestionEvidence(
                getPickEvidence([row], "ahri", 1000, true),
            ).level,
        ).toBe("supported");
    });

    test("unrelated teammates and disabled effects do not influence confidence", () => {
        const row = draft(20000, 10);
        row.result.matchupRating.matchupResults.push({
            championKeyA: "garen",
            championKeyB: "darius",
            roleA: Role.Top,
            roleB: Role.Top,
            games: 0,
            wins: 0,
            rating: 100,
        });
        row.result.allyDuoRating.duoResults.push({
            championKeyA: "ahri",
            championKeyB: "garen",
            roleA: Role.Middle,
            roleB: Role.Top,
            games: 0,
            wins: 0,
            rating: 0,
        });
        const evidence = getPickEvidence([row], "ahri", 1000, true);
        expect(summarizeSuggestionEvidence(evidence).level).toBe("supported");
        expect(
            summarizeSuggestionEvidence(
                getPickEvidence([row], "ahri", 1000, false),
            ).support,
        ).toBe(0);
    });

    test("well sampled role assignments do not hide equally likely missing data", () => {
        const known = draft(1000000, 10);
        const unknown = draft(0, 10);
        known.weight = unknown.weight = 0.5;
        expect(
            summarizeSuggestionEvidence(
                getPickEvidence([known, unknown], "ahri", 1000, true),
            ).level,
        ).toBe("limited");
    });

    test("unsupported heuristics cannot create high confidence", () => {
        expect(
            summarizeSuggestionEvidence([
                { rating: 1, support: 0.95 },
                { rating: 10, support: 0 },
            ]).level,
        ).toBe("very-limited");
        expect(summarizeSuggestionEvidence([]).level).toBe("very-limited");
    });
});
