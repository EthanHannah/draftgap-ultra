import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseFullBuildSets } from "@draftgap/core/src/builds/combined-builds";

export async function fetchDesktopItemSets(request: BuildRequest) {
    if (!isTauri())
        throw new Error("Builds are available only in the desktop app.");
    try {
        const text = await invoke<string>("fetch_lolalytics_item_sets", {
            request,
        });
        return parseFullBuildSets(JSON.parse(text));
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
}
import {
    BuildRequest,
    parseLolalyticsBuildPage,
} from "@draftgap/core/src/builds/lolalytics";

export async function fetchDesktopBuild(request: BuildRequest) {
    if (!isTauri())
        throw new Error("Builds are available only in the desktop app.");
    try {
        const html = await invoke<string>("fetch_lolalytics_build", {
            request,
        });
        return parseLolalyticsBuildPage(html);
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }
}
