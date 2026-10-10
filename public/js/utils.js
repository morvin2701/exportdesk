/** Domain utilities: currencies, countries, totals, number-to-words. */

export const CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', unit: 'US Dollars', sub: 'Cents' },
  { code: 'EUR', name: 'Euro', symbol: '€', unit: 'Euros', sub: 'Cents' },
  { code: 'GBP', name: 'British Pound', symbol: '£', unit: 'Pounds', sub: 'Pence' },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', unit: 'Dirhams', sub: 'Fils' },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', unit: 'Rupees', sub: 'Paise', indian: true },
  { code: 'SAR', name: 'Saudi Riyal', symbol: 'SAR', unit: 'Riyals', sub: 'Halalas' },
  { code: 'QAR', name: 'Qatari Riyal', symbol: 'QAR', unit: 'Riyals', sub: 'Dirhams' },
  { code: 'OMR', name: 'Omani Rial', symbol: 'OMR', unit: 'Rials', sub: 'Baisa', decimals: 3 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KWD', unit: 'Dinars', sub: 'Fils', decimals: 3 },
  { code: 'BHD', name: 'Bahraini Dinar', symbol: 'BHD', unit: 'Dinars', sub: 'Fils', decimals: 3 },
  { code: 'SGD', name: 'Singapore Dollar', symbol: 'S$', unit: 'Singapore Dollars', sub: 'Cents' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', unit: 'Australian Dollars', sub: 'Cents' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', unit: 'Canadian Dollars', sub: 'Cents' },
  { code: 'CNY', name: 'Chinese Yuan', symbol: '¥', unit: 'Yuan', sub: 'Fen' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '¥', unit: 'Yen', sub: 'Sen', decimals: 0 },
  { code: 'HKD', name: 'Hong Kong Dollar', symbol: 'HK$', unit: 'Hong Kong Dollars', sub: 'Cents' },
  { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM', unit: 'Ringgit', sub: 'Sen' },
  { code: 'THB', name: 'Thai Baht', symbol: '฿', unit: 'Baht', sub: 'Satang' },
  { code: 'ZAR', name: 'South African Rand', symbol: 'R', unit: 'Rand', sub: 'Cents' },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', unit: 'Shillings', sub: 'Cents' },
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', unit: 'Naira', sub: 'Kobo' },
  { code: 'EGP', name: 'Egyptian Pound', symbol: 'E£', unit: 'Pounds', sub: 'Piastres' },
  { code: 'TRY', name: 'Turkish Lira', symbol: '₺', unit: 'Lira', sub: 'Kuruş' },
  { code: 'BDT', name: 'Bangladeshi Taka', symbol: '৳', unit: 'Taka', sub: 'Paisa', indian: true },
  { code: 'LKR', name: 'Sri Lankan Rupee', symbol: 'Rs', unit: 'Rupees', sub: 'Cents' },
  { code: 'PKR', name: 'Pakistani Rupee', symbol: 'Rs', unit: 'Rupees', sub: 'Paisa', indian: true },
  { code: 'NPR', name: 'Nepalese Rupee', symbol: 'Rs', unit: 'Rupees', sub: 'Paisa', indian: true },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'CHF', unit: 'Francs', sub: 'Rappen' },
  { code: 'RUB', name: 'Russian Ruble', symbol: '₽', unit: 'Rubles', sub: 'Kopeks' },
  { code: 'BRL', name: 'Brazilian Real', symbol: 'R$', unit: 'Reais', sub: 'Centavos' },
  { code: 'MXN', name: 'Mexican Peso', symbol: 'MX$', unit: 'Pesos', sub: 'Centavos' },
  { code: 'IDR', name: 'Indonesian Rupiah', symbol: 'Rp', unit: 'Rupiah', sub: 'Sen', decimals: 0 },
  { code: 'VND', name: 'Vietnamese Dong', symbol: '₫', unit: 'Dong', sub: 'Xu', decimals: 0 },
  { code: 'KRW', name: 'South Korean Won', symbol: '₩', unit: 'Won', sub: 'Jeon', decimals: 0 },
  { code: 'NZD', name: 'New Zealand Dollar', symbol: 'NZ$', unit: 'New Zealand Dollars', sub: 'Cents' },
  { code: 'TZS', name: 'Tanzanian Shilling', symbol: 'TSh', unit: 'Shillings', sub: 'Cents' },
  { code: 'UGX', name: 'Ugandan Shilling', symbol: 'USh', unit: 'Shillings', sub: 'Cents', decimals: 0 },
  { code: 'ETB', name: 'Ethiopian Birr', symbol: 'Br', unit: 'Birr', sub: 'Santim' },
  { code: 'GHS', name: 'Ghanaian Cedi', symbol: 'GH₵', unit: 'Cedis', sub: 'Pesewas' },
  { code: 'MAD', name: 'Moroccan Dirham', symbol: 'MAD', unit: 'Dirhams', sub: 'Centimes' },
  { code: 'JOD', name: 'Jordanian Dinar', symbol: 'JOD', unit: 'Dinars', sub: 'Fils', decimals: 3 },
  { code: 'IQD', name: 'Iraqi Dinar', symbol: 'IQD', unit: 'Dinars', sub: 'Fils', decimals: 0 },
];

export function currencyInfo(code) {
  return CURRENCIES.find(c => c.code === String(code || '').toUpperCase()) || { code: String(code || 'USD').toUpperCase(), name: code, symbol: code, unit: code, sub: 'Cents' };
}

export function fmtMoney(n, code = 'USD', { symbol = false } = {}) {
  const info = currencyInfo(code);
  const dec = info.decimals == null ? 2 : info.decimals;
  const num = Number(n) || 0;
  const s = num.toLocaleString(info.indian ? 'en-IN' : 'en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  return symbol ? `${info.symbol} ${s}` : s;
}

export function fmtNum(n, dec = 2) {
  const num = Number(n) || 0;
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dec });
}

export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'];
export const INCOTERM_LABELS = {
  EXW: 'Ex Works', FCA: 'Free Carrier', FAS: 'Free Alongside Ship', FOB: 'Free On Board', CFR: 'Cost and Freight', CIF: 'Cost, Insurance & Freight',
  CPT: 'Carriage Paid To', CIP: 'Carriage & Insurance Paid', DAP: 'Delivered At Place', DPU: 'Delivered at Place Unloaded', DDP: 'Delivered Duty Paid',
};
export const TRANSPORT_MODES = ['Sea', 'Air', 'Road', 'Rail', 'Courier', 'Multimodal'];
export const UNITS = ['PCS', 'KG', 'MT', 'G', 'LBS', 'CTN', 'BOX', 'BAG', 'SET', 'PAIR', 'DOZ', 'ROLL', 'DRUM', 'PALLET', 'LTR', 'ML', 'MTR', 'SQM', 'CBM', 'NOS', 'UNIT', 'LOT'];
export const PACKAGE_KINDS = ['Cartons', 'Boxes', 'Pallets', 'Bags', 'Drums', 'Crates', 'Bundles', 'Rolls', 'Bales', 'Containers', 'Packages'];
export const STATUSES = [
  { value: 'draft', label: 'Draft' }, { value: 'unpaid', label: 'Unpaid' }, { value: 'partial', label: 'Partially paid' },
  { value: 'paid', label: 'Paid' }, { value: 'cancelled', label: 'Cancelled' },
];

export const COUNTRIES = ['Afghanistan','Albania','Algeria','Angola','Argentina','Armenia','Australia','Austria','Azerbaijan','Bahrain','Bangladesh','Belarus','Belgium','Benin','Bhutan','Bolivia','Bosnia and Herzegovina','Botswana','Brazil','Brunei','Bulgaria','Burkina Faso','Cambodia','Cameroon','Canada','Chile','China','Colombia','Congo','Costa Rica','Croatia','Cuba','Cyprus','Czech Republic','Denmark','Djibouti','Dominican Republic','Ecuador','Egypt','El Salvador','Estonia','Ethiopia','Fiji','Finland','France','Gabon','Georgia','Germany','Ghana','Greece','Guatemala','Guinea','Honduras','Hong Kong','Hungary','Iceland','India','Indonesia','Iran','Iraq','Ireland','Israel','Italy','Ivory Coast','Jamaica','Japan','Jordan','Kazakhstan','Kenya','Kuwait','Kyrgyzstan','Laos','Latvia','Lebanon','Libya','Lithuania','Luxembourg','Madagascar','Malawi','Malaysia','Maldives','Mali','Malta','Mauritania','Mauritius','Mexico','Moldova','Mongolia','Morocco','Mozambique','Myanmar','Namibia','Nepal','Netherlands','New Zealand','Nicaragua','Niger','Nigeria','North Macedonia','Norway','Oman','Pakistan','Panama','Papua New Guinea','Paraguay','Peru','Philippines','Poland','Portugal','Qatar','Romania','Russia','Rwanda','Saudi Arabia','Senegal','Serbia','Seychelles','Sierra Leone','Singapore','Slovakia','Slovenia','Somalia','South Africa','South Korea','Spain','Sri Lanka','Sudan','Sweden','Switzerland','Syria','Taiwan','Tajikistan','Tanzania','Thailand','Togo','Tunisia','Turkey','Turkmenistan','Uganda','Ukraine','United Arab Emirates','United Kingdom','United States','Uruguay','Uzbekistan','Venezuela','Vietnam','Yemen','Zambia','Zimbabwe'];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDaysISO(iso, days) {
  const d = new Date((iso || todayISO()) + 'T00:00:00');
  d.setDate(d.getDate() + (Number(days) || 0));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function round2(n, dec = 2) { const f = Math.pow(10, dec); return Math.round((Number(n) || 0) * f) / f; }

/** Compute every total from items + charges. Mutates nothing; returns totals object. */
export function computeTotals(doc) {
  const dec = currencyInfo(doc.currency).decimals ?? 2;
  const items = (doc.items || []).map(it => ({ ...it, amount: round2((Number(it.qty) || 0) * (Number(it.rate) || 0), dec) }));
  const subtotal = round2(items.reduce((s, it) => s + it.amount, 0), dec);
  const ch = doc.charges || {};
  let discount = 0;
  if (ch.discountType === 'percent') discount = round2(subtotal * (Number(ch.discount) || 0) / 100, dec);
  else discount = round2(Number(ch.discount) || 0, dec);
  discount = Math.min(discount, subtotal);
  const freight = round2(Number(ch.freight) || 0, dec);
  const insurance = round2(Number(ch.insurance) || 0, dec);
  const other = round2(Number(ch.other) || 0, dec);
  const taxable = round2(subtotal - discount + freight + insurance + other, dec);
  const taxRate = Number(ch.taxRate) || 0;
  const tax = round2(taxable * taxRate / 100, dec);
  const grandTotal = round2(taxable + tax, dec);
  const totalQty = items.reduce((s, it) => s + (Number(it.qty) || 0), 0);
  const netWeight = items.reduce((s, it) => s + (Number(it.netWt) || 0), 0);
  const grossWeight = items.reduce((s, it) => s + (Number(it.grossWt) || 0), 0);
  return { items, subtotal, discount, freight, insurance, other, taxable, taxRate, tax, grandTotal, totalQty, netWeight, grossWeight };
}

// ---------- Number to words ----------
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function belowThousand(n) {
  let s = '';
  if (n >= 100) { s += ONES[Math.floor(n / 100)] + ' Hundred'; n %= 100; if (n) s += ' '; }
  if (n >= 20) { s += TENS[Math.floor(n / 10)]; if (n % 10) s += '-' + ONES[n % 10]; }
  else if (n > 0) s += ONES[n];
  return s;
}

function intlWords(n) {
  if (n === 0) return 'Zero';
  const scales = ['', ' Thousand', ' Million', ' Billion', ' Trillion'];
  const parts = [];
  let i = 0;
  while (n > 0 && i < scales.length) {
    const chunk = n % 1000;
    if (chunk) parts.unshift(belowThousand(chunk) + scales[i]);
    n = Math.floor(n / 1000); i++;
  }
  return parts.join(' ');
}

function indianWords(n) {
  if (n === 0) return 'Zero';
  const parts = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  if (crore) parts.push((crore >= 100 ? intlWords(crore) : belowThousand(crore)) + ' Crore');
  if (lakh) parts.push(belowThousand(lakh) + ' Lakh');
  if (thousand) parts.push(belowThousand(thousand) + ' Thousand');
  if (n) parts.push(belowThousand(n));
  return parts.join(' ');
}

export function amountInWords(amount, code = 'USD') {
  const info = currencyInfo(code);
  const dec = info.decimals == null ? 2 : info.decimals;
  const num = Math.abs(Number(amount) || 0);
  const whole = Math.floor(num);
  const frac = Math.round((num - whole) * Math.pow(10, dec));
  const words = info.indian ? indianWords(whole) : intlWords(whole);
  let out = `${info.unit} ${words}`;
  if (dec > 0 && frac > 0) out += ` and ${info.indian ? indianWords(frac) : intlWords(frac)} ${info.sub}`;
  return out + ' Only';
}

export function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36); }

export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

export function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) { if (o[keys[i]] == null || typeof o[keys[i]] !== 'object') o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}
