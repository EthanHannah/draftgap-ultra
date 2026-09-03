import { Icon } from "solid-heroicons";
import { funnel } from "solid-heroicons/solid";
import { ButtonGroup, ButtonGroupOption } from "../common/ButtonGroup";
import { Popover, PopoverContent, PopoverTrigger } from "../common/Popover";
import { useUser } from "../../contexts/UserContext";
import { buttonVariants } from "../common/Button";
import { cn } from "../../utils/style";
import { useDraftFilters } from "../../contexts/DraftFiltersContext";
import { ScalingProfile } from "@draftgap/core/src/draft/scaling";

export function FilterMenu() {
    const { config, setConfig } = useUser();
    const { scalingFilter, setScalingFilter } = useDraftFilters();

    const scalingOptions: ButtonGroupOption<ScalingProfile | undefined>[] = [
        { value: undefined, label: "All" },
        { value: "early", label: "Early" },
        { value: "mid", label: "Mid" },
        { value: "late", label: "Late" },
        { value: "stable", label: "Stable" },
        { value: "u-shaped", label: "U-Shaped" },
    ];

    const minGameCountOptions: ButtonGroupOption<number>[] = [
        500, 1000, 2500, 5000, 10000, 25000,
    ].map((n) => ({
        value: n,
        label: n >= 1000 ? `${n / 1000}k` : n.toString(),
    }));

    return (
        <Popover>
            <PopoverTrigger
                class={cn(buttonVariants({ variant: "transparent" }), "px-1")}
                aria-label={
                    scalingFilter()
                        ? `Filters (scaling: ${scalingFilter()})`
                        : "Filters"
                }
            >
                <Icon
                    path={funnel}
                    class={cn("w-6 text-neutral-300", {
                        "text-blue-400": scalingFilter() !== undefined,
                    })}
                />
            </PopoverTrigger>
            <PopoverContent>
                <span class="text-2xl uppercase block mb-1 leading-none">
                    Filters
                </span>
                <span class="text-lg uppercase block">
                    Minimum game count (7D)
                </span>
                <ButtonGroup
                    options={minGameCountOptions}
                    size="sm"
                    class="flex w-full [&>button]:flex-1 [&>button]:px-2"
                    aria-label="Minimum game count (7D)"
                    selected={config.minGames}
                    onChange={(value: number) =>
                        setConfig({
                            minGames: value,
                        })
                    }
                />
                <span class="text-lg uppercase block mt-4">Scaling</span>
                <ButtonGroup
                    options={scalingOptions}
                    size="sm"
                    class="grid w-full grid-cols-3 gap-1 text-base shadow-none [&>button]:m-0 [&>button]:rounded-md [&>button]:justify-center [&>button]:whitespace-nowrap [&>button]:px-1"
                    role="group"
                    aria-label="Scaling"
                    selected={scalingFilter()}
                    onChange={setScalingFilter}
                />
                <p class="text-sm text-neutral-400 mt-2">
                    Early: under 20 min. Mid: 20–30 min. Late: 30+ min. Stable:
                    similar win rates across all three. U-Shaped: stronger early
                    and late, with a dip in mid game.
                </p>
                <p class="text-sm text-neutral-400 mt-2">
                    Based on 30-day results for each role. Champions with too
                    little data appear only in All.
                </p>
            </PopoverContent>
        </Popover>
    );
}
