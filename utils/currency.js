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