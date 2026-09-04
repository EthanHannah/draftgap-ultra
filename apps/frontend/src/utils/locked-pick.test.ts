/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { Role } from "@draftgap/core/src/models/Role";
import { LolChampSelectChampSelectSession } from "../types/Lcu";
import { getLocalLockedPick, getLockedBuildPick } from "./locked-pick";
import { linkByStatsSite } from "./sites";

function session(completed = true) {
    return {
        localPlayerCellId: 3,
        myTeam: [
            { cellId: 1, championId: 1, assignedPosition: "top" },
            { cellId: 3, championId: 103, assignedPosition: "middle" },
        ],
        actions: [
            [
                {
                    actorCellId: 1,
                    type: "pick",
                    championId: 1,
                    completed: true,
                },
                { actorCellId: 3, type: "pick", championId: 103, completed },
            ],
        ],
    } as LolChampSelectChampSelectSession;
}

describe("local lock-in", () => {
    test("opens the local ally build on lock-in and trades, not every poll", () => {
        const pick = getLocalLockedPick(session());
        expect(getLockedBuildPick(undefined, pick, true)).toEqual({
            team: "ally",
            index: 1,
        });
        expect(getLockedBuildPick(pick, { ...pick! }, true)).toBeUndefined();
        expect(
            getLockedBuildPick(pick, { ...pick!, role: Role.Top }, true),
        ).toBeUndefined();
        expect(
            getLockedBuildPick(pick, { ...pick!, championKey: "99" }, true),
        ).toEqual({ team: "ally", index: 1 });
        expect(getLockedBuildPick(pick, { ...pick!, index: 0 }, true)).toEqual({
            team: "ally",
            index: 0,
        });
        expect(
            getLockedBuildPick(
                undefined,
                getLocalLockedPick(session(false)),
                true,
            ),
        ).toBeUndefined();
        expect(getLockedBuildPick(undefined, pick, false)).toBeUndefined();
    });
    test("ignores hovered champions and completed teammate picks", () => {
        expect(getLocalLockedPick(session(false))).toBeUndefined();
    });

    test("finds the local player by cell ID and selects the assigned role", () => {
        expect(getLocalLockedPick(session())).toEqual({
            championKey: "103",
            role: Role.Middle,
            index: 1,
        });
        const support = session();
        support.myTeam[1].assignedPosition = "utility";
        expect(getLocalLockedPick(support)?.role).toBe(Role.Support);
    });

    test("uses the traded champion instead of the original pick action", () => {
        const traded = session();
        traded.myTeam[1].championId = 99;
        expect(getLocalLockedPick(traded)?.championKey).toBe("99");
    });

    test("ignores bans, missing players, and spectators", () => {
        const banned = session();
        banned.actions[0][1].type = "ban";
        expect(getLocalLockedPick(banned)).toBeUndefined();
        expect(
            getLocalLockedPick({ ...session(), localPlayerCellId: 9 }),
        ).toBeUndefined();
        expect(
            getLocalLockedPick({ ...session(), isSpectating: true }),
        ).toBeUndefined();
    });

    test("leaves unassigned roles available for the draft's role prediction", () => {
        const unassigned = session();
        unassigned.myTeam[1].assignedPosition = "";
        expect(getLocalLockedPick(unassigned)?.role).toBeUndefined();
    });
});

describe("Lolalytics links", () => {
    test("selects the role and defaults to the site's current patch", () => {
        expect(linkByStatsSite("lolalytics", "Ahri", Role.Middle)).toBe(
            "https://lolalytics.com/lol/ahri/build/?lane=middle",
        );
    });

    test("selects the rolling 30 days and normalizes Wukong's ID", () => {
        expect(
            linkByStatsSite("lolalytics", "MonkeyKing", Role.Jungle, "30-days"),
        ).toBe("https://lolalytics.com/lol/wukong/build/?lane=jungle&patch=30");
    });

    test("does not apply the Lolalytics range to other sites", () => {
        expect(linkByStatsSite("u.gg", "Ahri", Role.Middle, "30-days")).toBe(
            "https://u.gg/lol/champions/ahri/build/mid",
        );
    });
});
