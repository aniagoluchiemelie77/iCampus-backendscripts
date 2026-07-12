import { DELIVERY_FEES } from '../constants/inAppConstants.js'; 

export const calculateDistribution = (itemTotal, deliveryMethod, tier) => {
  const rate = DELIVERY_FEES[tier]?.[deliveryMethod] || 0;
  const totalFee = itemTotal * rate;

  let sellerCut = 0;
  let agentCut = 0;

  if (deliveryMethod === 'drop_off') {
    sellerCut = totalFee * 0.5;
    agentCut = totalFee * 0.5;
  } else if (deliveryMethod === 'home_delivery') {
    sellerCut = totalFee * 0.7;
    agentCut = 0; 
  }

  return { totalFee, sellerCut, agentCut };
};