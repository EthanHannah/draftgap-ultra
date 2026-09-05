import { Role } from "../models/Role";

export function getInteractionInfluenceWeight(influence = 100) {
    return Math.min(100, Math.max(0, influence)) / 100;
}

// Rows are the champion's role; columns are Top/Jungle/Mid/Bot/Support.
// These are conservative design defaults, not fitted win-rate coefficients.
// Each row totals 100%. Matchup symmetry keeps team-side swaps consistent;
// missing draft slots never redistribute their influence.
export const MATCHUP_ROLE_PRIORITIES = {
    [Role.Top]: [35, 20, 15, 15, 15],
    [Role.Jungle]: [15, 25, 20, 20, 20],
    [Role.Middle]: [15, 20, 30, 17.5, 17.5],
    [Role.Bottom]: [15, 17.5, 17.5, 25, 25],
    [Role.Support]: [15, 17.5, 17.5, 25, 25],
} as const;

// Duo rows are directional priorities for recommendations.
export const DUO_ROLE_PRIORITIES = {
    [Role.Top]: [0, 25, 25, 25, 25],
    [Role.Jungle]: [25, 0, 25, 25, 25],
    [Role.Middle]: [25, 25, 0, 25, 25],
    [Role.Bottom]: [20, 25, 25, 0, 30],
    [Role.Support]: [20, 25, 25, 30, 0],
} as const;

export function getMatchupInteractionWeight(role: Role, opponentRole: Role) {
    // Restore the original five-opponent scoring budget.
    return (MATCHUP_ROLE_PRIORITIES[role][opponentRole] / 100) * 5;
}

export function getDuoInteractionWeight(role: Role, teammateRole: Role) {
    return (DUO_ROLE_PRIORITIES[role][teammateRole] / 100) * 4;
}

export function getTeamDuoInteractionWeight(role: Role, teammateRole: Role) {
    // The team score counts a pair once. Average the two roles' weights so
    // asymmetric preferences never depend on which role is enumerated first.
    return (
        (getDuoInteractionWeight(role, teammateRole) +
            getDuoInteractionWeight(teammateRole, role)) /
        2
    );
}

export function getBlindMatchupInteractionWeight(
    role: Role,
    opponentRole: Role,
) {
    // Blind matchup risk retains its smaller overall budget of 1.5.
    return getMatchupInteractionWeight(role, opponentRole) * 0.3;
}
