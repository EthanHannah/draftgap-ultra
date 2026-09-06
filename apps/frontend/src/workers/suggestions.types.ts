import type { Dataset } from "@draftgap/core/src/models/dataset/Dataset";
import type { WeightedTeamComp } from "@draftgap/core/src/draft/analysis";
import type {
    Suggestion,
    SuggestionConfig,
} from "@draftgap/core/src/draft/suggestions";

export type SuggestionInput = {
    dataset: Dataset;
    interactions: Dataset;
    team: WeightedTeamComp[];
    enemy: WeightedTeamComp[];
    config: SuggestionConfig;
    bans: string[];
};

export type SuggestionRequest = Omit<
    SuggestionInput,
    "dataset" | "interactions"
> & {
    id: number;
    datasets?: { dataset: Dataset; interactions: Dataset };
};

export type SuggestionResponse =
    | { id: number; suggestions: Suggestion[] }
    | { id: number; error: string };
