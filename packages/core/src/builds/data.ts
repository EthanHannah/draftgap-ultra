import { FetchQueryOptions, QueryClient } from "@tanstack/query-core";
import { BUILD_ROLES, BuildRequest, LolalyticsBuildData } from "./lolalytics";
import { Role } from "../models/Role";
import {
    FullBuildDataset,
    ItemsBuildData,
    PartialBuildDataset,
    RunesBuildData,
    Skill,
    SkillOrder,
    SkillsBuildData,
    SummonerSpellsBuildData,
} from "../models/build/BuildDataset";
import { Dataset } from "../models/dataset/Dataset";
import { EntityStats } from "./entity-analysis";
import {
    combineBuildSets,
    FullBuildSets,
    combinedBuildPaths,
} from "./combined-builds";
import {
    addCoreOpenings,
    rankCoreBuilds,
    rankKeystones,
    validateRunePage,
} from "./recommendations";

function getRunesBuildData(
    dataset: Dataset,
    championData: LolalyticsBuildData,
) {
    const runes: RunesBuildData = {
        primary: {},
        secondary: {},
        shards: {
            offense: {},
            defense: {},
            flex: {},
        },
    };

    for (const [rawId, runesArray] of Object.entries(
        championData.runes.stats,
    )) {
        // Rune or Shard ID
        const runeId = parseInt(rawId);
        // Whether this shard is in the flex slot (slot 1)
        const isFlexShard = rawId.at(-1) === "f";

        for (const [i, rune] of runesArray.map(
            (rune, i) => [i, rune] as const,
        )) {
            const [, winRate, games] = rune;
            const chosenAsSecondary = i === 1;

            const runeStats = {
                wins: Math.round(games * (winRate / 100)),
                games,
            } satisfies EntityStats;

            if (dataset.runeData[runeId]) {
                if (chosenAsSecondary) {
                    runes.secondary[runeId] = runeStats;
                } else {
                    runes.primary[runeId] = runeStats;
                }
            } else if (dataset.statShardData[runeId]) {
                if (isFlexShard) {
                    runes.shards.flex[runeId] = runeStats;
                } else {
                    const slot = dataset.statShardData[runeId].positions.find(
                        (p) => p.slot !== 1,
                    )?.slot;
                    if (slot === undefined) {
                        continue;
                    }
                    if (slot === 0) {
                        runes.shards.offense[runeId] = runeStats;
                    } else if (slot === 2) {
                        runes.shards.defense[runeId] = runeStats;
                    }
                }
            }
        }
    }

    return runes;
}

function getItemsBuildData(
    dataset: Dataset,
    championData: LolalyticsBuildData,
) {
    const oneToFive = [1, 2, 3, 4, 5] as const;

    const items: ItemsBuildData = {
        boots: {},
        startingSets: {},
        sets: {},
        statsByOrder: oneToFive.map(() => ({})),
    };

    const parseItem = (itemData: LolalyticsBuildData["item1"][0]) => {
        const id = Number(itemData[0]);
        const winrate = itemData[1] / 100;
        const games = itemData[3];
        const wins = Math.round(games * winrate);
        return [id, { wins, games }] as const;
    };

    const parseSet = (setData: LolalyticsBuildData["startSet"][0]) => {
        let setItems: number[];
        if (typeof setData[0] === "number") {
            setItems = [setData[0]];
        } else {
            setItems = setData[0].split("_").map((id) => parseInt(id));
        }
        const winrate = setData[1] / 100;
        const games = setData[3];
        const wins = Math.round(games * winrate);
        return [setItems, { wins, games }] as const;
    };

    // Boots
    for (const itemData of championData.boots) {
        const [id, stats] = parseItem(itemData);
        // Skip no boots, magical footwear and base boots.
        if ([9999, 2422, 1001].includes(id) || !dataset.itemData[id]) {
            continue;
        }
        items.boots[id] = stats;
    }

    // Starting items
    for (const setData of championData.startSet) {
        const [setItems, stats] = parseSet(setData);
        if (!setItems.every((id) => dataset.itemData[id])) continue;
        items.startingSets[setItems.sort().join("_")] = stats;
    }

    // Items
    for (const n of oneToFive) {
        const order = n - 1;
        const orderItems = championData[`item${n}`] ?? [];
        for (const itemData of orderItems) {
            const [id, stats] = parseItem(itemData);
            if (!dataset.itemData[id]) continue;
            items.statsByOrder[order][id] = stats;
        }
    }

    if (championData.itemSets && championData.builtBootSet3) {
        const completed = Object.fromEntries(
            championData.builtBootSet3.map(([key, winrate, , games]) => [
                String(key),
                { games, wins: (games * winrate) / 100 },
            ]),
        );
        items.combinedSets = combineBuildSets(championData.itemSets, completed);
    }

    return items;
}

function getSummonerSpellsBuildData(
    dataset: Dataset,
    championData: LolalyticsBuildData,
) {
    const summonerSpells = {} as SummonerSpellsBuildData;

    const parseSummonerSpellSet = (
        summonerSpellData: LolalyticsBuildData["spells"][number],
    ) => {
        const id = summonerSpellData[0];
        const winrate = summonerSpellData[1] / 100;
        const games = summonerSpellData[3];
        const wins = Math.round(games * winrate);

        return [id, { wins, games }] as const;
    };

    for (const spellSetData of championData.spells) {
        const [spellSet, stats] = parseSummonerSpellSet(spellSetData);
        // Sort the spell set so that the order of the spells doesn't matter.
        const ids = String(spellSet).split("_");
        if (
            ids.length !== 2 ||
            !ids.every((id) => dataset.summonerSpellData[Number(id)])
        )
            continue;
        const spellSetNormalized = ids.sort().join("_");
        summonerSpells[spellSetNormalized] = stats;
    }

    return summonerSpells;
}

function getSkillsBuildData(championData: LolalyticsBuildData) {
    const skills = {
        order: {},
        level: {},
    } as SkillsBuildData;

    const parseSkillOrder = (
        skillOrderData: LolalyticsBuildData["skillOrder"][number],
    ) => {
        const skillOrder = skillOrderData[0] as SkillOrder;
        const games = skillOrderData[3];
        const wins = Math.round((games * skillOrderData[1]) / 100);

        return [skillOrder, { wins, games }] as const;
    };

    for (const skillOrderData of championData.skillOrder) {
        const [skillOrder, stats] = parseSkillOrder(skillOrderData);
        if (!["QWE", "QEW", "WQE", "WEQ", "EQW", "EWQ"].includes(skillOrder))
            continue;
        skills.order[skillOrder] = stats;
    }

    const parseSkillLevel = (
        skillLevelData: LolalyticsBuildData["skillEarly"][number],
    ) => {
        return skillLevelData.map(parseSkillLevelItem);
    };

    const parseSkillLevelItem = (
        skillLevelItemData: LolalyticsBuildData["skillEarly"][number][number],
        i: number,
    ) => {
        const skill = ["Q", "W", "E", "R"][i] as Skill;
        const games = skillLevelItemData[2];
        const wins = Math.round((games * skillLevelItemData[0]) / 100);

        return [skill, { wins, games }] as const;
    };

    skills.level = Array.from({
        length: championData.skillEarly.length,
    }).map(() => ({}) as Record<Skill, EntityStats>);
    for (let i = 0; i < championData.skillEarly.length; i++) {
        const skillLevelData = championData.skillEarly[i];
        const skillStatsForLevel = parseSkillLevel(skillLevelData);
        for (const [skill, stats] of skillStatsForLevel) {
            skills.level[i][skill] = stats;
        }
    }

    return skills;
}

export function partialDatasetFromLolalyticsData(
    dataset: Dataset,
    championKey: string,
    role: Role,
    championData: LolalyticsBuildData,
) {
    const partialDataset: PartialBuildDataset = {
        championKey,
        role,
        wins: Math.round(
            (championData.header.n * championData.header.wr) / 100,
        ),
        games: championData.header.n,
        runes: getRunesBuildData(dataset, championData),
        items: getItemsBuildData(dataset, championData),
        summonerSpells: getSummonerSpellsBuildData(dataset, championData),
        skills: getSkillsBuildData(championData),
    };

    return partialDataset;
}

function fullDatasetFromLolalyticsData(
    dataset: Dataset,
    championKey: string,
    role: Role,
    championData: LolalyticsBuildData,
    matchupData: {
        championKey: string;
        role: Role;
        championData: LolalyticsBuildData;
    }[],
) {
    const partialDataset = partialDatasetFromLolalyticsData(
        dataset,
        championKey,
        role,
        championData,
    );

    const fullDataset: FullBuildDataset = {
        ...partialDataset,
        matchups: matchupData.map((matchup) => ({
            championKey: matchup.championKey,
            role: matchup.role,
            wins: Math.round(
                (matchup.championData.header.n *
                    matchup.championData.header.wr) /
                    100,
            ),
            games: matchup.championData.header.n,
            runes: getRunesBuildData(dataset, matchup.championData),
            items: getItemsBuildData(dataset, matchup.championData),
            summonerSpells: getSummonerSpellsBuildData(
                dataset,
                matchup.championData,
            ),
            skills: getSkillsBuildData(matchup.championData),
        })),
    };

    return fullDataset;
}

function getLolalyticsChampionOptions(
    request: BuildRequest,
    championKey: string,
    load: (request: BuildRequest) => Promise<LolalyticsBuildData>,
    matchupKey?: string,
) {
    return {
        queryKey: ["lolalytics-build-page", request],
        queryFn: async () => {
            const data = await load(request);
            if (
                String(data.header.cid) !== championKey ||
                data.header.lane !== request.role ||
                data.header.patch !== request.patch
            ) {
                throw new Error(
                    "Lolalytics returned data for a different champion, role, or patch.",
                );
            }
            if (
                matchupKey !== undefined &&
                (String(data.header.vs) !== matchupKey ||
                    data.header.vsLane !== request.matchupRole)
            ) {
                throw new Error(
                    "Lolalytics returned data for a different matchup.",
                );
            }
            return data;
        },
        retry: false,
        staleTime: 1000 * 60 * 60, // 1 hour
    } satisfies FetchQueryOptions;
}

export async function fetchBuildData(
    queryClient: QueryClient,
    dataset: Dataset,
    championKey: string,
    role: Role,
    opponentTeamComp: Map<Role, string>,
    load: (request: BuildRequest) => Promise<LolalyticsBuildData>,
    loadItemSets?: (request: BuildRequest) => Promise<FullBuildSets>,
    timeRange: "current-patch" | "30-days" = "current-patch",
) {
    // convert patch from 13.7.1 to 13.7
    const patch = dataset.version.split(".").slice(0, 2).join(".");
    const championId = dataset.championData[championKey]?.id;
    if (!championId || !BUILD_ROLES[role])
        throw new Error(
            "Select a champion with an assigned role to view builds.",
        );
    const request = { championId, role: BUILD_ROLES[role] };
    const pathResultsPromise = loadItemSets
        ? Promise.allSettled(
              [patch, "30"].map((range) => {
                  const parameters = { ...request, patch: range };
                  return queryClient.fetchQuery({
                      queryKey: ["lolalytics-build-paths-v2", parameters],
                      queryFn: async () => {
                          const sets = await loadItemSets(parameters);
                          const paths = combinedBuildPaths(sets);
                          if (
                              !paths.some((path) =>
                                  Object.values(path).some(
                                      (stats) => stats.games > 0,
                                  ),
                              )
                          )
                              throw new Error(
                                  "No build-path data is available.",
                              );
                          return { paths, coreSets: sets.coreSets, sets };
                      },
                      staleTime: 1000 * 60 * 60,
                      retry: false,
                  });
              }),
          )
        : undefined;

    const championPatchDataPromises = queryClient.fetchQuery(
        getLolalyticsChampionOptions({ ...request, patch }, championKey, load),
    );

    const champion30DaysDataPromises = queryClient.fetchQuery(
        getLolalyticsChampionOptions(
            { ...request, patch: "30" },
            championKey,
            load,
        ),
    );

    const matchup30DaysDataPromises = [...opponentTeamComp.entries()].map(
        async ([opponentRole, opponentChampionKey]) => {
            const matchupId = dataset.championData[opponentChampionKey]?.id;
            if (!matchupId) throw new Error("Unknown matchup champion");
            return queryClient
                .fetchQuery(
                    getLolalyticsChampionOptions(
                        {
                            ...request,
                            patch: "30",
                            matchupId,
                            matchupRole: BUILD_ROLES[opponentRole],
                        },
                        championKey,
                        load,
                        opponentChampionKey,
                    ),
                )
                .then((championData) => ({
                    championKey: opponentChampionKey,
                    role: opponentRole,
                    championData,
                }));
        },
    );

    const results = await Promise.allSettled([
        championPatchDataPromises,
        champion30DaysDataPromises,
        ...matchup30DaysDataPromises,
    ]);
    const [patchResult, monthResult, ...matchupResults] = results;
    if (
        patchResult.status === "rejected" &&
        monthResult.status === "rejected"
    ) {
        throw new Error(
            `Build data is unavailable. ${String(patchResult.reason instanceof Error ? patchResult.reason.message : patchResult.reason)}`,
        );
    }
    const warnings: string[] = [];
    const championPatchData =
        patchResult.status === "fulfilled"
            ? patchResult.value
            : monthResult.status === "fulfilled"
              ? monthResult.value
              : undefined;
    const champion30DaysData =
        monthResult.status === "fulfilled"
            ? monthResult.value
            : championPatchData;
    if (!championPatchData || !champion30DaysData)
        throw new Error("Build data is unavailable.");
    if (timeRange === "current-patch" && patchResult.status === "rejected")
        warnings.push("Current-patch data is unavailable.");
    if (timeRange === "30-days" && monthResult.status === "rejected")
        warnings.push(
            "30-day data is unavailable; matchup adjustments are omitted.",
        );
    const matchup30DaysData =
        monthResult.status === "fulfilled"
            ? matchupResults.flatMap((result) =>
                  result.status === "fulfilled" ? [result.value] : [],
              )
            : [];
    const missingMatchups = matchupResults.filter(
        (result) => result.status === "rejected",
    ).length;
    if (monthResult.status === "fulfilled" && missingMatchups)
        warnings.push(
            `${missingMatchups} matchup${missingMatchups === 1 ? " is" : "s are"} unavailable; those adjustments are omitted.`,
        );

    const partialDataset = partialDatasetFromLolalyticsData(
        dataset,
        championKey,
        role,
        championPatchData,
    );

    const fullDataset = fullDatasetFromLolalyticsData(
        dataset,
        championKey,
        role,
        champion30DaysData,
        matchup30DaysData,
    );

    const pathResults = await pathResultsPromise;
    const currentPaths = pathResults?.[0];
    const monthPaths = pathResults?.[1];
    const selectedPaths =
        timeRange === "current-patch" ? currentPaths : monthPaths;
    const buildPaths =
        selectedPaths?.status === "fulfilled"
            ? { byLength: selectedPaths.value.paths, dataRange: timeRange }
            : undefined;
    if (loadItemSets && !buildPaths)
        warnings.push(
            "Build-path recommendations are unavailable; rune options may still be available.",
        );

    const patchCores =
        currentPaths?.status === "fulfilled"
            ? rankCoreBuilds(currentPaths.value.coreSets, dataset)
            : [];
    const monthCores =
        monthPaths?.status === "fulfilled"
            ? rankCoreBuilds(monthPaths.value.coreSets, dataset)
            : [];
    // Boot identity comes from the source's boots category, not item names or
    // a hard-coded list that misses new/upgraded boots. Use both loaded ranges.
    const bootIds = new Set(
        [...championPatchData.boots, ...champion30DaysData.boots].map((row) =>
            Number(row[0]),
        ),
    );
    const coreRecommendations =
        timeRange === "current-patch"
            ? {
                  options: addCoreOpenings(
                      patchCores,
                      currentPaths?.status === "fulfilled"
                          ? currentPaths.value.sets
                          : undefined,
                      bootIds,
                      dataset,
                  ),
                  dataRange: "current-patch" as const,
              }
            : {
                  options: addCoreOpenings(
                      monthCores,
                      monthPaths?.status === "fulfilled"
                          ? monthPaths.value.sets
                          : undefined,
                      bootIds,
                      dataset,
                  ),
                  dataRange: "30-days" as const,
              };
    const selectedResult =
        timeRange === "current-patch" ? patchResult : monthResult;
    const runeRange = timeRange === "current-patch" ? patch : "30";
    const keystones =
        selectedResult.status === "fulfilled"
            ? rankKeystones(selectedResult.value, dataset)
            : [];
    const runeOptions = await Promise.all(
        keystones.map(async (option) => {
            try {
                const pageQuery = getLolalyticsChampionOptions(
                    { ...request, patch: runeRange, keystone: option.id },
                    championKey,
                    load,
                );
                const page = await queryClient.fetchQuery({
                    ...pageQuery,
                    queryKey: [
                        "lolalytics-suggested-rune-page",
                        ...pageQuery.queryKey,
                    ],
                    queryFn: async () => {
                        const pageData = await pageQuery.queryFn();
                        const page = validateRunePage(
                            pageData.suggestedRunePage,
                            option.id,
                            dataset,
                        );
                        if (!page) throw new Error("Rune page unavailable");
                        return page;
                    },
                });
                return { ...option, page };
            } catch {
                warnings.push(
                    `Suggested page for ${dataset.runeData[option.id].name} is unavailable; its keystone statistics are still shown.`,
                );
                return { ...option, page: undefined };
            }
        }),
    );

    return {
        partialDataset,
        fullDataset,
        warnings,
        buildPaths,
        coreRecommendations,
        runeRecommendations: {
            options: runeOptions,
            dataRange:
                runeRange === "30"
                    ? ("30-days" as const)
                    : ("current-patch" as const),
        },
        dataRange:
            patchResult.status === "fulfilled"
                ? ("current-patch" as const)
                : ("30-days" as const),
    };
}
