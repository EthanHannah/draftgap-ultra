import { Role } from "../models/Role";
import { Dataset } from "../models/dataset/Dataset";
import {
    COMPOSITION_CAPABILITIES,
    CompositionCapability,
    CompositionProfile,
    getCompositionProfile,
} from "./profiles";
import { getCombatProfile } from "./combat-profiles";

export const COMPOSITION_DIMENSIONS = [
    "damageBalance",
    ...COMPOSITION_CAPABILITIES,
    "fightPlan",
] as const;

export type CompositionDimension = (typeof COMPOSITION_DIMENSIONS)[number];

export const COMPOSITION_SCORE_WEIGHTS = {
    damageBalance: 1.35,
    frontline: 1,
    fightPlan: 1.1,
    hardCrowdControl: 1,
    waveclear: 0.85,
    sustainedDamage: 0.7,
} as const satisfies Partial<Record<CompositionDimension, number>>;

export type CompositionCoverage = Record<CompositionDimension, number>;

export type TeamCompositionScore = {
    coverage: CompositionCoverage;
    capabilityTotals: Record<CompositionCapability, number>;
    score: number;
    hasProfiles: boolean;
    members: CompositionMember[];
    plans: { engage: number; protect: number; siege: number };
};

type CompositionMember = {
    profile: CompositionProfile;
    combat: ReturnType<typeof getCombatProfile>;
    damageThreat: number;
};

export type EnemyCompositionPressures = {
    frontline: number;
    engage: number;
    peel: number;
    waveclear: number;
};

export type EnemyResponseScore = {
    pressures: EnemyCompositionPressures;
    score: number;
};

const COMPOSITION_SCORE_TO_WINRATE = 0.12;
const MAX_COMPOSITION_WINRATE_DELTA = 0.02;
const ENEMY_RESPONSE_INFLUENCE = 0.25;
const ENEMY_RESPONSE_CATEGORY_WEIGHT = {
    frontline: 1,
    engage: 1,
    waveclear: 0.35,
} as const;

function clamp(value: number, min = 0, max = 1) {
    return Math.min(max, Math.max(min, value));
}

// A primary provider contributes 0.75, leaving room for useful redundancy.
// Squaring strengths prevents several situational tools from replacing one
// reliable provider. This is a bounded heuristic, not a success probability.
function getCoverage(strengths: number[]) {
    return (
        1 -
        strengths.reduce(
            (remaining, strength) =>
                remaining * (1 - 0.75 * clamp(strength) ** 2),
            1,
        )
    );
}

function getProtection(members: CompositionMember[]) {
    const peel = getCoverage(members.map(({ profile }) => profile.peel));
    const frontline = getCoverage(
        members.map(({ profile }) => profile.frontline),
    );
    // Standing in front can help, but does not replace disengage or saves.
    return peel + (1 - peel) * frontline * 0.15;
}

function getFightPlans(members: CompositionMember[]) {
    const engagePairs: number[] = [];
    const protectPairs: number[] = [];
    const siegePairs: number[] = [];
    for (const [index, member] of members.entries()) {
        const allies = members.filter((_, allyIndex) => allyIndex !== index);
        if (allies.length === 0) continue;
        const followUp = getCoverage(
            allies.map((ally) => ally.damageThreat * ally.combat.followUp),
        );
        engagePairs.push(member.profile.engage * followUp);
        const protection = getProtection(allies);
        protectPairs.push(
            member.profile.sustainedDamage *
                member.combat.rangedUptime *
                protection,
        );
        siegePairs.push(
            member.combat.siege *
                (0.5 + 0.5 * Math.max(protection, member.combat.selfPeel)),
        );
    }
    return {
        engage: getCoverage(engagePairs),
        protect: getCoverage(protectPairs),
        siege: getCoverage(siegePairs),
    };
}

export function getCompositionWinrateDelta(
    centeredScore: number,
    influence: number,
    stageWeight: number,
) {
    const fullStrengthDelta = clamp(
        centeredScore * COMPOSITION_SCORE_TO_WINRATE,
        -MAX_COMPOSITION_WINRATE_DELTA,
        MAX_COMPOSITION_WINRATE_DELTA,
    );
    const influenceWeight = clamp(influence, 0, 100) / 100;
    const normalizedStageWeight = clamp(stageWeight);
    if (influenceWeight === 0 || normalizedStageWeight === 0) return 0;

    return fullStrengthDelta * influenceWeight * normalizedStageWeight;
}

export function getEnemyResponseWinrateDelta(
    centeredScore: number,
    influence: number,
    stageWeight: number,
) {
    return (
        getCompositionWinrateDelta(centeredScore, influence, stageWeight) *
        ENEMY_RESPONSE_INFLUENCE
    );
}

export function combineCompositionWinrateDeltas(
    alliedDelta: number,
    enemyResponseDelta: number,
    influence: number,
) {
    const maximumDelta =
        MAX_COMPOSITION_WINRATE_DELTA * (clamp(influence, 0, 100) / 100);
    return clamp(alliedDelta + enemyResponseDelta, -maximumDelta, maximumDelta);
}

export function getCompositionStageWeight(knownAllies: number) {
    return (clamp(knownAllies, 0, 4) / 4) ** 2;
}

export function getEnemyCompositionStageWeight(knownEnemies: number) {
    return (clamp(knownEnemies, 0, 5) / 5) ** 2;
}

function getDamageBalance(physical: number, magic: number, trueDamage: number) {
    const totalDamage = physical + magic + trueDamage;
    if (!Number.isFinite(totalDamage) || totalDamage <= 0) return 0;

    const dominantShare = Math.max(physical, magic) / totalDamage;

    // Compositions at or below a 70% typed-damage share get full credit.
    // Above that point, coverage falls linearly to zero at a 100/0 split.
    return clamp((1 - dominantShare) / (1 - 0.7));
}

export function getTeamCompositionScore(
    dataset: Dataset,
    team: Map<Role, string>,
) {
    const capabilityTotals = Object.fromEntries(
        COMPOSITION_CAPABILITIES.map((capability) => [capability, 0]),
    ) as Record<CompositionCapability, number>;
    let physical = 0;
    let magic = 0;
    let trueDamage = 0;
    let hasProfiles = true;
    const members: CompositionMember[] = [];

    for (const [role, championKey] of team) {
        const champion = dataset.championData[championKey];
        const roleData = champion?.statsByRole[role];
        const profile = champion
            ? getCompositionProfile(champion.id, role)
            : undefined;

        if (!champion || !roleData || !profile) {
            hasProfiles = false;
            continue;
        }

        physical += roleData.damageProfile.physical;
        magic += roleData.damageProfile.magic;
        trueDamage += roleData.damageProfile.true;
        for (const capability of COMPOSITION_CAPABILITIES) {
            capabilityTotals[capability] += profile[capability];
        }
        const combat = getCombatProfile(champion.id, role);
        members.push({
            profile,
            combat,
            damageThreat: Math.max(profile.sustainedDamage, combat.burstDamage),
        });
    }

    const capabilityCoverage = Object.fromEntries(
        COMPOSITION_CAPABILITIES.map((capability) => [
            capability,
            getCoverage(members.map(({ profile }) => profile[capability])),
        ]),
    ) as Record<CompositionCapability, number>;
    const plans = getFightPlans(members);
    // A coherent single plan suffices; alternative plans provide a small bonus.
    const orderedPlans = Object.values(plans).sort((a, b) => b - a);
    const fightPlan = orderedPlans[0] * 0.85 + orderedPlans[1] * 0.15;
    const coverage = {
        damageBalance: getDamageBalance(physical, magic, trueDamage),
        ...capabilityCoverage,
        fightPlan,
    } as CompositionCoverage;
    const scoreWeight = Object.values(COMPOSITION_SCORE_WEIGHTS).reduce(
        (total, weight) => total + weight,
        0,
    );
    const score =
        Object.entries(COMPOSITION_SCORE_WEIGHTS).reduce(
            (total, [dimension, weight]) =>
                total + coverage[dimension as CompositionDimension] * weight,
            0,
        ) / scoreWeight;

    return { coverage, capabilityTotals, score, hasProfiles, members, plans };
}

export function getEnemyResponseScore(
    alliedComposition: TeamCompositionScore,
    enemyComposition: TeamCompositionScore,
) {
    // A single provider creates some pressure; two reliable providers reach the
    // full response target. This focuses the layer on cumulative enemy patterns.
    const pressure = (capability: CompositionCapability) =>
        clamp(
            enemyComposition.members.reduce(
                (total, { profile }) => total + profile[capability] ** 2,
                0,
            ) / 2,
        );
    const pressures = {
        frontline: pressure("frontline"),
        engage: pressure("engage"),
        peel: pressure("peel"),
        waveclear: pressure("waveclear"),
    } satisfies EnemyCompositionPressures;
    const tankDamage: number[] = [];
    let protectedThreat = 0;
    let totalThreat = 0;
    for (const [index, member] of alliedComposition.members.entries()) {
        const allies = alliedComposition.members.filter(
            (_, allyIndex) => allyIndex !== index,
        );
        const protection = getProtection(allies);
        const safety =
            member.combat.selfPeel + (1 - member.combat.selfPeel) * protection;
        // Range and personal/team protection determine whether the tank
        // damage can be delivered. Enemy peel restricts melee access more.
        const access =
            member.combat.rangedUptime +
            (1 - member.combat.rangedUptime) *
                (0.5 + 0.5 * safety) *
                (1 - pressures.peel * 0.35);
        tankDamage.push(
            member.combat.tankDamage *
                access *
                (1 - pressures.engage * (1 - safety) * 0.35),
        );
        protectedThreat += member.damageThreat * safety;
        totalThreat += member.damageThreat;
    }
    const antiFrontline = getCoverage(tankDamage);
    // Evaluate protection of the actual damage dealers, not the number of
    // tanks/CC spells. An additional exposed carry creates additional demand.
    const antiEngage = totalThreat > 0 ? protectedThreat / totalThreat : 0;
    const engageEffectiveness =
        alliedComposition.plans.engage * (1 - pressures.peel * 0.25);
    const antiWaveclear = Math.max(
        engageEffectiveness,
        alliedComposition.plans.siege,
    );
    const responseWeight = Object.values(ENEMY_RESPONSE_CATEGORY_WEIGHT).reduce(
        (total, weight) => total + weight,
        0,
    );
    const responseFit =
        (pressures.frontline *
            antiFrontline *
            ENEMY_RESPONSE_CATEGORY_WEIGHT.frontline +
            pressures.engage *
                antiEngage *
                ENEMY_RESPONSE_CATEGORY_WEIGHT.engage +
            pressures.waveclear *
                antiWaveclear *
                ENEMY_RESPONSE_CATEGORY_WEIGHT.waveclear) /
        responseWeight;
    const engageIntoPeelPenalty =
        pressures.peel *
        alliedComposition.plans.engage *
        (1 -
            Math.max(
                alliedComposition.plans.protect,
                alliedComposition.plans.siege,
            )) *
        0.1;

    return {
        pressures,
        score: responseFit - engageIntoPeelPenalty,
    };
}
