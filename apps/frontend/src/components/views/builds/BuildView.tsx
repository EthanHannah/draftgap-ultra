import { Component, For, Match, Show, Switch } from "solid-js";
import { useBuild } from "../../../contexts/BuildContext";
import { Button } from "../../common/Button";
import { RecommendedBuild } from "./RecommendedBuild";

export const BuildView: Component = () => {
    const { query, buildAnalysisResult, championRole } = useBuild();

    return (
        <>
            <Switch>
                <Match when={championRole() === undefined}>
                    <div class="text-neutral-400 text-center p-8">
                        Assign this champion a role to view builds.
                    </div>
                </Match>
                <Match when={query.isLoading}>
                    <div class="text-neutral-50 text-2xl text-center grid place-items-center h-full">
                        Loading...
                    </div>
                </Match>
                <Match when={query.isError}>
                    <div class="text-center flex flex-col items-center justify-center gap-4 h-full">
                        <p class="text-red-400">
                            {query.error instanceof Error
                                ? query.error.message
                                : "Error while fetching build data"}
                        </p>
                        <Button onClick={() => void query.refetch()}>
                            Retry
                        </Button>
                    </div>
                </Match>
                <Match when={query.isSuccess && buildAnalysisResult()}>
                    <div class="flex flex-col gap-6">
                        <Show when={query.data?.warnings.length}>
                            <div
                                class="rounded-md border border-amber-800 bg-amber-950/20 p-4 text-amber-200 text-sm"
                                role="status"
                            >
                                <For each={query.data?.warnings}>
                                    {(warning) => <p>{warning}</p>}
                                </For>
                                <button
                                    class="underline mt-2 disabled:opacity-50"
                                    disabled={query.isFetching}
                                    onClick={() => void query.refetch()}
                                >
                                    {query.isFetching
                                        ? "Retrying…"
                                        : "Retry missing data"}
                                </button>
                            </div>
                        </Show>
                        <RecommendedBuild />
                    </div>
                </Match>
            </Switch>
        </>
    );
};
