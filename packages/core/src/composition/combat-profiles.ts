import { Role } from "../models/Role";
import { CompositionCapabilityStrength } from "./profiles";

// Tactical potential in a standard build, not measured win-rate effects.
// Keep these separate from CC/frontline: having those tools does not imply
// tank damage, access to a fight, or the ability to survive a dive.
export type CombatProfile = Record<
    | "burstDamage"
    | "followUp"
    | "rangedUptime"
    | "tankDamage"
    | "selfPeel"
    | "siege",
    CompositionCapabilityStrength
>;

const EMPTY_PROFILE: CombatProfile = {
    burstDamage: 0,
    followUp: 0,
    rangedUptime: 0,
    tankDamage: 0,
    selfPeel: 0,
    siege: 0,
};

const profiles: Record<string, Partial<CombatProfile>> = {};
function set(
    trait: keyof CombatProfile,
    strength: CompositionCapabilityStrength,
    ids: string,
) {
    for (const id of ids.split(" ")) {
        (profiles[id] ??= {})[trait] = strength;
    }
}

// Omitted traits get no credit. Values describe dependable kit strengths;
// situational/build-dependent strengths receive partial credit.
set(
    "burstDamage",
    0.5,
    "Aatrox Ambessa Aphelios Ashe AurelionSol Azir Bard Brand Briar Camille Corki Diana Draven Ezreal Gangplank Gnar Gragas Graves Gwen Hecarim Hwei Irelia JarvanIV Jayce Jhin Kaisa Kalista Kayn Kennen Kindred Kled Lillia Lucian Malphite Mel MissFortune MonkeyKing Mordekaiser Nasus Neeko Nocturne Olaf Orianna Pantheon RekSai Renekton Riven Rumble Samira Sett Shyvana Smolder Swain Sylas Taliyah Tristana TwistedFate Twitch Urgot Varus Vex Vi Viego Viktor Vladimir Volibear Warwick Xayah XinZhao Yasuo Yone Zaahen Zeri Ziggs Zyra",
);
set(
    "burstDamage",
    1,
    "Ahri Akali Annie Aurora Ekko Elise Evelynn Fizz Kassadin Katarina Khazix Leblanc Lissandra Lux Naafiri Nidalee Pyke Qiyana Rengar Syndra Talon Veigar Velkoz Xerath Zed Zoe",
);

// Ability to deliver damage on an ally's initiation without another setup.
set(
    "followUp",
    0.5,
    "Anivia Aphelios Ashe AurelionSol Brand Caitlyn Cassiopeia Draven Gangplank Graves Heimerdinger Hwei Illaoi Jhin Jinx Karthus Kayle KogMaw Lucian Lux Malzahar Mel MissFortune Mordekaiser Nasus Olaf Orianna Rumble Ryze Senna Seraphine Sivir Smolder Swain Syndra Taliyah Teemo Trundle Twitch Urgot Varus Vayne Veigar Velkoz Viktor Vladimir Xerath Yorick Yunara Zeri Ziggs Zoe Zyra",
);
set(
    "followUp",
    0.75,
    "Aatrox Ahri Akshan Ambessa Annie Aurora Azir Briar Camille Corki Diana Ekko Elise Evelynn Ezreal Fiddlesticks Fiora Fizz Galio Gnar Gragas Gwen Hecarim Irelia JarvanIV Jax Jayce Kaisa Kalista Kassadin Katarina Kayn Kennen Khazix Kindred Kled Leblanc LeeSin Lillia Lissandra MasterYi MonkeyKing Naafiri Neeko Nidalee Nilah Nocturne Pantheon Qiyana Quinn RekSai Renekton Rengar Riven Samira Shyvana Sylas Talon Tristana Tryndamere Vex Vi Viego Volibear Warwick Xayah XinZhao Yasuo Yone Zaahen Zed",
);

// Range at which meaningful repeated damage can be delivered, independent
// of mobility. Melee tank killers must still get access to their targets.
set(
    "rangedUptime",
    0.5,
    "Ahri Akshan Annie Aurora Azir Brand Cassiopeia Corki Draven Ezreal Graves Heimerdinger Hwei Kaisa Kalista Karthus Kayle Kennen Kindred Lillia Lucian Malzahar Mel Neeko Orianna Quinn Ryze Samira Seraphine Sivir Smolder Swain Syndra Taliyah Teemo TwistedFate Varus Vayne Veigar Velkoz Vex Viktor Vladimir Xayah Zeri Ziggs Zoe Zyra",
);
set(
    "rangedUptime",
    0.75,
    "Anivia Aphelios Ashe AurelionSol Jhin Lux MissFortune Senna Tristana Twitch Yunara",
);
set("rangedUptime", 1, "Caitlyn Jinx KogMaw Xerath");

// Sustained damage alone is not tank killing. These ratings include repeatable
// percent-health/true damage, penetration, or standard sustained carry builds.
set(
    "tankDamage",
    0.25,
    "Aatrox Ahri Akali Akshan Ambessa Anivia Aurora Briar Camille Corki Diana Draven Ekko Elise Ezreal Gangplank Garen Gnar Gragas Hecarim Heimerdinger Hwei Irelia Jayce Jhin Kassadin Katarina Kayn Kennen Kled Leblanc Lillia Lucian Lux Malzahar Mel MissFortune MonkeyKing Nasus Neeko Nocturne Orianna Pantheon Qiyana Renekton Rengar Riven Rumble Sett Shyvana Swain Sylas Syndra Taliyah Talon Teemo TwistedFate Urgot Veigar Vex Vi Viktor Vladimir Volibear Warwick XinZhao Yorick Zaahen Zed Ziggs Zoe Zyra",
);
set(
    "tankDamage",
    0.5,
    "Ashe Caitlyn Darius Graves Olaf Samira Sivir Tristana Tryndamere Viego Xayah Yasuo Yone Yunara Zeri",
);
set(
    "tankDamage",
    0.75,
    "Aphelios AurelionSol Azir Brand Cassiopeia Jax Jinx Kalista Karthus Kayle Kindred Mordekaiser Nilah Ryze Smolder Trundle Twitch Varus Velkoz",
);
set("tankDamage", 1, "Belveth Fiora Gwen Kaisa KogMaw MasterYi Vayne");

// Personal tools for maintaining damage uptime when threatened. Team peel is
// handled separately, and an initiator's CC is never automatically self-peel.
set(
    "selfPeel",
    0.25,
    "Anivia Aphelios Ashe AurelionSol Brand Caitlyn Cassiopeia Gangplank Hwei Illaoi Jhin Kayle Kennen Kindred Kled KogMaw Lux Malzahar Mel MissFortune Nasus Neeko Orianna Rumble Samira Senna Seraphine Sett Smolder Swain Syndra Taliyah Urgot Varus Veigar Velkoz Viktor Vladimir Xayah XinZhao Yorick Yunara Ziggs Zyra",
);
set(
    "selfPeel",
    0.5,
    "Aatrox Akshan Ambessa Annie Aurora Azir Briar Camille Corki Darius Diana Draven Elise Fiora Galio Garen Gnar Gragas Graves Gwen Hecarim Irelia JarvanIV Jax Jayce Kaisa Kalista Katarina Kayn Lillia Lucian MasterYi MonkeyKing Mordekaiser Nilah Nocturne Olaf Pantheon Qiyana RekSai Renekton Rengar Riven Ryze Shyvana Sivir Sylas Talon Trundle Tryndamere Vex Vi Viego Volibear Warwick Yasuo Yone Zaahen Zeri Zed Zoe",
);
set(
    "selfPeel",
    0.75,
    "Ahri Akali Ekko Evelynn Ezreal Fizz Kassadin Khazix Leblanc Lissandra Quinn Tristana Vayne",
);

// Safe pressure into a defended wave; this is deliberately distinct from
// merely being able to clear one's own wave.
set(
    "siege",
    0.25,
    "Ahri Akshan Anivia Annie Aphelios Ashe AurelionSol Brand Cassiopeia Draven Gangplank Graves Kaisa Kalista Karthus Kayle Kindred Lucian Malzahar Mel Neeko Orianna Quinn Ryze Sivir Smolder Swain Syndra Taliyah Teemo Tristana TwistedFate Twitch Varus Vayne Veigar Vex Viktor Xayah Yunara Zeri Zyra",
);
set(
    "siege",
    0.5,
    "Azir Corki Ezreal Heimerdinger Hwei Jhin Jinx KogMaw MissFortune Senna Seraphine Zoe",
);
set("siege", 0.75, "Caitlyn Jayce Lux Nidalee Velkoz");
set("siege", 1, "Xerath Ziggs");

// Additional melee/build-dependent damage patterns and defensive specialists.
set("burstDamage", 0.5, "Belveth Chogath KSante Shaco Udyr");
set("burstDamage", 0.25, "Karma Morgana Nunu Sion");
set("followUp", 0.75, "Belveth KSante Shaco");
set("followUp", 0.5, "Karma Morgana Singed Udyr");
set("rangedUptime", 0.5, "Karma Morgana");
set("tankDamage", 0.5, "Singed Udyr");
set("tankDamage", 0.25, "Chogath DrMundo KSante Shaco");
set("selfPeel", 0.5, "Belveth Karma KSante Morgana Singed Udyr");
set("selfPeel", 0.75, "Shaco Xayah");
set("siege", 0.25, "Karma Morgana");

export function getCombatProfile(championId: string, role: Role) {
    const profile = { ...EMPTY_PROFILE, ...profiles[championId] };
    // Support income cannot fund the same damage plan as a farming role.
    const damageWeight = role === Role.Support ? 0.5 : 1;
    return {
        ...profile,
        burstDamage: profile.burstDamage * damageWeight,
        tankDamage: profile.tankDamage * damageWeight,
        siege: profile.siege * damageWeight,
    };
}

export function getCombatProfileIds() {
    return Object.keys(profiles);
}
