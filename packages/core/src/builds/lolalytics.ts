import { Role } from "../models/Role";
import { ExactBuildSets } from "./combined-builds";
import type { SuggestedRunePage } from "./recommendations";

export const BUILD_ROLES = [
    "top",
    "jungle",
    "middle",
    "bottom",
    "support",
] as const;

export type BuildRequest = {
    patch: string;
    championId: string;
    role: (typeof BUILD_ROLES)[Role];
    matchupId?: string;
    matchupRole?: (typeof BUILD_ROLES)[Role];
    keystone?: number;
};

// Lolalytics' current page format: [ID, win %, pick %, games, ...].
type BuildRow = [number | string, number, number, number, ...number[]];
export type LolalyticsBuildData = {
    header: {
        cid: number;
        patch: string;
        lane: string;
        n: number;
        wr: number;
        vs?: number;
        vsLane?: string;
    };
    runes: { stats: Record<string, [number, number, number][]> };
    boots: BuildRow[];
    startSet: BuildRow[];
    spells: BuildRow[];
    item1: BuildRow[];
    item2: BuildRow[];
    item3: BuildRow[];
    item4: BuildRow[];
    item5: BuildRow[];
    skillOrder: BuildRow[];
    skillEarly: [number, number, number][][];
    itemSets?: ExactBuildSets;
    builtBootSet3?: BuildRow[];
    suggestedRunePage?: SuggestedRunePage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRate(value: unknown) {
    return isNumber(value) && value <= 100;
}

function isBuildRow(row: unknown) {
    return (
        Array.isArray(row) &&
        (typeof row[0] === "string" || isNumber(row[0])) &&
        isRate(row[1]) &&
        isNumber(row[2]) &&
        isNumber(row[3])
    );
}

export function parseLolalyticsBuildPage(html: string) {
    const match = html.match(
        /<script\s+type=["']qwik\/json["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    if (!match)
        throw new Error(
            "Lolalytics did not return build data. Please try again later.",
        );

    let document: unknown;
    try {
        document = JSON.parse(match[1]);
    } catch {
        throw new Error("Lolalytics returned invalid page data.");
    }
    if (!isRecord(document) || !Array.isArray(document.objs)) {
        throw new Error("Lolalytics page format has changed.");
    }
    const objects: unknown[] = document.objs;
    const root = objects.find(
        (value) =>
            isRecord(value) &&
            "header" in value &&
            "runes" in value &&
            "skillOrder" in value &&
            "item1" in value,
    );
    if (!isRecord(root))
        throw new Error(
            "No build statistics are available for this champion and role.",
        );

    // Decode only build fields, never the page's executable/component state.
    const decode = (reference: unknown, depth = 0): unknown => {
        if (
            typeof reference !== "string" ||
            !/^[0-9a-z]+$/.test(reference) ||
            depth > 32
        ) {
            throw new Error("Invalid Lolalytics data reference.");
        }
        const index = parseInt(reference, 36);
        if (index >= objects.length)
            throw new Error("Invalid Lolalytics data reference.");
        const value = objects[index];
        if (Array.isArray(value))
            return value.map((entry) => decode(entry, depth + 1));
        if (isRecord(value))
            return Object.fromEntries(
                Object.entries(value).map(([key, entry]) => [
                    key,
                    decode(entry, depth + 1),
                ]),
            );
        return value;
    };
    const fields = [
        "header",
        "runes",
        "boots",
        "startSet",
        "spells",
        "item1",
        "item2",
        "item3",
        "item4",
        "item5",
        "skillOrder",
        "skillEarly",
    ];
    const data = Object.fromEntries(
        fields.map((field) => [
            field,
            root[field] === undefined ? undefined : decode(root[field]),
        ]),
    );
    const header = data.header;
    if (
        !isRecord(header) ||
        !isNumber(header.cid) ||
        typeof header.patch !== "string" ||
        typeof header.lane !== "string" ||
        !isNumber(header.n) ||
        !isRate(header.wr)
    ) {
        throw new Error("Lolalytics returned invalid build statistics.");
    }
    if (header.n === 0)
        throw new Error("No games are available for this champion and role.");
    const runes = data.runes;
    if (
        !isRecord(runes) ||
        !isRecord(runes.stats) ||
        !Object.values(runes.stats).every(
            (rows) =>
                Array.isArray(rows) &&
                rows.every(
                    (row) =>
                        Array.isArray(row) &&
                        isNumber(row[0]) &&
                        isRate(row[1]) &&
                        isNumber(row[2]),
                ),
        )
    ) {
        throw new Error("Lolalytics returned invalid rune statistics.");
    }
    for (const field of [
        "boots",
        "startSet",
        "spells",
        "item1",
        "item2",
        "item3",
        "item4",
        "item5",
        "skillOrder",
    ]) {
        // Later item slots may be absent for sparse matchups.
        if (/^item[2-5]$/.test(field) && data[field] === undefined)
            data[field] = [];
        if (!Array.isArray(data[field]) || !data[field].every(isBuildRow)) {
            throw new Error(`Lolalytics returned invalid ${field} statistics.`);
        }
    }
    if (
        !Array.isArray(data.skillEarly) ||
        !data.skillEarly.every(
            (level) =>
                Array.isArray(level) &&
                level.length === 4 &&
                level.every(
                    (row) =>
                        Array.isArray(row) &&
                        isRate(row[0]) &&
                        isNumber(row[1]) &&
                        isNumber(row[2]),
                ),
        )
    ) {
        throw new Error("Lolalytics returned invalid skill statistics.");
    }
    // Set-level data is optional (not present on matchup pages). An upstream
    // change here must not prevent the individual build tables from loading.
    try {
        const exact =
            root.itemSets === undefined ? undefined : decode(root.itemSets);
        const built =
            root.builtBootSet3 === undefined
                ? undefined
                : decode(root.builtBootSet3);
        if (
            isRecord(exact) &&
            [1, 2, 3].every((count) => {
                const bucket = exact[`itemBootSet${count}`];
                return (
                    isRecord(bucket) &&
                    Object.entries(bucket).every(
                        ([key, stats]) =>
                            key.split("_").length === count &&
                            /^\d+(?:_\d+)*$/.test(key) &&
                            Array.isArray(stats) &&
                            isNumber(stats[0]) &&
                            isNumber(stats[1]) &&
                            stats[1] <= stats[0],
                    )
                );
            }) &&
            Array.isArray(built) &&
            built.every(
                (row) =>
                    isBuildRow(row) &&
                    typeof row[0] === "string" &&
                    /^\d+_\d+_\d+$/.test(row[0]),
            )
        ) {
            data.itemSets = exact;
            data.builtBootSet3 = built;
        }
    } catch {
        // The recommendation panel explains that set data is unavailable.
    }
    try {
        const summary =
            root.summary === undefined ? undefined : decode(root.summary);
        const picked =
            isRecord(summary) && isRecord(summary.pick)
                ? summary.pick.runes
                : undefined;
        const set = isRecord(picked) ? picked.set : undefined;
        if (
            isRecord(set) &&
            ["pri", "sec", "mod"].every(
                (key) => Array.isArray(set[key]) && set[key].every(isNumber),
            )
        ) {
            data.suggestedRunePage = {
                primary: set.pri,
                secondary: set.sec,
                shards: set.mod,
            };
        }
    } catch {
        /* Optional page suggestions must not break baseline statistics. */
    }
    return data as LolalyticsBuildData;
}
