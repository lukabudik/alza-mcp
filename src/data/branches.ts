/**
 * Seed list of major Alza brick-and-mortar locations (AlzaShop / Showroom).
 * This is intentionally a small curated set — the AlzaBox locker network
 * (see pickup.ts) covers nearly every postal code and is fetched live.
 *
 * To add or correct an entry: open a PR. Coordinates can be checked against
 * https://www.alza.cz/showroomy.htm
 */

export interface BranchSeed {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: "CZ" | "SK" | "HU" | "AT" | "DE" | "GB";
  latitude: number;
  longitude: number;
  openingHours?: string;
  note?: string;
}

export const BRANCHES: BranchSeed[] = [
  // Czech Republic — flagship + major regional showrooms
  {
    id: "cz-praha-holesovice",
    name: "AlzaCentrum Praha-Holešovice",
    address: "Jankovcova 1522/53",
    city: "Praha 7",
    postalCode: "170 00",
    country: "CZ",
    latitude: 50.1058,
    longitude: 14.4356,
    openingHours: "Mon–Fri 08:00–21:00, Sat–Sun 09:00–21:00",
    note: "Flagship showroom, full assortment, AlzaBox onsite",
  },
  {
    id: "cz-praha-stodulky",
    name: "AlzaShop Praha-Stodůlky",
    address: "Kovářova 1612/37",
    city: "Praha 5",
    postalCode: "155 00",
    country: "CZ",
    latitude: 50.0426,
    longitude: 14.3253,
  },
  {
    id: "cz-brno",
    name: "AlzaShop Brno",
    address: "Vídeňská 100",
    city: "Brno",
    postalCode: "619 00",
    country: "CZ",
    latitude: 49.1681,
    longitude: 16.5917,
  },
  {
    id: "cz-ostrava",
    name: "AlzaShop Ostrava",
    address: "28. října 3346/91",
    city: "Ostrava",
    postalCode: "702 00",
    country: "CZ",
    latitude: 49.8348,
    longitude: 18.2823,
  },
  {
    id: "cz-plzen",
    name: "AlzaShop Plzeň",
    address: "Borská 67",
    city: "Plzeň",
    postalCode: "301 00",
    country: "CZ",
    latitude: 49.7269,
    longitude: 13.3702,
  },
  {
    id: "cz-hradec-kralove",
    name: "AlzaShop Hradec Králové",
    address: "Brněnská 1825",
    city: "Hradec Králové",
    postalCode: "500 06",
    country: "CZ",
    latitude: 50.193,
    longitude: 15.831,
  },
  {
    id: "cz-liberec",
    name: "AlzaShop Liberec",
    address: "České mládeže 456",
    city: "Liberec",
    postalCode: "460 08",
    country: "CZ",
    latitude: 50.7538,
    longitude: 15.0698,
  },
  {
    id: "cz-olomouc",
    name: "AlzaShop Olomouc",
    address: "Pražská 255/41",
    city: "Olomouc",
    postalCode: "779 00",
    country: "CZ",
    latitude: 49.5938,
    longitude: 17.2509,
  },
  {
    id: "cz-ceske-budejovice",
    name: "AlzaShop České Budějovice",
    address: "České Vrbné 2360",
    city: "České Budějovice",
    postalCode: "370 11",
    country: "CZ",
    latitude: 49.0036,
    longitude: 14.4257,
  },

  // Slovakia
  {
    id: "sk-bratislava",
    name: "AlzaShop Bratislava",
    address: "Bojnická 18",
    city: "Bratislava",
    postalCode: "831 04",
    country: "SK",
    latitude: 48.1762,
    longitude: 17.1484,
  },
  {
    id: "sk-kosice",
    name: "AlzaShop Košice",
    address: "Pri prachárni 4",
    city: "Košice",
    postalCode: "040 11",
    country: "SK",
    latitude: 48.7164,
    longitude: 21.2611,
  },

  // Hungary
  {
    id: "hu-budapest",
    name: "AlzaShop Budapest",
    address: "Váci út 22",
    city: "Budapest",
    postalCode: "1132",
    country: "HU",
    latitude: 47.5097,
    longitude: 19.0612,
  },
];
