import geoip from "geoip-lite";

// ISO 3166-1 alpha-2 -> capital city. Used as a fallback anchor when
// geoip-lite can only resolve the country, not the city.
const CAPITALS = {
  AD: "Andorra la Vella", AE: "Abu Dhabi", AF: "Kabul", AG: "Saint John's",
  AI: "The Valley", AL: "Tirana", AM: "Yerevan", AO: "Luanda", AR: "Buenos Aires",
  AS: "Pago Pago", AT: "Vienna", AU: "Canberra", AW: "Oranjestad", AX: "Mariehamn",
  AZ: "Baku", BA: "Sarajevo", BB: "Bridgetown", BD: "Dhaka", BE: "Brussels",
  BF: "Ouagadougou", BG: "Sofia", BH: "Manama", BI: "Gitega", BJ: "Porto-Novo",
  BL: "Gustavia", BM: "Hamilton", BN: "Bandar Seri Begawan", BO: "Sucre",
  BQ: "Kralendijk", BR: "Brasília", BS: "Nassau", BT: "Thimphu", BW: "Gaborone",
  BY: "Minsk", BZ: "Belmopan", CA: "Ottawa", CD: "Kinshasa", CF: "Bangui",
  CG: "Brazzaville", CH: "Bern", CI: "Yamoussoukro", CK: "Avarua", CL: "Santiago",
  CM: "Yaoundé", CN: "Beijing", CO: "Bogotá", CR: "San José", CU: "Havana",
  CV: "Praia", CW: "Willemstad", CY: "Nicosia", CZ: "Prague", DE: "Berlin",
  DJ: "Djibouti", DK: "Copenhagen", DM: "Roseau", DO: "Santo Domingo",
  DZ: "Algiers", EC: "Quito", EE: "Tallinn", EG: "Cairo", EH: "Laayoune",
  ER: "Asmara", ES: "Madrid", ET: "Addis Ababa", FI: "Helsinki", FJ: "Suva",
  FK: "Stanley", FM: "Palikir", FO: "Tórshavn", FR: "Paris", GA: "Libreville",
  GB: "London", GD: "St. George's", GE: "Tbilisi", GF: "Cayenne",
  GG: "St Peter Port", GH: "Accra", GI: "Gibraltar", GL: "Nuuk", GM: "Banjul",
  GN: "Conakry", GP: "Basse-Terre", GQ: "Malabo", GR: "Athens",
  GT: "Guatemala City", GU: "Hagåtña", GW: "Bissau", GY: "Georgetown",
  HK: "Hong Kong", HN: "Tegucigalpa", HR: "Zagreb", HT: "Port-au-Prince",
  HU: "Budapest", ID: "Jakarta", IE: "Dublin", IL: "Jerusalem", IM: "Douglas",
  IN: "New Delhi", IQ: "Baghdad", IR: "Tehran", IS: "Reykjavík", IT: "Rome",
  JE: "Saint Helier", JM: "Kingston", JO: "Amman", JP: "Tokyo", KE: "Nairobi",
  KG: "Bishkek", KH: "Phnom Penh", KI: "Tarawa", KM: "Moroni",
  KN: "Basseterre", KP: "Pyongyang", KR: "Seoul", KW: "Kuwait City",
  KY: "George Town", KZ: "Astana", LA: "Vientiane", LB: "Beirut",
  LC: "Castries", LI: "Vaduz", LK: "Sri Jayawardenepura Kotte", LR: "Monrovia",
  LS: "Maseru", LT: "Vilnius", LU: "Luxembourg", LV: "Riga", LY: "Tripoli",
  MA: "Rabat", MC: "Monaco", MD: "Chișinău", ME: "Podgorica", MF: "Marigot",
  MG: "Antananarivo", MH: "Majuro", MK: "Skopje", ML: "Bamako",
  MM: "Naypyidaw", MN: "Ulaanbaatar", MO: "Macau", MP: "Saipan",
  MQ: "Fort-de-France", MR: "Nouakchott", MS: "Brades", MT: "Valletta",
  MU: "Port Louis", MV: "Malé", MW: "Lilongwe", MX: "Mexico City",
  MY: "Kuala Lumpur", MZ: "Maputo", NA: "Windhoek", NC: "Nouméa", NE: "Niamey",
  NF: "Kingston", NG: "Abuja", NI: "Managua", NL: "Amsterdam", NO: "Oslo",
  NP: "Kathmandu", NR: "Yaren", NU: "Alofi", NZ: "Wellington", OM: "Muscat",
  PA: "Panama City", PE: "Lima", PF: "Papeete", PG: "Port Moresby",
  PH: "Manila", PK: "Islamabad", PL: "Warsaw", PM: "Saint-Pierre",
  PR: "San Juan", PS: "Ramallah", PT: "Lisbon", PW: "Ngerulmud",
  PY: "Asunción", QA: "Doha", RE: "Saint-Denis", RO: "Bucharest",
  RS: "Belgrade", RU: "Moscow", RW: "Kigali", SA: "Riyadh", SB: "Honiara",
  SC: "Victoria", SD: "Khartoum", SE: "Stockholm", SG: "Singapore",
  SH: "Jamestown", SI: "Ljubljana", SK: "Bratislava", SL: "Freetown",
  SM: "San Marino", SN: "Dakar", SO: "Mogadishu", SR: "Paramaribo",
  SS: "Juba", ST: "São Tomé", SV: "San Salvador", SX: "Philipsburg",
  SY: "Damascus", SZ: "Mbabane", TC: "Cockburn Town", TD: "N'Djamena",
  TG: "Lomé", TH: "Bangkok", TJ: "Dushanbe", TL: "Dili", TM: "Ashgabat",
  TN: "Tunis", TO: "Nukuʻalofa", TR: "Ankara", TT: "Port of Spain",
  TV: "Funafuti", TW: "Taipei", TZ: "Dodoma", UA: "Kyiv", UG: "Kampala",
  US: "Washington, D.C.", UY: "Montevideo", UZ: "Tashkent", VA: "Vatican City",
  VC: "Kingstown", VE: "Caracas", VG: "Road Town", VI: "Charlotte Amalie",
  VN: "Hanoi", VU: "Port Vila", WF: "Mata-Utu", WS: "Apia", XK: "Pristina",
  YE: "Sana'a", YT: "Mamoudzou", ZA: "Pretoria", ZM: "Lusaka", ZW: "Harare",
};

let countryNames = null;
try {
  countryNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  countryNames = null;
}

const countryNameFor = (code) => {
  if (!code) return null;
  try {
    return countryNames?.of(code) || code;
  } catch {
    return code;
  }
};

export const getClientIp = (req) =>
  String(req?.headers?.["x-forwarded-for"] || req?.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();

/**
 * Resolve an IP into a human-readable location.
 *  - City known:  "Lagos, Nigeria"
 *  - City unknown: "Somewhere close to Abuja, Nigeria"
 *  - Nothing:     "Unknown Location"
 */
export const resolveLocation = (ip) => {
  const geo = ip ? geoip.lookup(ip) : null;
  if (!geo || !geo.country) {
    return { label: "Unknown Location", city: null, country: null, countryCode: null, geo: null };
  }

  const countryCode = geo.country;
  const country = countryNameFor(countryCode);
  const city = geo.city || null;
  const capital = CAPITALS[countryCode];

  let label;
  if (city) label = `${city}, ${country}`;
  else if (capital) label = `Somewhere close to ${capital}, ${country}`;
  else label = `Somewhere in ${country}`;

  return { label, city, country, countryCode, geo };
};

/**
 * True if a stored session location string refers to the given country.
 * Handles both the new format ("..., Nigeria") and the legacy one ("Lagos, NG" / "NG").
 */
export const locationMatchesCountry = (storedLocation, { country, countryCode }) => {
  if (typeof storedLocation !== "string" || !countryCode) return false;
  if (country && storedLocation.includes(country)) return true;
  const trimmed = storedLocation.trim();
  return trimmed === countryCode || trimmed.endsWith(`, ${countryCode}`);
};
