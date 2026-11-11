import { Role } from "../models/Role";

export function getInteractionInfluenceWeight(influence = 100) {
    return Math.min(100, Math.max(0, influence)) / 100;
}

// Rows are the champion's role; columns are Top/Jungle/Mid/Bot/Support.
// Each row totals 100%, so every pair carries weight one. A measured pair
// effect is already its full effect on the game result, and per-pair
// shrinkage (pair-prior.ts) already discounts role pairs whose effects are
// small or noisy. Uneven hand-set priorities would rescale measured effects
// (a 1.75x top lane weight inflated matchup variance by ~40%) and broke
// team-side symmetry. Reintroduce unequal weights only if fitted on outcomes.
export const MATCHUP_ROLE_PRIORITIES = {
    [Role.Top]: [20, 20, 20, 20, 20],
    [Role.Jungle]: [20, 20, 20, 20, 20],
    [Role.Middle]: [20, 20, 20, 20, 20],
    [Role.Bottom]: [20, 20, 20, 20, 20],
    [Role.Support]: [20, 20, 20, 20, 20],
} as const;

export const DUO_ROLE_PRIORITIES = {
    [Role.Top]: [0, 25, 25, 25, 25],
    [Role.Jungle]: [25, 0, 25, 25, 25],
    [Role.Middle]: [25, 25, 0, 25, 25],
    [Role.Bottom]: [25, 25, 25, 0, 25],
    [Role.Support]: [25, 25, 25, 25, 0],
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

// Share of a blind pick's opponents in each role assumed to counterpick it.
// Players counterpick their direct opponent: the same role, or either enemy
// bot laner for bot and support. Cross-role matchups still carry their full
// measured spread; they are just rarely chosen to target this pick.
export const LANE_COUNTERPICK_SHARE = 0.5;
export const CROSS_ROLE_COUNTERPICK_SHARE = 0.1;

export function getBlindCounterpickShare(role: Role, opponentRole: Role) {
    const botLane = (lane: Role) =>
        lane === Role.Bottom || lane === Role.Support;
    return role === opponentRole || (botLane(role) && botLane(opponentRole))
        ? LANE_COUNTERPICK_SHARE
        : CROSS_ROLE_COUNTERPICK_SHARE;
}
