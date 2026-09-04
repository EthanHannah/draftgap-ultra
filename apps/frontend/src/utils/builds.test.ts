/// <reference types="bun" />
import { expect, test } from "bun:test";
import { fetchDesktopBuild, fetchDesktopItemSets } from "./builds";

test("web clients cannot fetch builds or invoke the native transport", async () => {
    await expect(
        fetchDesktopBuild({ championId: "Ahri", patch: "30", role: "middle" }),
    ).rejects.toThrow("only in the desktop app");
    await expect(
        fetchDesktopItemSets({
            championId: "Ahri",
            patch: "30",
            role: "middle",
        }),
    ).rejects.toThrow("only in the desktop app");
});
