import { JSXElement, createContext, createMemo, useContext } from "solid-js";
import { createSuggestionCache } from "@draftgap/core/src/draft/suggestion-cache";
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
    const calculate = createSuggestionCache();

    const suggestions = createMemo(() => {
        const view = currentDraftView();
        if (
            !isLoaded() ||
            view.type !== "draft" ||
            (isMobileLayout() && view.subType !== "draft")
        )
            return [];
        const isOpponent = selection.team === "opponent";
        return calculate(
            dataset()!,
            dataset30Days()!,
            isOpponent ? opponentTeamComps() : allyTeamComps(),
            isOpponent ? allyTeamComps() : opponentTeamComps(),
            suggestionConfig(),
            bans,
        );
    });

    return { suggestions };
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
