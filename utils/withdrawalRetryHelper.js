// services/paymentService.js
import axios from 'axios';

export const executeTransferWithRetry = async (payload, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      return await axios.post("https://api.flutterwave.com/v3/transfers", payload, {
        headers: { 
          Authorization: `Bearer ${process.env.FLUTTERWAVE_CLIENT_SECRET}`,
          "Content-Type": "application/json"
        },
      });
    } catch (error) {
      const isRetryable = error.response?.status >= 500 || !error.response;
      if (!isRetryable || i === retries - 1) throw error;
      await new Promise(res => setTimeout(res, 2000 * (i + 1))); 
    }
  }
};