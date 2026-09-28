/**
 * Checking an edit to the project data before Meera sees it.
 *
 * Pure. Everything Meera tells a buyer comes from this data, and a save takes
 * effect on the very next message — so a typo here is a wrong price quoted to
 * a real buyer within seconds. Errors block the save; warnings save but say
 * what looks off.
 */
import { parseBudgetToRupees } from './scoring';
import { normalisePhone } from './phone';
import { documentsMentioned } from './whatsapp/documents';
import type { Plot, ProjectInfo } from './project-data-values';

export type ProjectForm = Record<string, string>;

export type ProjectCheck =
  | { ok: true; data: ProjectInfo; warnings: string[] }
  | { ok: false; errors: string[]; warnings: string[] };

/** How many plot rows the form offers — the existing ones plus room for more. */
export const PLOT_ROWS = 8;

const lines = (v: string | undefined) =>
  (v ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
const list = (v: string | undefined) =>
  (v ?? '').split(/[\n,]/).map((l) => l.trim()).filter(Boolean);

/** Digits of the first rupee figure: "₹3,500 per sq ft" → 3500. */
function rupees(text: string): number | null {
  const m = /₹\s?([\d][\d,]*(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1].replace(/,/g, '')) : null;
}

export function checkProjectForm(form: ProjectForm): ProjectCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const text = (key: string, label: string, max = 300) => {
    const v = (form[key] ?? '').trim();
    if (!v) errors.push(`${label} is required.`);
    else if (v.length > max) errors.push(`${label} is too long (${v.length} characters, max ${max}).`);
    return v;
  };

  /* ---- plots: a row with no size is an empty row, and is dropped ---- */
  const plots: Plot[] = [];
  for (let i = 0; i < PLOT_ROWS; i++) {
    const rawSize = (form[`plot_size_${i}`] ?? '').trim();
    if (!rawSize) continue;
    const row = `Plot row ${i + 1} (${rawSize})`;

    const size = rawSize.replace(/\s*[x×X*]\s*/, 'x');
    if (!/^\d+x\d+$/.test(size)) errors.push(`${row}: size must look like 30x40.`);

    const sqft = Number((form[`plot_sqft_${i}`] ?? '').replace(/,/g, ''));
    if (!Number.isInteger(sqft) || sqft <= 0) errors.push(`${row}: sq ft must be a whole number above 0.`);

    const price = (form[`plot_price_${i}`] ?? '').trim();
    if (parseBudgetToRupees(price) === null) errors.push(`${row}: price must be written like ₹42 lakh or ₹1.4 crore.`);
    else if (!price.includes('₹')) errors.push(`${row}: start the price with ₹, e.g. ₹42 lakh.`);

    const available = Number((form[`plot_available_${i}`] ?? '').trim());
    if (!Number.isInteger(available) || available < 0) errors.push(`${row}: plots available must be 0 or more.`);

    const facing = (form[`plot_facing_${i}`] ?? '').trim();
    plots.push({ size, sqft, price, available, ...(facing ? { facing } : {}) });
  }
  if (plots.length === 0) errors.push('At least one plot size is required.');

  const sizes = plots.map((p) => p.size);
  const dupe = sizes.find((s, i) => sizes.indexOf(s) !== i);
  if (dupe) errors.push(`Plot size ${dupe} is listed twice.`);

  /* ---- prices ---- */
  const pricePerSqft = text('price_per_sqft', 'Rate per sq ft', 80);
  const rate = rupees(pricePerSqft);
  if (pricePerSqft && rate === null) errors.push('Rate per sq ft must be written like ₹3,500 per sq ft.');

  // The entry price is the cheapest plot — worked out, never typed, so it can
  // never contradict the plots or be something scoring cannot read.
  const priced = plots
    .map((p) => ({ p, r: parseBudgetToRupees(p.price) }))
    .filter((x): x is { p: Plot; r: number } => x.r !== null)
    .sort((a, b) => a.r - b.r);
  const entryPrice = priced[0]?.p.price ?? '';

  // A plot whose price does not match its size at the stated rate: Meera would
  // quote two numbers that disagree. Worth saying, not worth refusing.
  if (rate) {
    for (const { p, r } of priced) {
      const expected = p.sqft * rate;
      if (expected > 0 && Math.abs(r - expected) / expected > 0.02) {
        warnings.push(`${p.size} is ${p.price}, but ${p.sqft} sq ft at ${pricePerSqft} is about ₹${(expected / 1e5).toFixed(1)} lakh. Meera will quote both — check they agree.`);
      }
    }
  }

  const floor = text('floor_price_per_sqft', 'Lowest rate allowed', 80);
  const floorRate = rupees(floor);
  if (floor && floorRate === null) errors.push('Lowest rate allowed must be written like ₹3,400 per sq ft.');
  if (rate && floorRate && floorRate > rate) errors.push('The lowest rate allowed is higher than the rate itself.');

  /* ---- site ---- */
  const open = Number(form.site_open_hour);
  const close = Number(form.site_close_hour);
  if (!Number.isInteger(open) || open < 0 || open > 23) errors.push('Site opens at: an hour from 0 to 23.');
  if (!Number.isInteger(close) || close < 1 || close > 24) errors.push('Site closes at: an hour from 1 to 24.');
  if (Number.isInteger(open) && Number.isInteger(close) && open >= close) errors.push('The site must open before it closes.');

  const mapsLink = text('maps_link', 'Map link', 500);
  if (mapsLink && !/^https:\/\/\S+$/.test(mapsLink)) errors.push('Map link must be a full https:// link.');

  /* ---- sales head ---- */
  const headPhone = text('sales_head_phone', 'Sales head phone', 30);
  if (headPhone && !normalisePhone(headPhone)) errors.push('Sales head phone is not a valid Indian number.');

  /* ---- documents Meera may offer must be ones the system can send ---- */
  const documents = lines(form.documents_available);
  for (const doc of documents) {
    if (documentsMentioned(doc).length === 0) {
      errors.push(`"${doc}" is not a document the system has a file for, so Meera would promise something she cannot send.`);
    }
  }

  const data: ProjectInfo = {
    name: text('name', 'Project name', 80),
    developer: text('developer', 'Developer', 120),
    location: text('location', 'Location', 200),
    landmark: text('landmark', 'Landmark', 300),
    total_area: text('total_area', 'Total area', 80),
    survey_number: text('survey_number', 'Survey number', 200),
    approvals: {
      dc_conversion: text('dc_conversion', 'DC conversion', 300),
      e_khata: text('e_khata', 'E-Khata', 300),
      rera: text('rera', 'RERA', 300),
      bank_approvals: list(form.bank_approvals),
    },
    plots,
    price_per_sqft: pricePerSqft,
    entry_price: entryPrice,
    booking_amount: text('booking_amount', 'Booking amount', 200),
    amenities: lines(form.amenities),
    possession: text('possession', 'Possession', 300),
    registration: text('registration', 'Registration', 300),
    site_timings: text('site_timings', 'Site timings', 120),
    site_open_hour: open,
    site_close_hour: close,
    site_address: text('site_address', 'Site address', 300),
    maps_link: mapsLink,
    pickup: text('pickup', 'Pickup', 200),
    approved_offers: {
      description: text('offer_description', 'Approved offer', 400),
      floor_price_per_sqft: floor,
    },
    sales_head: { name: text('sales_head_name', 'Sales head name', 80), phone: headPhone },
    documents_available: documents,
    never: lines(form.never),
  };

  return errors.length ? { ok: false, errors, warnings } : { ok: true, data, warnings };
}

/** The form's starting values, from the data as it stands. */
export function projectToForm(p: ProjectInfo): ProjectForm {
  const form: ProjectForm = {
    name: p.name, developer: p.developer, location: p.location, landmark: p.landmark,
    total_area: p.total_area, survey_number: p.survey_number,
    dc_conversion: p.approvals.dc_conversion, e_khata: p.approvals.e_khata, rera: p.approvals.rera,
    bank_approvals: p.approvals.bank_approvals.join(', '),
    price_per_sqft: p.price_per_sqft, booking_amount: p.booking_amount,
    amenities: p.amenities.join('\n'), possession: p.possession, registration: p.registration,
    site_timings: p.site_timings, site_open_hour: String(p.site_open_hour ?? 10),
    site_close_hour: String(p.site_close_hour ?? 18), site_address: p.site_address,
    maps_link: p.maps_link, pickup: p.pickup,
    offer_description: p.approved_offers.description,
    floor_price_per_sqft: p.approved_offers.floor_price_per_sqft,
    sales_head_name: p.sales_head.name, sales_head_phone: p.sales_head.phone,
    documents_available: p.documents_available.join('\n'), never: p.never.join('\n'),
  };
  p.plots.forEach((plot, i) => {
    form[`plot_size_${i}`] = plot.size;
    form[`plot_sqft_${i}`] = String(plot.sqft);
    form[`plot_price_${i}`] = plot.price;
    form[`plot_available_${i}`] = String(plot.available);
    form[`plot_facing_${i}`] = plot.facing ?? '';
  });
  return form;
}
