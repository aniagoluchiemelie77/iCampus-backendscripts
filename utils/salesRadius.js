import { calculateHaversineDistance } from "./distanceCalHelper.js";

// Sellers pick a "maximum distance" for each listing (like a dating app's
// match distance). The radius is measured from `salesOrigin`, the seller's
// location when they saved the listing. `salesOrigin` is private: strip it
// from anything sent to other users (see publicProduct).

export const SALES_RADIUS_MIN_KM = 1;
export const SALES_RADIUS_MAX_KM = 500;

/** A valid radius in km, or null for "anywhere". */
export const parseSalesRadius = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const km = Number(value);
  if (!Number.isFinite(km) || km <= 0) return null;
  return Math.min(Math.max(Math.round(km), SALES_RADIUS_MIN_KM), SALES_RADIUS_MAX_KM);
};

/** {lat, lng} rounded to ~100 m, or null if the input is not a coordinate. */
export const parseGeoPoint = (value) => {
  if (!value || typeof value !== "object") return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: Number(lat.toFixed(3)), lng: Number(lng.toFixed(3)) };
};

/** True when the product limits how far it can be sold. */
export const hasSalesRadius = (product) =>
  parseSalesRadius(product?.physicalDetails?.salesRadiusKm) != null &&
  !!parseGeoPoint(product?.salesOrigin);

/** Distance in km from the seller to the buyer, or null if unknown. */
export const distanceToBuyerKm = (product, buyerPoint) => {
  const origin = parseGeoPoint(product?.salesOrigin);
  if (!origin || !buyerPoint) return null;
  return calculateHaversineDistance(
    origin.lat,
    origin.lng,
    buyerPoint.lat,
    buyerPoint.lng,
    "km",
  );
};

/**
 * Whether a buyer at `buyerPoint` may see/buy the product.
 * Unknown buyer location → allowed (the checkout enforces it for delivery).
 */
export const isWithinSalesRadius = (product, buyerPoint) => {
  if (!hasSalesRadius(product) || !buyerPoint) return true;
  const distance = distanceToBuyerKm(product, buyerPoint);
  if (distance == null) return true;
  return distance <= parseSalesRadius(product.physicalDetails.salesRadiusKm);
};

/** Copy of a product that is safe to send to other users. */
export const publicProduct = (product) => {
  if (!product || typeof product !== "object") return product;
  const { salesOrigin, ...rest } = product;
  return rest;
};
