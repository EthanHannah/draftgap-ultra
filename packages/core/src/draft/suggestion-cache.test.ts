import { describe, expect, mock, test } from "bun:test";
import { Dataset } from "../models/dataset/Dataset";
import { Role } from "../models/Role";
import { createSuggestionCache } from "./suggestion-cache";
import { Suggestion, SuggestionConfig } from "./suggestions";

function setup() {
    // The injected calculator supplies scores; this cache only reads role volume.
    const dataset = {
        championData: {
            common: {
                statsByRole: { [Role.Top]: { games: 100000, wins: 50000 } },
            },
            niche: {
                statsByRole: { [Role.Top]: { games: 10000, wins: 5000 } },
            },
        },
    } as unknown as Dataset;
    const results = ["common", "niche"].map(
        (championKey) => ({ championKey, role: Role.Top }) as Suggestion,
    );
    const calculate = mock(() => results);
    const cache = createSuggestionCache(calculate);
    const config: SuggestionConfig = {
        championWinrateInfluence: 100,
        matchupInfluence: 100,
        duoInfluence: 100,
        riskLevel: "low",
        minGames: 5000,

        contextInfluence: 100,
        blindabilityWeight: 50,
        enemySafetyPriority: 75,
        compositionInfluence: 50,
    };
    const team = new Map<Role, string>();
    const enemy = new Map<Role, string>();
    const bans = new Set<string>();
    const run = () =>
        cache(dataset, dataset, [[team, 1]], [[enemy, 1]], config, bans);
    return { dataset, calculate, cache, config, team, enemy, bans, run };
}

describe("suggestion cache", () => {
    test("reuses equivalent drafts and applies display filters without recalculating", () => {
        const { run, calculate, config } = setup();
        expect(run().map((s) => s.championKey)).toEqual(["common"]);
        config.minGames = 1000;
        const both = run();
        expect(both.map((s) => s.championKey)).toEqual(["common", "niche"]);
        both.reverse();
        expect(run().map((s) => s.championKey)).toEqual(["common", "niche"]);
        config.minGames = 25000;
        expect(run()).toEqual([]);
        expect(calculate).toHaveBeenCalledTimes(1);
        // A cutoff below the scoring pool needs additional candidate scores.
        config.minGames = 500;
        run();
        expect(calculate).toHaveBeenCalledTimes(2);
    });

    test("invalidates on in-place draft, ban, weight, and risk changes", () => {
        const { run, calculate, team, enemy, config, bans } = setup();
        run();
        team.set(Role.Jungle, "ally");
        run();
        enemy.set(Role.Middle, "enemy");
        run();
        bans.add("banned");
        run();
        config.matchupInfluence = 0;
        run();
        config.duoInfluence = 25;
        run();
        config.riskLevel = "high";
        run();
        expect(calculate).toHaveBeenCalledTimes(7);
    });

    test("invalidates when either dataset is refreshed", () => {
        const { cache, config, dataset, calculate, run } = setup();
        run();
        const refreshed = { ...dataset };
        cache(refreshed, dataset, [], [], config);
        cache(refreshed, refreshed, [], [], config);
        expect(calculate).toHaveBeenCalledTimes(3);
    });

    test("includes role-assignment probabilities and bounds retained drafts", () => {
        const { cache, config, dataset, calculate } = setup();
        const first = new Map<Role, string>([[Role.Top, "ally"]]);
        const second = new Map<Role, string>([[Role.Jungle, "ally"]]);
        for (const probability of [0.5, 0.6, 0.7, 0.8, 0.9, 0.5]) {
            cache(
                dataset,
                dataset,
                [
                    [first, probability],
                    [second, 1 - probability],
                ],
                [],
                config,
            );
        }
        expect(calculate).toHaveBeenCalledTimes(6);
    });
});
