import 'server-only';
import { eq } from 'drizzle-orm';
import { db } from '@/lib/db';
import { projectData } from '@/lib/db/schema';

/**
 * Everything Meera is allowed to say. She answers from this and nothing else —
 * no invented price, date, discount or approval.
 *
 * Editable at /admin/project (Phase 7), which is why it lives in a table rather
 * than in code.
 */

export type Plot = {
  size: string;
  sqft: number;
  price: string;
  available: number;
  facing?: string;
};

export type ProjectInfo = {
  name: string;
  developer: string;
  location: string;
  landmark: string;
  total_area: string;
  survey_number: string;
  approvals: {
    dc_conversion: string;
    e_khata: string;
    rera: string;
    bank_approvals: string[];
  };
  plots: Plot[];
  price_per_sqft: string;
  entry_price: string;
  booking_amount: string;
  amenities: string[];
  possession: string;
  registration: string;
  site_timings: string;
  site_address: string;
  maps_link: string;
  pickup: string;
  approved_offers: {
    description: string;
    floor_price_per_sqft: string;
  };
  sales_head: { name: string; phone: string };
  documents_available: string[];
  /** Things Meera must never do, kept with the data she reads. */
  never: string[];
};

/**
 * PLACEHOLDER DATA — invented for the demo so Meera has something consistent to
 * say. Every figure here must be replaced with Landmark's real Ashraya details
 * before a single real buyer sees it.
 */
export const DEMO_ASHRAYA: ProjectInfo = {
  name: 'Ashraya',
  developer: 'Landmark Properties',
  location: 'Yelahanka, North Bangalore',
  landmark: '15 minutes from Yelahanka New Town, 25 minutes from Kempegowda International Airport',
  total_area: '12 acres',
  survey_number: 'Survey No. 148/2, 149/1, Rajanukunte Hobli, Yelahanka Taluk',
  approvals: {
    dc_conversion: 'Done — DC conversion order No. ALN(D):SR/142/2023-24, dated 11 August 2024',
    e_khata: 'Done — E-Khata issued for all plots by Rajanukunte Gram Panchayat',
    rera: 'Registered — PRM/KA/RERA/1251/446/PR/240915/007213',
    bank_approvals: ['SBI', 'HDFC Bank', 'LIC Housing Finance', 'Canara Bank'],
  },
  plots: [
    { size: '30x40', sqft: 1200, price: '₹42 lakh', available: 14, facing: 'East and North' },
    { size: '30x50', sqft: 1500, price: '₹52.5 lakh', available: 9, facing: 'East' },
    { size: '40x60', sqft: 2400, price: '₹84 lakh', available: 6, facing: 'North and West' },
    { size: '50x80', sqft: 4000, price: '₹1.4 crore', available: 2, facing: 'East' },
  ],
  price_per_sqft: '₹3,500 per sq ft',
  entry_price: '₹42 lakh',
  booking_amount: '₹2 lakh, adjustable against the sale price and refundable within 15 days',
  amenities: [
    '40-foot and 30-foot tar roads',
    'Underground drainage and water lines',
    'Underground electricity with street lights',
    'Compound wall with a 24-hour security gate',
    'Children’s park and landscaped garden',
    'Rainwater harvesting',
    'Avenue plantation on all roads',
  ],
  possession: 'Plots are ready. Registration begins immediately on booking.',
  registration: 'Immediate — the plot is registered in the buyer’s name at the sub-registrar office, Yelahanka',
  site_timings: '10 AM to 6 PM, all seven days',
  site_address: 'Ashraya, Survey No. 148/2, Rajanukunte, Yelahanka, Bangalore 560064',
  maps_link: 'https://maps.google.com/?q=Rajanukunte+Yelahanka+Bangalore',
  pickup: 'Free pickup and drop from Yelahanka for site visits',
  approved_offers: {
    description:
      'Up to ₹100 per sq ft may be discussed for a full down payment within 15 days. Nothing beyond this.',
    floor_price_per_sqft: '₹3,400 per sq ft',
  },
  sales_head: { name: 'Ravi Kumar', phone: '+91 98450 00000' },
  documents_available: [
    'Price list',
    'DC conversion order',
    'E-Khata certificate',
    'RERA certificate',
    'Layout plan with plot numbers',
    'Encumbrance certificate',
  ],
  never: [
    'Never quote a price, size or availability that is not listed above.',
    'Never calculate EMI, interest or loan eligibility — hand that to the sales head.',
    'Never offer a discount below the floor price.',
    'Never promise a registration or possession date that is not stated above.',
  ],
};

/** Read the live project data, seeding the demo values on first use. */
export async function getProjectData(): Promise<ProjectInfo> {
  const [row] = await db.select().from(projectData).where(eq(projectData.id, 1)).limit(1);
  if (row?.data) return row.data as ProjectInfo;

  await db
    .insert(projectData)
    .values({ id: 1, data: DEMO_ASHRAYA })
    .onConflictDoNothing({ target: projectData.id });

  return DEMO_ASHRAYA;
}

export async function saveProjectData(data: ProjectInfo): Promise<void> {
  await db
    .insert(projectData)
    .values({ id: 1, data, updatedAt: new Date() })
    .onConflictDoUpdate({ target: projectData.id, set: { data, updatedAt: new Date() } });
}
