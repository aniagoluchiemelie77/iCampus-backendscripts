import axios from 'axios';
import dotenv from "dotenv";
dotenv.config();

let rateCache = { rates: null, timestamp: 0 };
const CACHE_DURATION = 1000 * 60 * 60;

export const fetchExchangeRates = async () => {
  const now = Date.now();
  if (rateCache.rates && (now - rateCache.timestamp < CACHE_DURATION)) {
    return rateCache.rates;
  }

  try {
    const apiKey = process.env.EXCHANGERATE_API_KEY;
    const response = await axios.get(`https://v6.exchangerate-api.com/v6/${apiKey}/latest/USD`);
    rateCache.rates = response.data.conversion_rates;
    rateCache.timestamp = now;
    return rateCache.rates;
  } catch (error) {
    console.error("Failed to fetch exchange rates on backend:", error.message);
    throw new Error("Unable to fetch live exchange rates for verification.");
  }
};

export async function convertAmount(amount, fromCurrency, toCurrency) {
  if (fromCurrency === toCurrency) return Number(amount);
  
  const rates = await fetchExchangeRates();
  
  const rateFrom = rates[fromCurrency];
  const rateTo = rates[toCurrency];

  if (!rateFrom || !rateTo) {
    throw new Error(`Unsupported currency conversion: ${fromCurrency} -> ${toCurrency}`);
  }
  const amountInUSD = amount / rateFrom;
  const convertedAmount = amountInUSD * rateTo;
  return Number(convertedAmount.toFixed(2));
}

// Mirrors currencyMap in the app (src/utils/UserTransactionsHelpers.ts).
export const CURRENCY_BY_COUNTRY = Object.freeze({
  Nigeria: "NGN",
  Ghana: "GHS",
  Kenya: "KES",
  Uganda: "UGX",
  Rwanda: "RWF",
  Tanzania: "TZS",
  Cameroon: "XAF",
  Egypt: "EGP",
  Ethiopia: "ETB",
  "South Africa": "ZAR",
  USA: "USD",
  "United States of America": "USD",
  "United Kingdom": "GBP",
  Canada: "CAD",
  Brazil: "BRL",
  Mexico: "MXN",
  Argentina: "ARS",
  Russia: "RUB",
  "South Korea": "KRW",
  Indonesia: "IDR",
  Turkey: "TRY",
  "Saudi Arabia": "SAR",
  Switzerland: "CHF",
  Sweden: "SEK",
  Norway: "NOK",
  Poland: "PLN",
  Singapore: "SGD",
  Malaysia: "MYR",
  Thailand: "THB",
  Philippines: "PHP",
  "New Zealand": "NZD",
  Pakistan: "PKR",
  Bangladesh: "BDT",
  Vietnam: "VND",
  Netherlands: "EUR",
  Spain: "EUR",
  Italy: "EUR",
});

// Currencies Flutterwave's hosted checkout can charge in.
const FLUTTERWAVE_CHARGE_CURRENCIES = new Set([
  "NGN", "GHS", "KES", "UGX", "RWF", "TZS", "XAF", "XOF", "ZAR", "ZMW",
  "MWK", "EGP", "ETB", "USD", "GBP", "EUR", "CAD",
]);

export const currencyForCountry = (country) =>
  CURRENCY_BY_COUNTRY[String(country || "").trim()] || "NGN";

/** The user's currency when Flutterwave can charge it, otherwise USD. */
export const chargeCurrencyForCountry = (country) => {
  const local = currencyForCountry(country);
  return FLUTTERWAVE_CHARGE_CURRENCIES.has(local) ? local : "USD";
};
