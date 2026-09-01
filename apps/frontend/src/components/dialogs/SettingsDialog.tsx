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
import { displayNameByRole, Role, ROLES } from "@draftgap/core/src/models/Role";
import { RoleIcon } from "../icons/roles/RoleIcon";

type RoleWeightType = "matchupRoleWeights" | "duoRoleWeights";

export default function SettingsDialog() {
    const { isDesktop } = useMedia();
    const { config, setConfig } = useUser();
    const [draftWeights, setDraftWeights] = createStore({
        championWinrateInfluence: config.championWinrateInfluence,
        matchupRoleWeights: { ...config.matchupRoleWeights },
        duoRoleWeights: { ...config.duoRoleWeights },
        blindabilityWeight: config.blindabilityWeight,
        enemySafetyPriority: config.enemySafetyPriority,
        compositionInfluence: config.compositionInfluence,
    });

    function updateRoleWeight(type: RoleWeightType, role: Role, value: number) {
        setDraftWeights(type, role, value);
    }

    function saveRoleWeight(type: RoleWeightType, role: Role, value: number) {
        if (type === "matchupRoleWeights") {
            setConfig("matchupRoleWeights", role, value);
        } else {
            setConfig("duoRoleWeights", role, value);
        }
    }

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
                <fieldset class="mt-5">
                    <legend class="text-lg uppercase">Role influence</legend>
                    <p class="text-sm opacity-60">
                        Matchup weights apply to the opponent's role, so 0%
                        ignores that enemy role. Duo interactions use the
                        average of both ally role weights; a 0% role disables
                        duos involving it.
                    </p>
                    <div class="mt-3 grid grid-cols-[minmax(6.5rem,auto)_minmax(0,1fr)_minmax(0,1fr)] items-end gap-x-4 gap-y-3">
                        <span class="text-sm uppercase opacity-60">Role</span>
                        <span class="text-center text-sm uppercase opacity-60">
                            Matchup
                        </span>
                        <span class="text-center text-sm uppercase opacity-60">
                            Duo
                        </span>
                        <For each={ROLES}>
                            {(role) => (
                                <>
                                    <div class="flex items-center gap-2">
                                        <RoleIcon role={role} class="h-7 w-7" />
                                        <span class="uppercase">
                                            {displayNameByRole[role]}
                                        </span>
                                    </div>
                                    <label class="grid gap-1">
                                        <span class="text-center text-sm tabular-nums opacity-70">
                                            {
                                                draftWeights.matchupRoleWeights[
                                                    role
                                                ]
                                            }
                                            %
                                        </span>
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            step="5"
                                            class="w-full accent-secondary"
                                            value={
                                                draftWeights.matchupRoleWeights[
                                                    role
                                                ]
                                            }
                                            aria-label={`${displayNameByRole[role]} matchup influence`}
                                            onInput={(event) =>
                                                updateRoleWeight(
                                                    "matchupRoleWeights",
                                                    role,
                                                    event.currentTarget
                                                        .valueAsNumber,
                                                )
                                            }
                                            onChange={(event) =>
                                                saveRoleWeight(
                                                    "matchupRoleWeights",
                                                    role,
                                                    event.currentTarget
                                                        .valueAsNumber,
                                                )
                                            }
                                        />
                                    </label>
                                    <label class="grid gap-1">
                                        <span class="text-center text-sm tabular-nums opacity-70">
                                            {draftWeights.duoRoleWeights[role]}%
                                        </span>
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            step="5"
                                            class="w-full accent-secondary"
                                            value={
                                                draftWeights.duoRoleWeights[
                                                    role
                                                ]
                                            }
                                            aria-label={`${displayNameByRole[role]} duo influence`}
                                            onInput={(event) =>
                                                updateRoleWeight(
                                                    "duoRoleWeights",
                                                    role,
                                                    event.currentTarget
                                                        .valueAsNumber,
                                                )
                                            }
                                            onChange={(event) =>
                                                saveRoleWeight(
                                                    "duoRoleWeights",
                                                    role,
                                                    event.currentTarget
                                                        .valueAsNumber,
                                                )
                                            }
                                        />
                                    </label>
                                </>
                            )}
                        </For>
                    </div>
                </fieldset>
                <fieldset class="mt-5">
                    <legend class="text-lg uppercase">Blindability</legend>
                    <p class="text-sm opacity-60">
                        Blindability combines compatibility with likely unknown
                        teammates and exposure to likely enemy counters.
                        Teammates are weighted by pick rate. Counter likelihood
                        blends pick rate with equal champion coverage, so niche
                        counterpicks still matter after you reveal a pick.
                        Counter penalties increase smoothly with estimated
                        downside, so severe counters matter progressively more
                        without a hard scoring cutoff. The direct-role opponent
                        is primary; all four non-lane roles together receive
                        half as much weight. Results are compared with viable
                        choices in the same role, and sparse interactions are
                        pulled toward neutral by the selected risk level. Enemy
                        safety receives more weight by default for solo queue.
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
