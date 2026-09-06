import {
    JSXElement,
    batch,
    createContext,
    createEffect,
    createSignal,
    onCleanup,
    useContext,
} from "solid-js";
import type { Suggestion } from "@draftgap/core/src/draft/suggestions";
import { createSuggestionWorker } from "../utils/suggestion-worker";
import { useDraftAnalysis } from "./DraftAnalysisContext";
import { useDataset } from "./DatasetContext";
import { useDraft } from "./DraftContext";
import { useDraftView } from "./DraftViewContext";
import { useMedia } from "../hooks/useMedia";

export function createDraftSuggestionsContext() {
    const { isLoaded, dataset, dataset30Days } = useDataset();
    const { suggestionConfig, allyTeamComps, opponentTeamComps } =
        useDraftAnalysis();
    const { bans, selection } = useDraft();
    const { currentDraftView } = useDraftView();
    const { isMobileLayout } = useMedia();
    const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
    const [isCalculating, setIsCalculating] = createSignal(false);
    const [error, setError] = createSignal<string>();
    let client: ReturnType<typeof createSuggestionWorker> | undefined;
    onCleanup(() => client?.dispose());

    createEffect(() => {
        const view = currentDraftView();
        if (
            !isLoaded() ||
            view.type !== "draft" ||
            (isMobileLayout() && view.subType !== "draft")
        ) {
            client?.clear();
            batch(() => {
                setSuggestions([]);
                setIsCalculating(false);
                setError(undefined);
            });
            return;
        }
        const isOpponent = selection.team === "opponent";
        // Snapshot reactive values before posting; Solid store proxies cannot
        // be structured-cloned. Datasets are immutable resource values.
        const input = {
            dataset: dataset()!,
            interactions: dataset30Days()!,
            team: isOpponent ? opponentTeamComps() : allyTeamComps(),
            enemy: isOpponent ? allyTeamComps() : opponentTeamComps(),
            config: suggestionConfig(),
            bans: [...bans],
        };
        batch(() => {
            setSuggestions([]);
            setError(undefined);
            setIsCalculating(true);
        });
        try {
            client ??= createSuggestionWorker(
                new Worker(
                    new URL(
                        "../workers/suggestions.worker.ts",
                        import.meta.url,
                    ),
                    { type: "module" },
                ),
                (response) =>
                    batch(() => {
                        setSuggestions(
                            "suggestions" in response
                                ? response.suggestions
                                : [],
                        );
                        setError(
                            "error" in response ? response.error : undefined,
                        );
                        setIsCalculating(false);
                    }),
            );
            client.request(input);
        } catch (error) {
            setError(error instanceof Error ? error.message : String(error));
            setIsCalculating(false);
        }
    });

    return { suggestions, isCalculating, error };
}

export const DraftSuggestionsContext =
    createContext<ReturnType<typeof createDraftSuggestionsContext>>();

export function DraftSuggestionsProvider(props: { children: JSXElement }) {
    return (
        <DraftSuggestionsContext.Provider
            value={createDraftSuggestionsContext()}
        >
            {props.children}
        </DraftSuggestionsContext.Provider>
    );
}

export function useDraftSuggestions() {
    const useCtx = useContext(DraftSuggestionsContext);
    if (!useCtx) throw new Error("No DraftSuggestionsContext found");

    return useCtx;
}
