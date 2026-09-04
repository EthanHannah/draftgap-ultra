import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Combobox } from "@kobalte/core";
import {
    batch,
    createEffect,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    on,
    Show,
} from "solid-js";
import { displayNameByRole, Role, ROLES } from "@draftgap/core/src/models/Role";
import { ChampionData } from "@draftgap/core/src/models/dataset/ChampionData";
import { useDataset } from "../../contexts/DatasetContext";
import { useDraft } from "../../contexts/DraftContext";
import { useDraftAnalysis } from "../../contexts/DraftAnalysisContext";
import { useUser } from "../../contexts/UserContext";
import { getLocalLockedPick } from "../../utils/locked-pick";
import { linkByStatsSite } from "../../utils/sites";
import { Button } from "../common/Button";
import { ButtonGroup } from "../common/ButtonGroup";
import { useMedia } from "../../hooks/useMedia";
import { championName } from "../../utils/i18n";

type Props = {
    pick: ReturnType<typeof getLocalLockedPick>;
    active: boolean;
};

// Serialize updates across mounts so a stale close cannot remove a new view.
let browserUpdate = Promise.resolve();

export function LolalyticsView(props: Props) {
    const { dataset } = useDataset();
    const { config } = useUser();
    const { allyTeam } = useDraft();
    const { allyTeamComp } = useDraftAnalysis();
    const { isDesktop } = useMedia();
    const [championKey, setChampionKey] = createSignal<string>();
    const [role, setRole] = createSignal<Role>(Role.Middle);
    const [error, setError] = createSignal(false);
    let container!: HTMLDivElement;
    let disposed = false;
    let lastUrl: string | undefined;
    let lastLayout = "";

    const champions = createMemo(() =>
        Object.values(dataset()?.championData ?? {}).sort((a, b) =>
            championName(a, config).localeCompare(championName(b, config)),
        ),
    );
    const champion = () => {
        const key = championKey();
        return key ? dataset()?.championData[key] : undefined;
    };
    const preferredRole = (selectedChampion: ChampionData) =>
        ROLES.reduce((best, candidate) =>
            (selectedChampion.statsByRole[candidate]?.games ?? 0) >
            (selectedChampion.statsByRole[best]?.games ?? 0)
                ? candidate
                : best,
        );
    const selectChampion = (selectedChampion: ChampionData | null) => {
        if (!selectedChampion) return;
        batch(() => {
            setChampionKey(selectedChampion.key);
            setRole(preferredRole(selectedChampion));
        });
    };

    // Follow new lock-ins and trades without overwriting manual browsing on polls.
    createEffect(
        on(
            () => props.pick,
            (pick) => {
                if (!pick) return;
                const selectedChampion =
                    dataset()?.championData[pick.championKey];
                if (!selectedChampion) return;
                const draftPick = allyTeam[pick.index];
                batch(() => {
                    setChampionKey(pick.championKey);
                    setRole(
                        pick.role ??
                            (draftPick?.championKey === pick.championKey
                                ? draftPick.role
                                : undefined) ??
                            [...allyTeamComp().entries()].find(
                                ([, key]) => key === pick.championKey,
                            )?.[0] ??
                            preferredRole(selectedChampion),
                    );
                });
            },
        ),
    );
    const url = createMemo(() => {
        const selectedRole = role();
        const selectedChampion = champion();
        if (!selectedChampion || selectedRole === undefined) return undefined;
        return linkByStatsSite(
            "lolalytics",
            selectedChampion.id,
            selectedRole,
            config.lolalyticsTimeRange,
        );
    });

    const syncBrowser = () => {
        if (disposed || !container || !isDesktop) return;
        const href = url();
        if (!href && !lastUrl) return;
        const bounds = container.getBoundingClientRect();
        // Native webviews sit above DOM overlays, so hide for dialogs and menus.
        const overlay = document.querySelector(
            '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
        );
        const visible =
            props.active &&
            !!href &&
            !overlay &&
            bounds.width > 0 &&
            bounds.height > 0;
        const layout = JSON.stringify([
            visible,
            bounds.x,
            bounds.y,
            bounds.width,
            bounds.height,
        ]);
        if (href === lastUrl && layout === lastLayout) return;
        const nextUrl = href !== lastUrl ? href : undefined;
        lastUrl = href;
        lastLayout = layout;
        browserUpdate = browserUpdate.then(async () => {
            if (disposed) return;
            try {
                await invoke("update_lolalytics_view", {
                    url: nextUrl ?? null,
                    visible,
                    x: bounds.x,
                    y: bounds.y,
                    width: Math.max(1, bounds.width),
                    height: Math.max(1, bounds.height),
                });
                setError(false);
            } catch (err) {
                console.error("Could not display Lolalytics", err);
                lastUrl = undefined;
                lastLayout = "";
                setError(true);
            }
        });
    };

    createEffect(syncBrowser);
    onMount(() => {
        const resizeObserver = new ResizeObserver(syncBrowser);
        resizeObserver.observe(container);
        const overlayObserver = new MutationObserver(syncBrowser);
        overlayObserver.observe(document.body, {
            childList: true,
            subtree: true,
        });
        window.addEventListener("resize", syncBrowser);
        document.addEventListener("scroll", syncBrowser, true);
        syncBrowser();
        onCleanup(() => {
            resizeObserver.disconnect();
            overlayObserver.disconnect();
            window.removeEventListener("resize", syncBrowser);
            document.removeEventListener("scroll", syncBrowser, true);
        });
    });
    onCleanup(() => {
        disposed = true;
        if (!isDesktop) return;
        browserUpdate = browserUpdate.then(async () => {
            await invoke("close_lolalytics_view").catch(console.error);
        });
    });

    return (
        <div
            class="flex flex-col flex-1 min-h-0"
            classList={{ hidden: !props.active }}
        >
            <div class="flex flex-wrap items-center justify-between gap-2 px-4 py-2 border-b border-neutral-700">
                <Combobox.Root<ChampionData>
                    options={champions()}
                    value={champion() ?? null}
                    onChange={selectChampion}
                    optionValue="key"
                    optionTextValue={(option) => championName(option, config)}
                    optionLabel={(option) => championName(option, config)}
                    placeholder="Search champions"
                    class="w-56"
                    itemComponent={(itemProps) => (
                        <Combobox.Item
                            item={itemProps.item}
                            class="cursor-pointer px-3 py-2 outline-none data-[highlighted]:bg-neutral-700"
                        >
                            <Combobox.ItemLabel>
                                {championName(itemProps.item.rawValue, config)}
                            </Combobox.ItemLabel>
                        </Combobox.Item>
                    )}
                >
                    <Combobox.Label class="mb-1 block text-xs uppercase text-neutral-400">
                        Champion
                    </Combobox.Label>
                    <Combobox.Control class="flex rounded-md border border-neutral-700 bg-primary">
                        <Combobox.Input class="min-w-0 flex-1 bg-transparent px-3 py-2 outline-none" />
                        <Combobox.Trigger
                            class="px-3"
                            aria-label="Choose champion"
                        >
                            ▾
                        </Combobox.Trigger>
                    </Combobox.Control>
                    <Combobox.Portal>
                        <Combobox.Content class="z-50 w-56 rounded-md border border-neutral-700 bg-primary shadow-lg">
                            <Combobox.Listbox class="max-h-72 overflow-y-auto py-1" />
                        </Combobox.Content>
                    </Combobox.Portal>
                </Combobox.Root>
                <div>
                    <span class="mb-1 block text-xs uppercase text-neutral-400">
                        Role
                    </span>
                    <ButtonGroup
                        options={ROLES.map((value) => ({
                            value,
                            label: displayNameByRole[value],
                        }))}
                        selected={role()}
                        onChange={setRole}
                        size="sm"
                        role="group"
                        aria-label="Champion role"
                    />
                </div>
                <span class="text-sm text-neutral-400">
                    {config.lolalyticsTimeRange === "30-days"
                        ? "Last 30 days"
                        : "Current patch"}
                </span>
                <Show when={url()}>
                    {(href) => (
                        <Button
                            variant="secondary"
                            onClick={() =>
                                isDesktop
                                    ? openUrl(href())
                                    : window.open(
                                          href(),
                                          "_blank",
                                          "noopener,noreferrer",
                                      )
                            }
                        >
                            Open in browser
                        </Button>
                    )}
                </Show>
            </div>
            <div ref={container} class="flex-1 min-h-0">
                <Show when={!url()}>
                    <p class="p-4 text-neutral-400">
                        Choose a champion above to view their Lolalytics page.
                        Locking in will automatically select your champion and
                        role.
                    </p>
                </Show>
                <Show when={url() && !isDesktop}>
                    <p class="p-4 text-neutral-400">
                        Use the desktop app to view Lolalytics here, or select
                        Open in browser.
                    </p>
                </Show>
                <Show when={error()}>
                    <div class="p-4 space-y-3">
                        <p>Could not open Lolalytics in the app.</p>
                        <Button variant="secondary" onClick={syncBrowser}>
                            Retry
                        </Button>
                    </div>
                </Show>
            </div>
        </div>
    );
}
