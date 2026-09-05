import { Icon } from "solid-heroicons";
import { questionMarkCircle } from "solid-heroicons/solid-mini";
import { For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import { ButtonGroup, ButtonGroupOption } from "../common/ButtonGroup";
import { Switch } from "../common/Switch";
import {
    RiskLevel,
    displayNameByRiskLevel,
} from "@draftgap/core/src/risk/risk-level";
import { useUser } from "../../contexts/UserContext";
import { useMedia } from "../../hooks/useMedia";
import {
    DraftTablePlacement,
    StatsSite,
} from "@draftgap/core/src/models/user/Config";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "../common/Dialog";
import { FAQDialog } from "./FAQDialog";

export default function SettingsDialog() {
    const { isDesktop } = useMedia();
    const { config, setConfig } = useUser();
    const [draftWeights, setDraftWeights] = createStore({
        championWinrateInfluence: config.championWinrateInfluence,
        matchupInfluence: config.matchupInfluence,
        duoInfluence: config.duoInfluence,
        contextInfluence: config.contextInfluence,
        blindabilityWeight: config.blindabilityWeight,
        enemySafetyPriority: config.enemySafetyPriority,
        compositionInfluence: config.compositionInfluence,
    });

    const riskLevelOptions: ButtonGroupOption<RiskLevel>[] = RiskLevel.map(
        (level) => ({
            value: level,
            label: displayNameByRiskLevel[level],
        }),
    );

    const draftTablePlacementOptions = [
        {
            value: DraftTablePlacement.Bottom,
            label: "Bottom",
        },
        {
            value: DraftTablePlacement.InPlace,
            label: "In Place",
        },
        {
            value: DraftTablePlacement.Hidden,
            label: "Hidden",
        },
    ];

    const statsSiteOptions = [
        {
            value: "lolalytics",
            label: "lolalytics",
        },
        {
            value: "u.gg",
            label: "u.gg",
        },
        {
            value: "op.gg",
            label: "op.gg",
        },
    ] as const;

    return (
        <DialogContent>
            <DialogHeader>
                <DialogTitle>Settings</DialogTitle>
            </DialogHeader>
            <div>
                <h3 class="text-3xl uppercase">Draft</h3>
                <label class="mt-2 grid gap-1">
                    <span class="flex items-center justify-between gap-4 text-lg uppercase">
                        <span>Individual champion winrate influence</span>
                        <span class="tabular-nums">
                            {draftWeights.championWinrateInfluence}%
                        </span>
                    </span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        class="w-full accent-secondary"
                        value={draftWeights.championWinrateInfluence}
                        aria-label="Individual champion winrate influence"
                        onInput={(event) =>
                            setDraftWeights(
                                "championWinrateInfluence",
                                event.currentTarget.valueAsNumber,
                            )
                        }
                        onChange={(event) =>
                            setConfig({
                                championWinrateInfluence:
                                    event.currentTarget.valueAsNumber,
                            })
                        }
                    />
                </label>
                <For
                    each={
                        [
                            {
                                key: "matchupInfluence",
                                label: "Matchup influence",
                            },
                            { key: "duoInfluence", label: "Duo influence" },
                        ] as const
                    }
                >
                    {(setting) => (
                        <label class="mt-2 grid gap-1">
                            <span class="flex items-center justify-between gap-4 text-lg uppercase">
                                <span>{setting.label}</span>
                                <span class="tabular-nums">
                                    {draftWeights[setting.key]}%
                                </span>
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                class="w-full accent-secondary"
                                value={draftWeights[setting.key]}
                                aria-label={setting.label}
                                onInput={(event) =>
                                    setDraftWeights(
                                        setting.key,
                                        event.currentTarget.valueAsNumber,
                                    )
                                }
                                onChange={(event) =>
                                    setConfig(
                                        setting.key,
                                        event.currentTarget.valueAsNumber,
                                    )
                                }
                            />
                        </label>
                    )}
                </For>
                <div class="flex items-center mt-1 mb-1 gap-1">
                    <span class="text-lg uppercase block">Risk level</span>
                    <Dialog>
                        <DialogTrigger>
                            <Icon
                                path={questionMarkCircle}
                                class="w-5 inline text-neutral-400 -mt-1"
                            />
                        </DialogTrigger>
                        <FAQDialog />
                    </Dialog>
                </div>
                <ButtonGroup
                    options={riskLevelOptions}
                    selected={config.riskLevel}
                    size="sm"
                    onChange={(value: RiskLevel) =>
                        setConfig({
                            riskLevel: value,
                        })
                    }
                />
                <div class="flex items-center justify-between gap-8 mt-3">
                    <div>
                        <span class="text-lg uppercase">
                            Hide picks with limited evidence
                        </span>
                        <p
                            class="text-sm text-neutral-400"
                            id="limited-evidence-description"
                        >
                            Hide recommendations marked Limited evidence or Very
                            limited evidence.
                        </p>
                    </div>
                    <Switch
                        aria-label="Hide picks with limited evidence"
                        aria-describedby="limited-evidence-description"
                        checked={config.hideLimitedEvidencePicks}
                        onChange={(checked) =>
                            setConfig("hideLimitedEvidencePicks", checked)
                        }
                    />
                </div>
                <fieldset class="mt-5">
                    <legend class="text-lg uppercase">
                        Situational adjustment
                    </legend>
                    <p class="text-sm opacity-60">
                        Situational adjustment corrects a champion's base win
                        rate when players usually select it with unusually
                        favorable teammates or opponents. Unrevealed slots use
                        likely picks based on the current draft, falling back
                        toward ordinary pick rates when evidence is limited.
                        Revealed picks use their direct interactions. Poorly
                        supported corrections shrink toward zero. Values above
                        100% amplify both positive and negative corrections.
                    </p>
                    <label class="mt-3 grid gap-1">
                        <span class="flex justify-between gap-2 text-sm uppercase">
                            <span>Adjustment strength</span>
                            <span class="tabular-nums opacity-70">
                                {draftWeights.contextInfluence}%
                            </span>
                        </span>
                        <input
                            type="range"
                            min="0"
                            max="200"
                            step="5"
                            class="w-full accent-secondary"
                            value={draftWeights.contextInfluence}
                            aria-label="Situational adjustment strength"
                            onInput={(event) =>
                                setDraftWeights(
                                    "contextInfluence",
                                    event.currentTarget.valueAsNumber,
                                )
                            }
                            onChange={(event) =>
                                setConfig({
                                    contextInfluence:
                                        event.currentTarget.valueAsNumber,
                                })
                            }
                        />
                    </label>
                </fieldset>
                <fieldset class="mt-5">
                    <legend class="text-lg uppercase">Blindability</legend>
                    <p class="text-sm opacity-60">
                        Blindability measures downside from unknown teammates
                        and exposure to enemy counters. Expected teammate
                        synergy belongs to the situational adjustment;
                        blindability measures how far worse outcomes fall below
                        that expectation. Both adjustments estimate likely
                        remaining picks from the current draft and historical
                        pair frequencies, falling back toward ordinary pick
                        rates when evidence is limited. Pair frequencies do not
                        establish pick order. Counter penalties include
                        uncertainty, and missing data gives no safety bonus. The
                        direct-role opponent remains primary, with separate
                        weights for other role pairings. Enemy safety receives
                        more weight by default for solo queue.
                    </p>
                    <div class="mt-3">
                        <label class="grid gap-1">
                            <span class="flex justify-between gap-2 text-sm uppercase">
                                <span>Blindability influence</span>
                                <span class="tabular-nums opacity-70">
                                    {draftWeights.blindabilityWeight}%
                                </span>
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                class="w-full accent-secondary"
                                value={draftWeights.blindabilityWeight}
                                aria-label="Blindability influence"
                                onInput={(event) =>
                                    setDraftWeights(
                                        "blindabilityWeight",
                                        event.currentTarget.valueAsNumber,
                                    )
                                }
                                onChange={(event) =>
                                    setConfig({
                                        blindabilityWeight:
                                            event.currentTarget.valueAsNumber,
                                    })
                                }
                            />
                        </label>
                        <label class="mt-3 grid gap-1">
                            <span class="flex justify-between gap-2 text-sm uppercase">
                                <span>Enemy safety priority</span>
                                <span class="tabular-nums opacity-70">
                                    {draftWeights.enemySafetyPriority}%
                                </span>
                            </span>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="5"
                                class="w-full accent-secondary"
                                value={draftWeights.enemySafetyPriority}
                                aria-label="Enemy safety priority"
                                onInput={(event) =>
                                    setDraftWeights(
                                        "enemySafetyPriority",
                                        event.currentTarget.valueAsNumber,
                                    )
                                }
                                onChange={(event) =>
                                    setConfig({
                                        enemySafetyPriority:
                                            event.currentTarget.valueAsNumber,
                                    })
                                }
                            />
                        </label>
                    </div>
                </fieldset>
                <fieldset class="mt-5">
                    <legend class="text-lg uppercase">Composition</legend>
                    <p class="text-sm opacity-60">
                        Composition influence rewards damage balance, frontline,
                        a fight plan through engage or peel, hard crowd control,
                        waveclear, and sustained damage. The allied-fit
                        adjustment starts at zero with no known teammates, stays
                        conservative early, and reaches full strength when the
                        other four allied picks are known. A smaller adjustment
                        responds independently to known enemy frontline, engage,
                        peel, and waveclear, scaling up as their draft becomes
                        visible.
                    </p>
                    <label class="mt-3 grid gap-1">
                        <span class="flex justify-between gap-2 text-sm uppercase">
                            <span>Composition influence</span>
                            <span class="tabular-nums opacity-70">
                                {draftWeights.compositionInfluence}%
                            </span>
                        </span>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            step="5"
                            class="w-full accent-secondary"
                            value={draftWeights.compositionInfluence}
                            aria-label="Composition influence"
                            onInput={(event) =>
                                setDraftWeights(
                                    "compositionInfluence",
                                    event.currentTarget.valueAsNumber,
                                )
                            }
                            onChange={(event) =>
                                setConfig({
                                    compositionInfluence:
                                        event.currentTarget.valueAsNumber,
                                })
                            }
                        />
                    </label>
                </fieldset>
            </div>
            <div>
                <h3 class="text-3xl uppercase">UI</h3>
                <div class="flex space-x-8 items-center justify-between mt-2">
                    <span class="text-lg uppercase">
                        Place favourites at top of suggestions
                    </span>
                    <Switch
                        checked={config.showFavouritesAtTop}
                        onChange={() =>
                            setConfig({
                                showFavouritesAtTop:
                                    !config.showFavouritesAtTop,
                            })
                        }
                    />
                </div>

                <Show when={isDesktop}>
                    <div class="flex flex-col gap-1 mt-2">
                        <span class="text-lg uppercase">
                            Place banned champion suggestions at
                        </span>
                        <ButtonGroup
                            options={draftTablePlacementOptions}
                            selected={config.banPlacement}
                            size="sm"
                            onChange={(v) =>
                                setConfig({
                                    banPlacement: v,
                                })
                            }
                        />
                    </div>
                    <div class="flex flex-col gap-1 mt-2">
                        <span class="text-lg uppercase">
                            Place unowned champion suggestions at
                        </span>
                        <ButtonGroup
                            options={[
                                {
                                    value: DraftTablePlacement.Bottom,
                                    label: "Bottom",
                                },
                                {
                                    value: DraftTablePlacement.InPlace,
                                    label: "In Place",
                                },
                                {
                                    value: DraftTablePlacement.Hidden,
                                    label: "Hidden",
                                },
                            ]}
                            size="sm"
                            selected={config.unownedPlacement}
                            onChange={(v) =>
                                setConfig({
                                    unownedPlacement: v,
                                })
                            }
                        />
                    </div>
                </Show>

                <div class="flex space-x-8 items-center justify-between mt-2">
                    <span class="text-lg uppercase">
                        Show advanced winrates
                    </span>
                    <Switch
                        checked={config.showAdvancedWinrates}
                        onChange={() =>
                            setConfig({
                                showAdvancedWinrates:
                                    !config.showAdvancedWinrates,
                            })
                        }
                    />
                </div>
            </div>

            <Show when={isDesktop}>
                <div>
                    <h3 class="text-3xl uppercase">League Client</h3>
                    <div class="flex space-x-16 items-center justify-between mt-2">
                        <span class="text-lg uppercase">
                            Disable league client integration
                        </span>
                        <Switch
                            checked={config.disableLeagueClientIntegration}
                            onChange={() =>
                                setConfig({
                                    disableLeagueClientIntegration:
                                        !config.disableLeagueClientIntegration,
                                })
                            }
                        />
                    </div>
                </div>
            </Show>

            <div>
                <h3 class="text-3xl uppercase">Misc</h3>
                <div class="flex flex-col gap-1 mt-2">
                    <span class="text-lg uppercase">Lolalytics time range</span>
                    <p class="text-sm text-neutral-400">
                        Applies to Builds recommendations and Lolalytics links.
                    </p>
                    <ButtonGroup
                        options={
                            [
                                {
                                    value: "current-patch",
                                    label: "Current patch",
                                },
                                { value: "30-days", label: "Last 30 days" },
                            ] as const
                        }
                        selected={config.lolalyticsTimeRange}
                        size="sm"
                        onChange={(value) =>
                            setConfig("lolalyticsTimeRange", value)
                        }
                    />
                </div>
                <div class="flex flex-col gap-1 mt-2">
                    <span class="text-lg uppercase">Favourite builds site</span>
                    <ButtonGroup
                        options={statsSiteOptions}
                        selected={config.defaultStatsSite}
                        size="sm"
                        onChange={(value: StatsSite) =>
                            setConfig({
                                defaultStatsSite: value,
                            })
                        }
                    />
                </div>
            </div>
        </DialogContent>
    );
}
