import { describe, expect, it } from 'vitest';
import { checkProjectForm, projectToForm } from '../lib/project-validate';
import { DEMO_ASHRAYA } from '../lib/project-data-values';

const form = () => projectToForm(DEMO_ASHRAYA);
const errorsOf = (over: Record<string, string>) => {
  const r = checkProjectForm({ ...form(), ...over });
  return r.ok ? [] : r.errors;
};

describe('saving the project data', () => {
  it('the current data goes through the form and back unchanged', () => {
    const r = checkProjectForm(form());
    expect(r.ok).toBe(true);
    expect(r.ok && r.data).toEqual(DEMO_ASHRAYA);
    expect(r.warnings).toEqual([]);
  });

  it('THE ACCEPTANCE TEST: a new plot price is saved as typed', () => {
    const r = checkProjectForm({ ...form(), plot_price_0: '₹45 lakh' });
    expect(r.ok && r.data.plots[0].price).toBe('₹45 lakh');
  });

  it('the entry price follows the cheapest plot — it can never contradict the plots', () => {
    const r = checkProjectForm({ ...form(), plot_price_0: '₹45 lakh' });
    expect(r.ok && r.data.entry_price).toBe('₹45 lakh');
  });

  it('...even when the cheapest plot is not the first row', () => {
    const r = checkProjectForm({ ...form(), plot_price_2: '₹39 lakh' });
    expect(r.ok && r.data.entry_price).toBe('₹39 lakh');
  });

  it('warns — but saves — when a price disagrees with size × rate', () => {
    const r = checkProjectForm({ ...form(), plot_price_0: '₹45 lakh' });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/30x40 is ₹45 lakh.*about ₹42\.0 lakh/);
  });
});

describe('what cannot be saved', () => {
  it('a price scoring cannot read — the bug that once qualified every lead', () => {
    expect(errorsOf({ plot_price_0: 'On request' }).join()).toMatch(/price must be written like/);
  });

  it('a price with no rupee sign', () => {
    expect(errorsOf({ plot_price_0: '42 lakh' }).join()).toMatch(/start the price with ₹/);
  });

  it('a nonsense size, sq ft or availability', () => {
    expect(errorsOf({ plot_size_0: 'big' }).join()).toMatch(/size must look like 30x40/);
    expect(errorsOf({ plot_sqft_0: '-5' }).join()).toMatch(/sq ft must be/);
    expect(errorsOf({ plot_available_0: '2.5' }).join()).toMatch(/available must be 0 or more/);
  });

  it('the same size twice', () => {
    expect(errorsOf({ plot_size_1: '30x40' }).join()).toMatch(/30x40 is listed twice/);
  });

  it('no plots at all', () => {
    const blank: Record<string, string> = {};
    for (let i = 0; i < 8; i++) blank[`plot_size_${i}`] = '';
    expect(errorsOf(blank).join()).toMatch(/At least one plot/);
  });

  it('a lowest allowed rate above the rate itself', () => {
    expect(errorsOf({ floor_price_per_sqft: '₹3,900 per sq ft' }).join()).toMatch(/higher than the rate/);
  });

  it('site hours that make no sense', () => {
    expect(errorsOf({ site_open_hour: '18', site_close_hour: '10' }).join()).toMatch(/open before it closes/);
    expect(errorsOf({ site_open_hour: 'ten' }).join()).toMatch(/Site opens at/);
  });

  it('a document the system has no file for — Meera would promise the impossible', () => {
    expect(errorsOf({ documents_available: 'Price list\nOriginal sale deed' }).join())
      .toMatch(/"Original sale deed" is not a document/);
  });

  it('a broken map link or phone number', () => {
    expect(errorsOf({ maps_link: 'maps.google.com/x' }).join()).toMatch(/https:\/\//);
    expect(errorsOf({ sales_head_phone: '12345' }).join()).toMatch(/not a valid Indian number/);
  });

  it('a required field left blank', () => {
    expect(errorsOf({ name: '  ' }).join()).toMatch(/Project name is required/);
  });
});

describe('forgiving what is only a matter of typing', () => {
  it('accepts "30 x 40" and "30×40" as 30x40', () => {
    const r = checkProjectForm({ ...form(), plot_size_0: '30 × 40' });
    expect(r.ok && r.data.plots[0].size).toBe('30x40');
  });

  it('drops an empty plot row rather than complaining', () => {
    const r = checkProjectForm({ ...form(), plot_size_3: '' });
    expect(r.ok && r.data.plots).toHaveLength(3);
  });

  it('adds a new plot size typed into a spare row', () => {
    const r = checkProjectForm({ ...form(), plot_size_4: '40x80', plot_sqft_4: '3200',
      plot_price_4: '₹1.12 crore', plot_available_4: '3' });
    expect(r.ok && r.data.plots.map((p) => p.size)).toContain('40x80');
  });

  it('reads bank lists written with commas or on separate lines', () => {
    const r = checkProjectForm({ ...form(), bank_approvals: 'SBI\nHDFC Bank, Axis' });
    expect(r.ok && r.data.approvals.bank_approvals).toEqual(['SBI', 'HDFC Bank', 'Axis']);
  });
});
