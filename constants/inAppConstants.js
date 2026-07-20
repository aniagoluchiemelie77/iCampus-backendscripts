export const USD_SUBSCRIPTION_PRICES = Object.freeze({
  free: 0,
  pro: 1.11,
  premium: 3.69,
});
export const EXCEPTION_COST_IN_ICASH = 0.5;
export const EXCEPTION_LECTURER_DIVIDEND_IN_ICASH = 0.4;
export const USD_EQUIVALENCE_OF_1_ICASH = 0.74;
export const EXCEPTION_ACCOUNT_LIMITS = Object.freeze({
  free: 1,
  pro: 2,
  premium: 3,
});
export const DELIVERY_FEES = Object.freeze({
  free: {
    home_delivery: 0.08,
    drop_off: 0.05,
  },
  pro: {
    home_delivery: 0.06,
    drop_off: 0.04,
  },
  premium: {
    home_delivery: 0.03,
    drop_off: 0.02,
  },
});
export const TAX_RATE = 0.02;

export const CATEGORY_ROLES = Object.freeze({
  security: ["super_admin"],
  finance: ["super_admin", "finance"],
  social: ["support", "moderator", "super_admin"],
  profile: ["super_admin"],
  subscription: ["super_admin"],
  store: ["super_admin", "finance"],
});
export const CARRY_FORWARD_WEIGHT = 0.3;