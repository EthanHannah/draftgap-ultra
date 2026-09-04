import { RiskLevel } from "../../risk/risk-level";
import { RoleWeights } from "../Role";

export const DEFAULT_RECOMMENDATION_MIN_GAMES = 5000;

export type StatsSite = "op.gg" | "u.gg" | "lolalytics";
export type LolalyticsTimeRange = "current-patch" | "30-days";

export const DraftTablePlacement = {
    Bottom: "bottom",
    Hidden: "hidden",
    InPlace: "in-place",
} as const;
type DraftTablePlacement =
    (typeof DraftTablePlacement)[keyof typeof DraftTablePlacement];

export type DraftGapConfig = {
    // DRAFT ANALYSIS
    championWinrateInfluence: number;
    riskLevel: RiskLevel;
    minGames: number;
    matchupRoleWeights: RoleWeights;
    duoRoleWeights: RoleWeights;
    analyzeHovers: boolean;

    // DRAFT SUGGESTIONS
    showFavouritesAtTop: boolean;
    banPlacement: DraftTablePlacement;
    unownedPlacement: DraftTablePlacement;
    contextInfluence: number;
    blindabilityWeight: number;
    enemySafetyPriority: number;
    compositionInfluence: number;
    showAdvancedWinrates: boolean;
    language: string;

    // MISC
    defaultStatsSite: StatsSite;
    lolalyticsTimeRange: LolalyticsTimeRange;
    enableBetaFeatures: boolean;

    // LOL CLIENT
    disableLeagueClientIntegration: boolean;
};
