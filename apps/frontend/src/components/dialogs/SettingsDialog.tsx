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
    const [roleWeights, setRoleWeights] = createStore({
        matchupRoleWeights: { ...config.matchupRoleWeights },
        duoRoleWeights: { ...config.duoRoleWeights },
    });

    function updateRoleWeight(type: RoleWeightType, role: Role, value: number) {
        setRoleWeights(type, role, value);
        saveRoleWeight(type, role, value);
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
                            {config.championWinrateInfluence}%
                        </span>
                    </span>
                    <input
                        type="range"
                        min="0"
                        max="100"
                        step="5"
                        class="w-full accent-secondary"
                        value={config.championWinrateInfluence}
                        aria-label="Individual champion winrate influence"
                        onInput={(event) =>
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
                        Adjust how strongly each role's matchups and duos affect
                        results. 100% is the default; interactions use the
                        average weight of both roles.
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
                                                roleWeights.matchupRoleWeights[
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
                                                roleWeights.matchupRoleWeights[
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
                                            {roleWeights.duoRoleWeights[role]}%
                                        </span>
                                        <input
                                            type="range"
                                            min="0"
                                            max="200"
                                            step="5"
                                            class="w-full accent-secondary"
                                            value={
                                                roleWeights.duoRoleWeights[role]
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
