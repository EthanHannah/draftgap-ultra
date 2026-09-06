import { createSuggestionCache } from "@draftgap/core/src/draft/suggestion-cache";
import type {
    SuggestionRequest,
    SuggestionResponse,
} from "./suggestions.types";

const calculate = createSuggestionCache();
let datasets: SuggestionRequest["datasets"];

self.onmessage = ({ data }: MessageEvent<SuggestionRequest>) => {
    let response: SuggestionResponse;
    try {
        if (data.datasets) datasets = data.datasets;
        if (!datasets) throw new Error("Recommendation data is unavailable.");
        response = {
            id: data.id,
            suggestions: calculate(
                datasets.dataset,
                datasets.interactions,
                data.team,
                data.enemy,
                data.config,
                data.bans,
            ),
        };
    } catch (error) {
        response = {
            id: data.id,
            error: error instanceof Error ? error.message : String(error),
        };
    }
    self.postMessage(response);
};
