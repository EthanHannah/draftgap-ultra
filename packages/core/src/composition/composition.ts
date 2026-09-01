import { Role } from "../models/Role";
import { Dataset } from "../models/dataset/Dataset";
import {
    COMPOSITION_CAPABILITIES,
    CompositionCapability,
    getCompositionProfile,
} from "./profiles";

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
): TeamCompositionScore {
    const capabilityTotals = Object.fromEntries(
        COMPOSITION_CAPABILITIES.map((capability) => [capability, 0]),
    ) as Record<CompositionCapability, number>;
    let physical = 0;
    let magic = 0;
    let trueDamage = 0;
    let hasProfiles = true;

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
    }

    const capabilityCoverage = Object.fromEntries(
        COMPOSITION_CAPABILITIES.map((capability) => [
            capability,
            clamp(capabilityTotals[capability]),
        ]),
    ) as Record<CompositionCapability, number>;
    const fightPlan =
        Math.max(capabilityCoverage.engage, capabilityCoverage.peel) * 0.75 +
        Math.min(capabilityCoverage.engage, capabilityCoverage.peel) * 0.25;
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

    return { coverage, capabilityTotals, score, hasProfiles };
}

export function getEnemyResponseScore(
    alliedComposition: TeamCompositionScore,
    enemyComposition: TeamCompositionScore,
): EnemyResponseScore {
    // A single provider creates some pressure; two reliable providers reach the
    // full response target. This focuses the layer on cumulative enemy patterns.
    const pressures = {
        frontline: clamp(enemyComposition.capabilityTotals.frontline / 2),
        engage: clamp(enemyComposition.capabilityTotals.engage / 2),
        peel: clamp(enemyComposition.capabilityTotals.peel / 2),
        waveclear: clamp(enemyComposition.capabilityTotals.waveclear / 2),
    } satisfies EnemyCompositionPressures;
    const antiFrontline =
        alliedComposition.coverage.sustainedDamage * 0.75 +
        alliedComposition.coverage.hardCrowdControl * 0.25;
    const antiEngage =
        alliedComposition.coverage.peel * 0.45 +
        alliedComposition.coverage.frontline * 0.3 +
        alliedComposition.coverage.hardCrowdControl * 0.25;
    const engageEffectiveness =
        alliedComposition.coverage.engage * (1 - pressures.peel * 0.25);
    const antiWaveclear =
        engageEffectiveness * 0.65 +
        alliedComposition.coverage.waveclear * 0.35;
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
        pressures.peel * alliedComposition.coverage.engage * 0.1;

    return {
        pressures,
        score: responseFit - engageIntoPeelPenalty,
    };
}
