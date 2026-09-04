import { Component, For, Show } from "solid-js";
import { Panel, PanelHeader } from "../../common/Panel";
import { useBuild } from "../../../contexts/BuildContext";
import { useDataset } from "../../../contexts/DatasetContext";
import { formatPatch } from "../../../utils/strings";

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const count = (value: number) => Math.round(value).toLocaleString();

export const RecommendedBuild: Component = () => {
    const { dataset } = useDataset();
    const { query } = useBuild();
    const range = (value?: string) =>
        value === "30-days"
            ? "Last 30 days"
            : `Patch ${formatPatch(dataset()?.version)}`;
    return (
        <div class="flex flex-col gap-8">
            <p class="text-sm text-neutral-400">
                Choose a core, then adapt boots and later items to your game.
                Only options with at least 500 observed games and 1% usage
                qualify. Fewer than three shown means there is not enough
                supported data.
            </p>
            <Panel>
                <PanelHeader>Top 3 core builds</PanelHeader>
                <p class="text-sm text-neutral-400 mb-4">
                    Three major items + boots when bought before the third item
                    · {range(query.data?.coreRecommendations.dataRange)} ·
                    Emerald+ · Worldwide
                </p>
                <Show
                    when={query.data?.coreRecommendations.options.length}
                    fallback={
                        <p class="text-neutral-400" role="status">
                            Insufficient data for a well-supported core build.
                            Niche builds are hidden.
                        </p>
                    }
                >
                    <ol class="flex flex-col gap-3">
                        <For each={query.data?.coreRecommendations.options}>
                            {(core, index) => (
                                <li class="rounded-md border border-neutral-700 p-4">
                                    <div class="flex flex-wrap justify-between gap-2 mb-3">
                                        <h3 class="font-semibold">
                                            Core {index() + 1}
                                        </h3>
                                        <span class="text-sm text-sky-200">
                                            {percent(core.score)} ranking score
                                        </span>
                                    </div>
                                    <ol
                                        class="flex flex-wrap gap-y-3"
                                        aria-label={`Core ${index() + 1} most common purchase order`}
                                    >
                                        <For
                                            each={
                                                core.opening?.itemIds ??
                                                core.itemIds
                                            }
                                        >
                                            {(id, slot) => (
                                                <li class="flex items-center">
                                                    <Show when={slot() > 0}>
                                                        <span
                                                            class="mx-3 text-neutral-500"
                                                            aria-hidden="true"
                                                        >
                                                            →
                                                        </span>
                                                    </Show>
                                                    <div class="flex items-center gap-2">
                                                        <img
                                                            class="w-10 h-10 rounded"
                                                            alt=""
                                                            src={`https://ddragon.leagueoflegends.com/cdn/${dataset()!.version}/img/item/${id}.png`}
                                                        />
                                                        <span class="text-sm">
                                                            {
                                                                dataset()!
                                                                    .itemData[
                                                                    id
                                                                ].name
                                                            }
                                                        </span>
                                                    </div>
                                                </li>
                                            )}
                                        </For>
                                    </ol>
                                    <p class="text-xs text-neutral-400 mt-2">
                                        {core.opening
                                            ? `Common opening · ${count(core.opening.games)} observed games${core.opening.itemIds.length === 3 ? " · No boots before the third major item in this opening" : ""}`
                                            : "Boot timing has insufficient data; showing the three-item core only."}
                                    </p>
                                    <p class="text-xs text-neutral-400 mt-3">
                                        {count(core.observed)} observed games ·{" "}
                                        {percent(core.share)} of three-item
                                        cores · {percent(core.winrate)} adjusted
                                        WR
                                    </p>
                                </li>
                            )}
                        </For>
                    </ol>
                </Show>
            </Panel>
            <Panel>
                <PanelHeader>Top 3 rune options</PanelHeader>
                <p class="text-sm text-neutral-400 mb-4">
                    Ranked by keystone results ·{" "}
                    {range(query.data?.runeRecommendations.dataRange)} ·
                    Emerald+ · Worldwide
                </p>
                <Show
                    when={query.data?.runeRecommendations.options.length}
                    fallback={
                        <p class="text-neutral-400" role="status">
                            Insufficient data for well-supported rune options.
                            Niche choices are hidden.
                        </p>
                    }
                >
                    <ol class="grid grid-cols-1 lg:grid-cols-3 gap-3">
                        <For each={query.data?.runeRecommendations.options}>
                            {(option, index) => (
                                <li class="rounded-md border border-neutral-700 p-4">
                                    <h3 class="font-semibold flex gap-2 items-center mb-2">
                                        <img
                                            class="w-10 h-10"
                                            alt=""
                                            src={`https://ddragon.leagueoflegends.com/cdn/img/${dataset()!.runeData[option.id].icon}`}
                                        />
                                        {index() + 1}.{" "}
                                        {dataset()!.runeData[option.id].name}
                                    </h3>
                                    <p class="text-sm text-sky-200">
                                        {percent(option.score)} ranking score
                                    </p>
                                    <p class="text-xs text-neutral-400 mt-1 mb-4">
                                        {count(option.games)} keystone games ·{" "}
                                        {percent(option.share)} usage ·{" "}
                                        {percent(option.winrate)} WR
                                    </p>
                                    <Show
                                        when={option.page}
                                        fallback={
                                            <p class="text-sm text-neutral-400">
                                                Suggested page unavailable.
                                                Retry missing data above.
                                            </p>
                                        }
                                    >
                                        {(page) => (
                                            <div class="flex flex-col gap-3">
                                                <For
                                                    each={[
                                                        page().primary,
                                                        page().secondary,
                                                    ]}
                                                >
                                                    {(ids) => (
                                                        <div>
                                                            <h4 class="text-xs uppercase text-neutral-400 mb-1">
                                                                {
                                                                    dataset()!
                                                                        .runePathData[
                                                                        dataset()!
                                                                            .runeData[
                                                                            ids[0]
                                                                        ].pathId
                                                                    ]?.name
                                                                }
                                                            </h4>
                                                            <ul class="flex flex-col gap-1">
                                                                <For each={ids}>
                                                                    {(id) => (
                                                                        <li class="text-sm flex items-center gap-2">
                                                                            <img
                                                                                class="w-6 h-6"
                                                                                alt=""
                                                                                src={`https://ddragon.leagueoflegends.com/cdn/img/${dataset()!.runeData[id].icon}`}
                                                                            />
                                                                            {
                                                                                dataset()!
                                                                                    .runeData[
                                                                                    id
                                                                                ]
                                                                                    .name
                                                                            }
                                                                        </li>
                                                                    )}
                                                                </For>
                                                            </ul>
                                                        </div>
                                                    )}
                                                </For>
                                                <div>
                                                    <h4 class="text-xs uppercase text-neutral-400 mb-1">
                                                        Shards · Offense / Flex
                                                        / Defense
                                                    </h4>
                                                    <p class="text-sm">
                                                        {page()
                                                            .shards.map(
                                                                (id) =>
                                                                    dataset()!
                                                                        .statShardData[
                                                                        id
                                                                    ].name,
                                                            )
                                                            .join(" / ")}
                                                    </p>
                                                </div>
                                            </div>
                                        )}
                                    </Show>
                                </li>
                            )}
                        </For>
                    </ol>
                </Show>
                <p class="text-xs text-neutral-400 mt-4">
                    Minor runes and shards are the source’s suggested page for
                    each keystone. Counts and scores describe the keystone, not
                    that exact full page. Rune options are independent of the
                    core ranking; Core 1 does not automatically pair with Rune
                    1.
                </p>
            </Panel>
            <details class="text-sm text-neutral-400">
                <summary class="cursor-pointer">
                    How recommendations are selected
                </summary>
                <div class="mt-2 flex flex-col gap-2">
                    <p>
                        Each core pools the same three major items across
                        purchase orders. The displayed opening is the most
                        common supported sequence through the third major item,
                        including boots only if purchased by then. Boots
                        purchased later are not inserted earlier. If no opening
                        meets the sample minimum, only the major-item core is
                        shown. Scores describe the core across boot choices, not
                        the specific opening. Usage is measured among observed
                        games reaching three major items. Rune usage is measured
                        among all champion-role games.
                    </p>
                    <p>
                        Both lists require 500 actual games and 1% usage before
                        ranking. Both lists follow the Lolalytics time-range
                        setting; insufficient data never silently switches
                        ranges. Lists are never padded with niche or unsupported
                        options.
                    </p>
                    <p>
                        Core win rates include estimated unfinished builds using
                        the combined-set method. The conservative score uses
                        only the observed sample size for its uncertainty
                        penalty; extrapolation never adds evidence. Rune scores
                        use observed keystone results. These ranking scores are
                        not calibrated win-probability guarantees.
                    </p>
                    <p>
                        These are starting points, not opponent-adjusted
                        recommendations. Game-state bias remains; choose your
                        playstyle and adapt later purchases.
                    </p>
                </div>
            </details>
        </div>
    );
};
