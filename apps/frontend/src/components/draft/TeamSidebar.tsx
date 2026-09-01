import { For } from "solid-js";
import { winrateToRating } from "@draftgap/core/src/rating/ratings";
import { CountUp } from "../CountUp";
import { DamageDistributionBar } from "./DamageDistributionBar";
import { Pick } from "./Pick";
import { TeamOptions } from "./TeamOptions";
import { tooltip } from "../../directives/tooltip";
import { capitalize } from "../../utils/strings";
import { getRatingClass } from "../../utils/rating";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
// eslint-disable-next-line
tooltip;

interface IProps {
    team: "ally" | "opponent";
}

export function TeamSidebar(props: IProps) {
    const {
        allyDraftAnalysis: allyDraftResult,
        opponentDraftAnalysis: opponentDraftResult,
    } = useDraftAnalysis();

    const winrate = () =>
        props.team === "ally"
            ? allyDraftResult()?.winrate
            : opponentDraftResult()?.winrate;

    return (
        <div class="bg-primary flex flex-col h-full relative">
            <DamageDistributionBar team={props.team} />
            <div class="flex-1 flex justify-center items-center bg-[#141414]">
                <span
                    class="text-[2.5rem] text-center leading-tight"
                    // @ts-ignore
                    use:tooltip={{
                        content: (
                            <>{capitalize(props.team)} estimated winrate</>
                        ),
                    }}
                >
                    {props.team.toUpperCase()}
                    <br />
                    <CountUp
                        value={winrate() ?? 0.5}
                        formatFn={(value) => (value * 100).toFixed(2)}
                        class={`${getRatingClass(
                            winrateToRating(winrate() ?? 0.5),
                        )} transition-colors duration-500`}
                        style={{
                            "font-variant-numeric": "tabular-nums",
                        }}
                    />
                </span>
            </div>
            <For each={[0, 1, 2, 3, 4]}>
                {(index) => <Pick team={props.team} index={index} />}
            </For>
            <TeamOptions team={props.team} />
        </div>
    );
}
