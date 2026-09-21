/**
 * Generates the placeholder Ashraya documents.
 *
 *   npm run docs:demo
 *
 * These are SPECIMENS for the demo only. Every page is stamped as such so no
 * one can mistake one for a real approval. Replace them with Landmark's actual
 * documents before any real buyer sees them.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'public', 'documents');

type Line = { text: string; size?: number; bold?: boolean; gap?: number };

/** Minimal single-page PDF writer. Text only — enough for a specimen. */
function buildPdf(title: string, lines: Line[]): Buffer {
  const W = 595; // A4 at 72dpi
  const H = 842;
  const left = 56;
  let y = H - 70;

  const parts: string[] = [];

  // Specimen watermark, drawn first so the text sits over it.
  parts.push('q 0.92 0.92 0.92 rg');
  parts.push(`BT /F2 32 Tf 1 0 0 1 ${left + 4} ${H / 2} Tm (SPECIMEN - DEMO ONLY) Tj ET`);
  parts.push('Q');

  parts.push('q 0 0 0 rg');
  for (const line of lines) {
    const size = line.size ?? 11;
    y -= line.gap ?? size + 7;
    if (y < 70) break;
    const font = line.bold ? '/F2' : '/F1';
    parts.push(`BT ${font} ${size} Tf 1 0 0 1 ${left} ${y} Tm (${escape(line.text)}) Tj ET`);
  }
  parts.push('Q');

  // Footer rule and note.
  parts.push(`q 0.6 0.6 0.6 RG 0.7 w ${left} 58 m ${W - left} 58 l S Q`);
  parts.push(
    `BT /F1 8 Tf 1 0 0 1 ${left} 44 Tm (${escape(
      'Specimen generated for demonstration. Not a legal document and carries no legal effect.',
    )}) Tj ET`,
  );

  const content = parts.join('\n');

  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] ` +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Title (${escape(title)}) /Producer (Landmark System 1 specimen generator) >>`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];

  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf +=
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\n` +
    `startxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}

/** PDF strings use ( ) as delimiters, so those and backslashes must be escaped. */
function escape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

const HEAD = (subtitle: string): Line[] => [
  { text: 'LANDMARK PROPERTIES', size: 17, bold: true },
  { text: 'Yelahanka, Bangalore 560064', size: 9, gap: 14 },
  { text: subtitle, size: 13, bold: true, gap: 34 },
];

const RULE = { text: '_'.repeat(74), size: 9, gap: 18 };

const DOCS: { file: string; title: string; lines: Line[] }[] = [
  {
    file: 'ashraya-price-list.pdf',
    title: 'Ashraya - Price List',
    lines: [
      ...HEAD('ASHRAYA - PLOT PRICE LIST'),
      { text: 'Project: Ashraya, Survey No. 148/2 and 149/1, Rajanukunte Hobli' },
      { text: 'Total extent: 12 acres    Rate: Rs. 3,500 per sq ft' },
      RULE,
      { text: 'Dimension      Area (sq ft)      Price            Available', bold: true },
      RULE,
      { text: '30 x 40        1,200             Rs. 42,00,000    14 plots' },
      { text: '30 x 50        1,500             Rs. 52,50,000    9 plots' },
      { text: '40 x 60        2,400             Rs. 84,00,000    6 plots' },
      { text: '50 x 80        4,000             Rs. 1,40,00,000  2 plots' },
      RULE,
      { text: 'Booking amount: Rs. 2,00,000, adjusted against the sale price.', gap: 24 },
      { text: 'Refundable in full if cancelled within 15 days.' },
      { text: 'Registration begins immediately on booking. Plots are ready.' },
      { text: 'Corner and park-facing plots carry a premium of Rs. 150 per sq ft.' },
      { text: 'Prices valid until 31 December 2026 and subject to availability.', gap: 24 },
      { text: 'Home loans available from SBI, HDFC Bank, LIC Housing Finance and Canara Bank.' },
      { text: 'Sales: Ravi Kumar, +91 98450 00000', gap: 24, bold: true },
    ],
  },
  {
    file: 'ashraya-dc-conversion.pdf',
    title: 'Ashraya - DC Conversion Order',
    lines: [
      ...HEAD('DEPUTY COMMISSIONER - LAND CONVERSION ORDER'),
      { text: 'Order No. ALN(D):SR/142/2023-24' },
      { text: 'Dated: 11 August 2024' },
      RULE,
      { text: 'Subject:', bold: true, gap: 22 },
      { text: 'Conversion of agricultural land to non-agricultural residential use.' },
      { text: 'Applicant: Landmark Properties, Yelahanka, Bangalore.', gap: 22 },
      { text: 'Land particulars:', bold: true, gap: 22 },
      { text: 'Survey Numbers   : 148/2 and 149/1' },
      { text: 'Village          : Rajanukunte' },
      { text: 'Hobli            : Rajanukunte' },
      { text: 'Taluk            : Yelahanka' },
      { text: 'District         : Bangalore Urban' },
      { text: 'Extent           : 12 acres 0 guntas' },
      { text: 'Converted use    : Residential layout', gap: 22 },
      { text: 'Order:', bold: true, gap: 22 },
      { text: 'Permission is granted for the conversion of the land described above from' },
      { text: 'agricultural use to non-agricultural residential use, subject to the conditions' },
      { text: 'laid down under the Karnataka Land Revenue Act, 1964.', gap: 30 },
      { text: 'Deputy Commissioner', bold: true },
      { text: 'Bangalore Urban District' },
    ],
  },
  {
    file: 'ashraya-e-khata.pdf',
    title: 'Ashraya - E-Khata Certificate',
    lines: [
      ...HEAD('E-KHATA CERTIFICATE'),
      { text: 'Rajanukunte Gram Panchayat, Yelahanka Taluk' },
      { text: 'Certificate No. GP/RJK/EK/2024-25/0318      Date: 26 September 2024' },
      RULE,
      { text: 'This is to certify that the khata of the property described below stands' },
      { text: 'registered in the panchayat records in the name of the holder shown.', gap: 22 },
      { text: 'Property particulars:', bold: true, gap: 22 },
      { text: 'Khata Number     : 318/148-2' },
      { text: 'Survey Numbers   : 148/2 and 149/1' },
      { text: 'Layout           : Ashraya' },
      { text: 'Village          : Rajanukunte' },
      { text: 'Taluk            : Yelahanka, Bangalore Urban' },
      { text: 'Extent           : 12 acres, sub-divided into 96 residential plots' },
      { text: 'Classification   : Converted residential (non-agricultural)', gap: 22 },
      { text: 'E-Khata has been issued for all 96 plots. Individual plot khatas are' },
      { text: 'transferred to the buyer at the time of registration.', gap: 30 },
      { text: 'Panchayat Development Officer', bold: true },
      { text: 'Rajanukunte Gram Panchayat' },
    ],
  },
  {
    file: 'ashraya-rera-certificate.pdf',
    title: 'Ashraya - RERA Registration',
    lines: [
      ...HEAD('KARNATAKA REAL ESTATE REGULATORY AUTHORITY'),
      { text: 'Registration of Project' },
      RULE,
      { text: 'Registration No.  : PRM/KA/RERA/1251/446/PR/240915/007213', bold: true },
      { text: 'Project Name      : Ashraya' },
      { text: 'Promoter          : Landmark Properties' },
      { text: 'Project Type      : Plotted development' },
      { text: 'Location          : Rajanukunte, Yelahanka, Bangalore Urban' },
      { text: 'Extent            : 12 acres, 96 plots' },
      { text: 'Registered on     : 15 September 2024' },
      { text: 'Valid until       : 14 September 2029', gap: 26 },
      { text: 'The promoter shall comply with the provisions of the Real Estate' },
      { text: '(Regulation and Development) Act, 2016 and the rules made thereunder.', gap: 30 },
      { text: 'Secretary', bold: true },
      { text: 'Karnataka Real Estate Regulatory Authority' },
    ],
  },
  {
    file: 'ashraya-layout-plan.pdf',
    title: 'Ashraya - Layout Plan',
    lines: [
      ...HEAD('APPROVED LAYOUT PLAN - PLOT SCHEDULE'),
      { text: 'Ashraya, Survey No. 148/2 and 149/1, Rajanukunte, Yelahanka' },
      RULE,
      { text: 'Block   Plot Nos.        Dimension     Facing        Status', bold: true },
      RULE,
      { text: 'A       A1 - A24         30 x 40       East          14 available' },
      { text: 'B       B1 - B18         30 x 50       East          9 available' },
      { text: 'C       C1 - C16         40 x 60       North / West  6 available' },
      { text: 'D       D1 - D08         50 x 80       East          2 available' },
      { text: 'E       E1 - E30         30 x 40       North         Sold' },
      RULE,
      { text: 'Infrastructure:', bold: true, gap: 24 },
      { text: '- 40 ft main roads and 30 ft internal roads, tar finished' },
      { text: '- Underground drainage and water supply lines' },
      { text: '- Underground electricity with street lighting' },
      { text: '- Compound wall with a 24-hour security gate' },
      { text: "- Children's park and landscaped garden (0.8 acres)" },
      { text: '- Rainwater harvesting and avenue plantation', gap: 26 },
      { text: 'Site visits: 10 AM to 6 PM, all seven days.' },
      { text: 'Free pickup and drop from Yelahanka.' },
    ],
  },
];

mkdirSync(OUT, { recursive: true });
for (const doc of DOCS) {
  writeFileSync(join(OUT, doc.file), buildPdf(doc.title, doc.lines));
  console.log(`  ✓ public/documents/${doc.file}`);
}
console.log(`\n${DOCS.length} specimen documents written.`);
