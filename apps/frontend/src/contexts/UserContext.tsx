import {
    JSXElement,
    createContext,
    createEffect,
    createSignal,
    useContext,
} from "solid-js";
import { createStore } from "solid-js/store";
import { DEFAULT_ROLE_WEIGHTS, Role } from "@draftgap/core/src/models/Role";
import {
    DraftGapConfig,
    DEFAULT_RECOMMENDATION_MIN_GAMES,
} from "@draftgap/core/src/models/user/Config";

type FavouritePick = `${string}:${Role}`;

const DEFAULT_CONFIG: DraftGapConfig = {
    // DRAFT CONFIG
    championWinrateInfluence: 100,
    riskLevel: "low",
    minGames: DEFAULT_RECOMMENDATION_MIN_GAMES,
    matchupRoleWeights: { ...DEFAULT_ROLE_WEIGHTS },
    duoRoleWeights: { ...DEFAULT_ROLE_WEIGHTS },
    analyzeHovers: false,

    // UI
    showFavouritesAtTop: false,
    banPlacement: "bottom",
    unownedPlacement: "bottom",
    contextInfluence: 100,
    blindabilityWeight: 50,
    enemySafetyPriority: 75,
    compositionInfluence: 50,
    showAdvancedWinrates: false,
    language: "en_US",

    // MISC
    defaultStatsSite: "lolalytics",
    lolalyticsTimeRange: "current-patch",
    enableBetaFeatures: false,

    // LOL CLIENT
    disableLeagueClientIntegration: false,
};

const FAVOURITE_PICKS_KEY = "draftgap-favourite-picks";
const CONFIG_KEY = "draftgap-config";

function createConfig() {
    const storedConfig = JSON.parse(
        localStorage.getItem(CONFIG_KEY) || "{}",
    ) as Partial<DraftGapConfig> & {
        ignoreChampionWinrates?: boolean;
        synergyBlindabilityWeight?: number;
        matchupBlindabilityWeight?: number;
        interactionMinGames?: number;
    };
    // Interaction eligibility is fixed in the scoring model, not a preference.
    delete storedConfig.interactionMinGames;
    const {
        ignoreChampionWinrates,
        synergyBlindabilityWeight,
        matchupBlindabilityWeight,
        ...partialInitialConfig
    } = storedConfig;
    const championWinrateInfluence =
        partialInitialConfig.championWinrateInfluence ??
        (ignoreChampionWinrates ? 0 : 100);
    const legacyBlindabilityWeights = [
        synergyBlindabilityWeight,
        matchupBlindabilityWeight,
    ].filter((weight): weight is number => weight !== undefined);
    const blindabilityWeight =
        partialInitialConfig.blindabilityWeight ??
        (legacyBlindabilityWeights.length > 0
            ? legacyBlindabilityWeights.reduce(
                  (total, weight) => total + weight,
                  0,
              ) / legacyBlindabilityWeights.length
            : DEFAULT_CONFIG.blindabilityWeight);
    const legacyBlindabilityWeightTotal =
        (synergyBlindabilityWeight ?? 0) + (matchupBlindabilityWeight ?? 0);
    const enemySafetyPriority =
        partialInitialConfig.enemySafetyPriority ??
        (legacyBlindabilityWeightTotal > 0
            ? ((matchupBlindabilityWeight ?? 0) /
                  legacyBlindabilityWeightTotal) *
              100
            : DEFAULT_CONFIG.enemySafetyPriority);

    const [config, setConfig] = createStore<DraftGapConfig>({
        ...DEFAULT_CONFIG,
        ...partialInitialConfig,
        championWinrateInfluence,
        blindabilityWeight,
        enemySafetyPriority,
    });
    createEffect(() => {
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    });

    return [config, setConfig] as const;
}

function createFavouritePicks() {
    const favouriteInitial = localStorage.getItem(FAVOURITE_PICKS_KEY);
    const favouriteInitialParsed = JSON.parse(favouriteInitial || "[]");

    const [favouritePicks, setFavouritePicks] = createSignal<
        Set<FavouritePick>
    >(new Set(favouriteInitialParsed));
    createEffect(() => {
        localStorage.setItem(
            "draftgap-favourite-picks",
            JSON.stringify([...favouritePicks()]),
        );
    });

    return [favouritePicks, setFavouritePicks] as const;
}

function createUserContext() {
    const [config, setConfig] = createConfig();
    const [favouritePicks, setFavouritePicks] = createFavouritePicks();

    function setFavourite(championKey: string, role: Role, value: boolean) {
        const favouritePick: FavouritePick = `${championKey}:${role}`;
        const newFavourites = new Set(favouritePicks());

        if (value) {
            newFavourites.add(favouritePick);
        } else {
            newFavourites.delete(favouritePick);
        }

        setFavouritePicks(newFavourites);
    }

    const isFavourite = (championKey: string, role: Role) => {
        const favouritePick: FavouritePick = `${championKey}:${role}`;

        return favouritePicks().has(favouritePick);
    };

    return {
        config,
        setConfig,
        favouritePicks,
        setFavourite,
        isFavourite,
    };
}

const UserContext =
    createContext<ReturnType<typeof createUserContext>>(undefined);

export function UserProvider(props: { children: JSXElement }) {
    const ctx = createUserContext();

    return (
        <UserContext.Provider value={ctx}>
            {props.children}
        </UserContext.Provider>
    );
}

export function useUser() {
    const useCtx = useContext(UserContext);
    if (!useCtx) throw new Error("No UserContext found");

    return useCtx;
}
