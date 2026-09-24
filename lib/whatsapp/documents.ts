/**
 * Which documents a message is asking for.
 *
 * Pure and testable on purpose. Meera writes the prose; this decides what
 * actually goes out, because a model that can pick files is a model that can
 * send a buyer the wrong khata (golden rule 1).
 *
 * The language prompt keeps "DC conversion", "E-Khata" and "RERA" untranslated
 * in every language, so the English aliases still match a Kannada reply — but
 * the buyer writes freely, so his own scripts are listed too.
 */

export type DocumentId =
  | 'price-list'
  | 'dc-conversion'
  | 'e-khata'
  | 'rera'
  | 'layout-plan'
  | 'encumbrance';

export type DocumentFile = {
  id: DocumentId;
  /** Shown as the WhatsApp filename and in the caption. */
  title: string;
  file: string;
  aliases: string[];
};

/**
 * The catalogue IS the source of truth. Anything not listed here cannot be
 * sent, whatever the project data offers or the model promises.
 */
export const DOCUMENTS: DocumentFile[] = [
  {
    id: 'price-list',
    title: 'Ashraya — Price List',
    file: 'ashraya-price-list.pdf',
    aliases: ['price list', 'pricelist', 'price sheet', 'rate list', 'rate card', 'cost sheet',
      'ಬೆಲೆ ಪಟ್ಟಿ', 'ధరల జాబితా', 'रेट लिस्ट', 'विलै पट्टियल', 'விலைப் பட்டியல்'],
  },
  {
    id: 'dc-conversion',
    title: 'Ashraya — DC Conversion Order',
    file: 'ashraya-dc-conversion.pdf',
    aliases: ['dc conversion', 'dc order', 'conversion order', 'conversion certificate',
      'dc certificate', 'ಡಿಸಿ ಕನ್ವರ್ಷನ್', 'డీసీ కన్వర్షన్'],
  },
  {
    id: 'e-khata',
    title: 'Ashraya — E-Khata Certificate',
    file: 'ashraya-e-khata.pdf',
    aliases: ['e-khata', 'e khata', 'ekhata', 'khata', 'khatha',
      'ಖಾತಾ', 'ಇ-ಖಾತಾ', 'ఖాతా', 'ఇ-ఖాతా', 'खाता', 'கதா'],
  },
  {
    id: 'rera',
    title: 'Ashraya — RERA Certificate',
    file: 'ashraya-rera-certificate.pdf',
    aliases: ['rera', 'ರೇರಾ', 'రెరా', 'रेरा'],
  },
  {
    id: 'layout-plan',
    title: 'Ashraya — Layout Plan',
    file: 'ashraya-layout-plan.pdf',
    aliases: ['layout plan', 'layout', 'master plan', 'site plan', 'plot plan', 'plan copy',
      'ಲೇಔಟ್', 'లేఅవుట్', 'ले-आउट', 'लेआउट'],
  },
  {
    id: 'encumbrance',
    title: 'Ashraya — Encumbrance Certificate',
    file: 'ashraya-encumbrance-certificate.pdf',
    aliases: ['encumbrance', 'ec certificate', 'e c certificate',
      'ಋಣಭಾರ', 'ఈసీ సర్టిఫికెట్'],
  },
];

/** The legal set a bare "send me the documents" means. */
export const LEGAL_SET: DocumentId[] = ['dc-conversion', 'e-khata', 'rera'];

/** Asking for "papers" in any of the five languages. */
const GENERIC_REQUEST = [
  'document', 'documents', 'docs', 'paper', 'papers', 'certificate', 'certificates',
  'approval', 'approvals', 'proof', 'legal papers', 'copies', 'soft copy', 'pdf',
  'ದಾಖಲೆ', 'ದಾಖಲೆಗಳು', 'ಪೇಪರ್', 'ಪತ್ರ',
  'పత్రాలు', 'కాగితాలు', 'డాక్యుమెంట్',
  'दस्तावेज', 'कागजात', 'पेपर',
  'ஆவணங்கள்', 'ஆவணம்',
];

/**
 * Never send more than this in one turn. A buyer who asks a broad question
 * should get the legal set, not six attachments in a row.
 */
export const MAX_PER_TURN = 3;

function normalise(text: string): string {
  return text
    .toLowerCase()
    // Fold the separators people vary: "e-khata", "e khata", "e_khata".
    .replace(/[\u2010-\u2015_]/g, '-')
    .replace(/\s+/g, ' ');
}

/** Latin aliases need a word boundary; Indic scripts have none, so match plainly. */
function mentions(haystack: string, alias: string): boolean {
  if (/^[\x20-\x7e]+$/.test(alias)) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[- ]/g, '[- ]?');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(haystack);
  }
  return haystack.includes(alias);
}

/**
 * Every document named in a piece of text.
 *
 * Used on BOTH sides: what the buyer asked for, and what Meera just promised.
 * If she said it is coming, it goes out — that is the whole point.
 */
export function documentsMentioned(text: string | null | undefined): DocumentId[] {
  if (!text) return [];
  const haystack = normalise(text);

  const found = DOCUMENTS.filter((doc) => doc.aliases.some((a) => mentions(haystack, normalise(a))))
    .map((doc) => doc.id);

  // "Send me the papers" with nothing named means the legal set.
  if (found.length === 0 && GENERIC_REQUEST.some((word) => mentions(haystack, word))) {
    return [...LEGAL_SET];
  }

  return found;
}

/**
 * What to actually attach to this turn.
 *
 * `alreadySent` is the whole point of the signature: a buyer who mentions the
 * khata in four messages gets the certificate once.
 */
export function documentsToSend(args: {
  buyerText?: string | null;
  replyText?: string | null;
  alreadySent?: Iterable<DocumentId | string>;
  limit?: number;
}): DocumentFile[] {
  const sent = new Set(args.alreadySent ?? []);
  const limit = args.limit ?? MAX_PER_TURN;

  const wanted: DocumentId[] = [];
  for (const id of [...documentsMentioned(args.replyText), ...documentsMentioned(args.buyerText)]) {
    if (!wanted.includes(id) && !sent.has(id)) wanted.push(id);
  }

  return wanted
    .slice(0, limit)
    .map((id) => DOCUMENTS.find((d) => d.id === id)!)
    .filter(Boolean);
}

export function documentById(id: string): DocumentFile | undefined {
  return DOCUMENTS.find((d) => d.id === id);
}
