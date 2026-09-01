import { RiskLevel } from "../../risk/risk-level";
import { RoleWeights } from "../Role";

export type StatsSite = "op.gg" | "u.gg" | "lolalytics";

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
    blindabilityWeight: number;
    enemySafetyPriority: number;
    compositionInfluence: number;
    showAdvancedWinrates: boolean;
    language: string;

    // MISC
    defaultStatsSite: StatsSite;
    enableBetaFeatures: boolean;

    // LOL CLIENT
    disableLeagueClientIntegration: boolean;
};
