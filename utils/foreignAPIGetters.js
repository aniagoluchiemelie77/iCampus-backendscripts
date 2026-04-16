import axios from 'axios';
const API_KEY = process.env.EXCHANGERATE_API_KEY;
const EXCHANGERATE_API_BASE_URL = `https://v6.exchangerate-api.com/v6/${API_KEY}/latest/USD`;

let cachedRates = null;
let lastFetchTime = 0;
const CACHE_DURATION = 60 * 60 * 1000;

export const fetchLiveRateBackend = async (country) => {
  const currencyMap = {
  Nigeria: { code: 'NGN' },
  Ghana: { code: 'GHS' },
  Kenya: { code: 'KES' },
  'South Africa': { code: 'ZAR'},
  Egypt: { code: 'EGP'},
  Ethiopia: { code: 'ETB'},
  Rwanda: { code: 'RWF'},
  Tanzania: { code: 'TZS'},
  Uganda: { code: 'UGX'},
  Morocco: { code: 'MAD'},
  USA: { code: 'USD'},
  'United Kingdom': { code: 'GBP' },
  Canada: { code: 'CAD'},
  Australia: { code: 'AUD'},
  Germany: { code: 'EUR'}, // Eurozone
  France: { code: 'EUR'},
  China: { code: 'CNY'},
  Japan: { code: 'JPY'},
  India: { code: 'INR'},
  'United Arab Emirates': { code: 'AED'},
};

  const { code } = currencyMap[country] || currencyMap['Nigeria'];

  try {
    const now = Date.now();
    if (!cachedRates || (now - lastFetchTime) > CACHE_DURATION) {
      const response = await axios.get(EXCHANGERATE_API_BASE_URL);
      cachedRates = response.data.conversion_rates;
      lastFetchTime = now;
    }
    return {
      rate: rate || 1550,
      code
    };
  } catch (error) {
    console.error("Rate fetch failed", error);
    return { rate: 1550, symbol, code }; // Default fallback
  }
};