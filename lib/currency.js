export const CURRENCIES = [
  { code: 'INR', symbol: '₹', label: 'INR (₹) - Indian Rupee' },
  { code: 'USD', symbol: '$', label: 'USD ($) - US Dollar' },
  { code: 'EUR', symbol: '€', label: 'EUR (€) - Euro' },
  { code: 'GBP', symbol: '£', label: 'GBP (£) - British Pound' },
  { code: 'AED', symbol: 'AED', label: 'AED (د.إ) - UAE Dirham' },
  { code: 'CAD', symbol: 'CA$', label: 'CAD ($) - Canadian Dollar' },
  { code: 'AUD', symbol: 'A$', label: 'AUD ($) - Australian Dollar' },
  { code: 'SGD', symbol: 'S$', label: 'SGD ($) - Singapore Dollar' },
  { code: 'JPY', symbol: '¥', label: 'JPY (¥) - Japanese Yen' },
  { code: 'CHF', symbol: 'CHF', label: 'CHF (Fr.) - Swiss Franc' },
  { code: 'CNY', symbol: 'CN¥', label: 'CNY (¥) - Chinese Yuan' },
  { code: 'NZD', symbol: 'NZ$', label: 'NZD ($) - New Zealand Dollar' },
  { code: 'SAR', symbol: 'SAR', label: 'SAR (﷼) - Saudi Riyal' },
  { code: 'QAR', symbol: 'QAR', label: 'QAR (﷼) - Qatari Riyal' },
  { code: 'KWD', symbol: 'KWD', label: 'KWD (د.ك) - Kuwaiti Dinar' },
];

export function getCurrencySymbol(code = 'USD') {
  const clean = String(code || 'USD').toUpperCase();
  const found = CURRENCIES.find((c) => c.code === clean);
  return found ? found.symbol : clean;
}

export function isValidCurrency(code) {
  if (!code) return false;
  return CURRENCIES.some((c) => c.code === String(code).toUpperCase());
}

export function formatSalary(amount, currency = 'USD') {
  const symbol = getCurrencySymbol(currency);
  if (amount === null || amount === undefined || amount === '') {
    return `${symbol} Not set`;
  }
  const num = Number(amount);
  if (Number.isNaN(num)) {
    return `${symbol} Not set`;
  }
  const locale = String(currency).toUpperCase() === 'INR' ? 'en-IN' : 'en-US';
  return `${symbol} ${num.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

