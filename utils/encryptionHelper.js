import crypto from 'crypto';

export const encryptCardDetails = (key, text) => {
  const cipher = crypto.createCipheriv('des-ede3', key, '');
  let encrypted = cipher.update(text, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  return encrypted;
}