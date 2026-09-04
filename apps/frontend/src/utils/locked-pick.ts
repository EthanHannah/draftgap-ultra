import { Role } from "@draftgap/core/src/models/Role";
import { LolChampSelectChampSelectSession } from "../types/Lcu";

const CLIENT_ROLES: Record<string, Role | undefined> = {
    top: Role.Top,
    jungle: Role.Jungle,
    middle: Role.Middle,
    bottom: Role.Bottom,
    utility: Role.Support,
};

export function getLockedBuildPick(
    previous: ReturnType<typeof getLocalLockedPick>,
    next: ReturnType<typeof getLocalLockedPick>,
    isDesktop: boolean,
) {
    if (!isDesktop || !next) return undefined;
    // Do not steal navigation on every client poll after the user changes tabs.
    if (
        previous?.championKey === next.championKey &&
        previous.index === next.index
    )
        return undefined;
    return { team: "ally" as const, index: next.index };
}

export function getLocalLockedPick(session: LolChampSelectChampSelectSession) {
    const index = session.myTeam.findIndex(
        (player) => player.cellId === session.localPlayerCellId,
    );
    const player = session.myTeam[index];
    if (!player?.championId || session.isSpectating) return undefined;

    const locked = session.actions
        .flat()
        .some(
            (action) =>
                action.actorCellId === player.cellId &&
                action.type === "pick" &&
                action.completed,
        );
    if (!locked) return undefined;

    // The player's current champion reflects trades after the original lock-in.
    return {
        championKey: String(player.championId),
        role: CLIENT_ROLES[player.assignedPosition],
        index,
    };
}
