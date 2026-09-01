import { JSXElement, createContext, createMemo, useContext } from "solid-js";
import { getSuggestions } from "@draftgap/core/src/draft/suggestions";
import { useDraftAnalysis } from "./DraftAnalysisContext";
import { useDataset } from "./DatasetContext";
import { useDraft } from "./DraftContext";

export function createDraftSuggestionsContext() {
    const { isLoaded, dataset, dataset30Days } = useDataset();
    const { suggestionConfig, allyTeamComp, opponentTeamComp } =
        useDraftAnalysis();
    const { bans } = useDraft();

    const allySuggestions = createMemo(() => {
        if (!isLoaded()) return [];

        return getSuggestions(
            dataset()!,
            dataset30Days()!,
            allyTeamComp(),
            opponentTeamComp(),
            suggestionConfig(),
            bans,
        );
    });

    const opponentSuggestions = createMemo(() => {
        if (!isLoaded()) return [];

        return getSuggestions(
            dataset()!,
            dataset30Days()!,
            opponentTeamComp(),
            allyTeamComp(),
            suggestionConfig(),
            bans,
        );
    });

    return { allySuggestions, opponentSuggestions };
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
