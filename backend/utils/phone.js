// Shared phone-number rule for the whole API.
//
// A phone number is optional everywhere in the app, but whenever one is given
// it must be exactly 10 digits. Common ways of typing it ("98765 43210",
// "98765-43210", "+91 98765 43210", "09876543210") are accepted and stored in
// their normalised 10 digit form so every record looks the same.

const PHONE_MESSAGE = 'Phone number must be exactly 10 digits';

const isBlank = (value) =>
  value === undefined || value === null || String(value).trim() === '';

// Keeps only the digits and drops a leading country code (91) or trunk 0.
const phoneDigits = (value) => {
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
};

// Used as a mongoose setter so "+91 98765 43210" is saved as "9876543210".
// Blank values are passed through untouched so optional fields stay empty.
const normalizePhone = (value) => {
  if (value === undefined || value === null) return value;
  if (String(value).trim() === '') return '';
  return phoneDigits(value);
};

const isValidPhone = (value) => isBlank(value) || /^\d{10}$/.test(phoneDigits(value));

// Returns an error message when the value is invalid, otherwise null. Handy for
// early checks in routes (before anything is written to the database).
const phoneError = (value) => (isValidPhone(value) ? null : PHONE_MESSAGE);

module.exports = {
  PHONE_MESSAGE,
  isBlank,
  phoneDigits,
  normalizePhone,
  isValidPhone,
  phoneError,
};
