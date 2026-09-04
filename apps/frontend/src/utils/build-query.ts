import { Role } from "@draftgap/core/src/models/Role";
import { Dataset } from "@draftgap/core/src/models/dataset/Dataset";

export type BuildQueryKey = readonly [
    "build",
    "current-patch" | "30-days",
    string | undefined,
    Role | undefined,
    Partial<Record<Role, string>> | undefined,
    Dataset | undefined,
];

export function getBuildPlaceholderData<T>(
    previousData: T | undefined,
    previousQuery: { queryKey: readonly unknown[] } | undefined,
    queryKey: BuildQueryKey,
) {
    const previousKey = previousQuery?.queryKey;
    if (!previousKey || previousKey.length !== queryKey.length)
        return undefined;

    // Matchup changes should update in the background without unmounting the
    // build. Never carry a build across champion, role, range or dataset changes.
    return queryKey.every(
        (value, index) => index === 4 || value === previousKey[index],
    )
        ? previousData
        : undefined;
}
