/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryObserver } from "@tanstack/solid-query";
import { Role } from "@draftgap/core/src/models/Role";
import { Dataset } from "@draftgap/core/src/models/dataset/Dataset";
import { BuildQueryKey, getBuildPlaceholderData } from "./build-query";

const dataset = { version: "16.17.1" } as Dataset;
const initialKey: BuildQueryKey = [
    "build",
    "current-patch",
    "103",
    Role.Middle,
    {},
    dataset,
];

describe("build updates during champ select", () => {
    test("keeps the build visible through successive opponent lock-ins", async () => {
        const client = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const initialBuild = { championKey: "103", matchups: 0 };
        client.setQueryData(initialKey, initialBuild);
        const observer = new QueryObserver(client, {
            queryKey: initialKey,
            queryFn: async () => initialBuild,
            staleTime: Infinity,
        });
        const unsubscribe = observer.subscribe(() => {});
        let finishUpdate!: (data: typeof initialBuild) => void;
        const pendingBuild = new Promise<typeof initialBuild>((resolve) => {
            finishUpdate = resolve;
        });
        const update = (matchups: BuildQueryKey[4]) => {
            const queryKey = initialKey;
            const nextKey: BuildQueryKey = [
                queryKey[0],
                queryKey[1],
                queryKey[2],
                queryKey[3],
                matchups,
                queryKey[5],
            ];
            observer.setOptions({
                queryKey: nextKey,
                queryFn: () => pendingBuild,
                placeholderData: (data, query) =>
                    getBuildPlaceholderData(data, query, nextKey),
            });
        };

        try {
            update({ [Role.Top]: "86" });
            expect(observer.getCurrentResult()).toMatchObject({
                data: initialBuild,
                isLoading: false,
                isSuccess: true,
                isFetching: true,
                isPlaceholderData: true,
            });
            update({ [Role.Top]: "86", [Role.Middle]: "99" });
            expect(observer.getCurrentResult()).toMatchObject({
                data: initialBuild,
                isLoading: false,
                isPlaceholderData: true,
            });

            const updatedBuild = { championKey: "103", matchups: 2 };
            finishUpdate(updatedBuild);
            await observer.refetch();
            expect(observer.getCurrentResult()).toMatchObject({
                data: updatedBuild,
                isFetching: false,
                isPlaceholderData: false,
            });
        } finally {
            unsubscribe();
            client.clear();
        }
    });

    test("does not show an old build when champion, role, range or dataset changes", () => {
        const build = { championKey: "103" };
        const changes: BuildQueryKey[] = [
            ["build", "current-patch", "99", Role.Middle, {}, dataset],
            ["build", "current-patch", "103", Role.Support, {}, dataset],
            ["build", "30-days", "103", Role.Middle, {}, dataset],
            ["build", "current-patch", "103", Role.Middle, {}, { ...dataset }],
            ["build", "current-patch", undefined, undefined, {}, dataset],
        ];
        for (const key of changes) {
            expect(
                getBuildPlaceholderData(build, { queryKey: initialKey }, key),
            ).toBeUndefined();
        }
        expect(
            getBuildPlaceholderData(undefined, undefined, initialKey),
        ).toBeUndefined();
    });
});
