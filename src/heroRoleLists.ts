/** Общие списки героев по позициям (как в Draft.tsx); один источник правды для драфта и CM-бота. */

function toLowerSet(names: readonly string[]): Set<string> {
  return new Set(names.map((n) => n.toLowerCase()));
}

const CARRY_NAMES: readonly string[] = [
  "Anti-Mage",
  "Juggernaut",
  "Phantom Assassin",
  "Faceless Void",
  "Drow Ranger",
  "Spectre",
  "Terrorblade",
  "Naga Siren",
  "Phantom Lancer",
  "Medusa",
  "Luna",
  "Slark",
  "Sven",
  "Gyrocopter",
  "Chaos Knight",
  "Wraith King",
  "Monkey King",
  "Morphling",
  "Shadow Fiend",
  "Clinkz",
  "Weaver",
  "Ursa",
  "Lifestealer",
  "Bloodseeker",
  "Alchemist",
  "Broodmother",
  "Muerta",
  "Troll Warlord",
  "Abaddon",
  "Nature's Prophet",
  "Dragon Knight",
  "Templar Assassin",
  "Windranger",
  "Tiny",
  "Kez",
  "Marci"
];

const MID_NAMES: readonly string[] = [
  "Invoker",
  "Shadow Fiend",
  "Storm Spirit",
  "Ember Spirit",
  "Monkey King",
  "Riki",
  "Void Spirit",
  "Queen of Pain",
  "Puck",
  "Tinker",
  "Zeus",
  "Leshrac",
  "Lina",
  "Dragon Knight",
  "Kunkka",
  "Pangolier",
  "Batrider",
  "Pudge",
  "Huskar",
  "Razor",
  "Sniper",
  "Outworld Devourer",
  "Outworld Destroyer",
  "Death Prophet",
  "Sand King",
  "Beastmaster",
  "Lone Druid",
  "Arc Warden",
  "Primal Beast",
  "Rubick",
  "Timbersaw",
  "Viper",
  "Necrophos",
  "Meepo",
  "Tiny",
  "Magnus",
  "Keeper of the Light",
  "Earthshaker",
  "Skywrath Mage"
];

const OFFLANE_NAMES: readonly string[] = [
  "Centaur Warrunner",
  "Axe",
  "Mars",
  "Timbersaw",
  "Underlord",
  "Primal Beast",
  "Dawnbreaker",
  "Beastmaster",
  "Brewmaster",
  "Dark Seer",
  "Tidehunter",
  "Sand King",
  "Bristleback",
  "Dragon Knight",
  "Night Stalker",
  "Necrophos",
  "Viper",
  "Venomancer",
  "Legion Commander",
  "Slardar",
  "Razor",
  "Enigma",
  "Omniknight",
  "Visage",
  "Doom",
  "Lycan",
  "Earthshaker",
  "Phoenix",
  "Pangolier",
  "Largo"
];

const SOFT_SUPPORT_NAMES: readonly string[] = [
  "Mirana",
  "Nyx Assassin",
  "Tusk",
  "Ring Master",
  "Earth Spirit",
  "Earthshaker",
  "Tiny",
  "Dark Willow",
  "Phoenix",
  "Clockwerk",
  "Rubick",
  "Snapfire",
  "Hoodwink",
  "Spirit Breaker",
  "Shadow Demon",
  "Bounty Hunter",
  "Marci",
  "Pugna",
  "Skywrath Mage",
  "Techies",
  "Largo"
];

const HARD_SUPPORT_NAMES: readonly string[] = [
  "Crystal Maiden",
  "Lich",
  "Lion",
  "Shadow Shaman",
  "Treant Protector",
  "Disruptor",
  "Jakiro",
  "Dazzle",
  "Warlock",
  "Ogre Magi",
  "Vengeful Spirit",
  "Witch Doctor",
  "Undying",
  "Oracle",
  "Bane",
  "Chen",
  "Enchantress",
  "Io",
  "Silencer",
  "Ancient Apparition",
  "Grimstroke",
  "Snapfire",
  "Elder Titan",
  "Winter Wyvern"
];

export const CARRY_HERO_NAMES = toLowerSet(CARRY_NAMES);
export const MID_HERO_NAMES = toLowerSet(MID_NAMES);
export const OFFLANE_HERO_NAMES = toLowerSet(OFFLANE_NAMES);
export const SOFT_SUPPORT_HERO_NAMES = toLowerSet(SOFT_SUPPORT_NAMES);
export const HARD_SUPPORT_HERO_NAMES = toLowerSet(HARD_SUPPORT_NAMES);

/** Позиции как в мини-профиле / драфте; «все» — без фильтра. */
export type ProfileRoleFilter = "all" | "carry" | "mid" | "offlane" | "softSupport" | "hardSupport";

export function heroMatchesProfileRole(name: string, role: ProfileRoleFilter): boolean {
  if (role === "all") return true;
  const key = name.toLowerCase();
  switch (role) {
    case "carry":
      return CARRY_HERO_NAMES.has(key);
    case "mid":
      return MID_HERO_NAMES.has(key);
    case "offlane":
      return OFFLANE_HERO_NAMES.has(key);
    case "softSupport":
      return SOFT_SUPPORT_HERO_NAMES.has(key);
    case "hardSupport":
      return HARD_SUPPORT_HERO_NAMES.has(key);
    default:
      return true;
  }
}

export function draftRoleHeroSetForSlot(slotIndex: number): Set<string> {
  switch (slotIndex) {
    case 0:
      return CARRY_HERO_NAMES;
    case 1:
      return MID_HERO_NAMES;
    case 2:
      return OFFLANE_HERO_NAMES;
    case 3:
      return SOFT_SUPPORT_HERO_NAMES;
    case 4:
      return HARD_SUPPORT_HERO_NAMES;
    default:
      return new Set();
  }
}

export function isCarryHeroProfile(heroName: string): boolean {
  return CARRY_HERO_NAMES.has(heroName.toLowerCase());
}

export function isMidHeroProfile(heroName: string): boolean {
  return MID_HERO_NAMES.has(heroName.toLowerCase());
}

export function isOfflaneHeroProfile(heroName: string): boolean {
  return OFFLANE_HERO_NAMES.has(heroName.toLowerCase());
}

export function isSoftSupportHeroProfile(heroName: string): boolean {
  return SOFT_SUPPORT_HERO_NAMES.has(heroName.toLowerCase());
}

export function isHardSupportHeroProfile(heroName: string): boolean {
  return HARD_SUPPORT_HERO_NAMES.has(heroName.toLowerCase());
}
