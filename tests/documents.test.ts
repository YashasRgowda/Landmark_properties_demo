import { describe, expect, it } from 'vitest';
import {
  DOCUMENTS,
  LEGAL_SET,
  documentsMentioned,
  documentsToSend,
} from '../lib/whatsapp/documents';

describe('spotting a document by name', () => {
  it.each([
    ['send me the e-khata', ['e-khata']],
    ['send me the E Khata', ['e-khata']],
    ['ekhata please', ['e-khata']],
    ['is it khata or e-khata?', ['e-khata']],
    ['what about RERA?', ['rera']],
    ['DC conversion done?', ['dc-conversion']],
    ['share the layout plan', ['layout-plan']],
    ['send price list', ['price-list']],
    ['encumbrance certificate please', ['encumbrance']],
  ])('%s', (text, expected) => {
    expect(documentsMentioned(text)).toEqual(expected);
  });

  it('finds several in one message, in catalogue order', () => {
    expect(documentsMentioned('send khata, RERA and the DC conversion'))
      .toEqual(['dc-conversion', 'e-khata', 'rera']);
  });

  it('reads the buyer’s own script', () => {
    expect(documentsMentioned('ಖಾತಾ ಇದೆಯಾ?')).toEqual(['e-khata']);       // Kannada
    expect(documentsMentioned('ఖాతా ఉందా?')).toEqual(['e-khata']);        // Telugu
    expect(documentsMentioned('खाता है क्या?')).toEqual(['e-khata']);      // Hindi
    expect(documentsMentioned('கதா இருக்கா?')).toEqual(['e-khata']);       // Tamil
    expect(documentsMentioned('ಲೇಔಟ್ ಪ್ಲಾನ್ ಕಳಿಸಿ')).toEqual(['layout-plan']);
  });

  it('treats a bare ask for papers as the legal set', () => {
    for (const ask of [
      'send me the documents',
      'papers kalisi',
      'can I see the approvals?',
      'share soft copy',
      'ದಾಖಲೆ ಕಳಿಸಿ',
      'పత్రాలు పంపండి',
      'दस्तावेज भेजिए',
      'ஆவணங்கள் அனுப்புங்க',
    ]) {
      expect(documentsMentioned(ask), ask).toEqual(LEGAL_SET);
    }
  });

  it('a named document beats the generic set', () => {
    expect(documentsMentioned('send me the RERA document')).toEqual(['rera']);
  });

  it('stays quiet when nothing was asked for', () => {
    for (const text of [
      'what is the price?',
      'how many 30x40 sites are left?',
      'I will come on Sunday',
      'ok thanks',
      '',
      null,
      undefined,
    ]) {
      expect(documentsMentioned(text), String(text)).toEqual([]);
    }
  });

  it('does not fire on a word that merely contains an alias', () => {
    // "rera" inside a longer word, "plan" inside "planning", "ec" inside "expect".
    expect(documentsMentioned('I am not prerational about it')).toEqual([]);
    expect(documentsMentioned('we are planning to buy')).toEqual([]);
    expect(documentsMentioned('I expect a good deal')).toEqual([]);
    expect(documentsMentioned('the price is fine')).toEqual([]);
  });
});

describe('deciding what to attach to this turn', () => {
  it('THE BUG: sends what Meera just promised', () => {
    const files = documentsToSend({
      buyerText: 'is the land clean?',
      replyText: 'Yes sir. I am sending you the E-Khata and the RERA certificate now.',
    });
    expect(files.map((f) => f.id)).toEqual(['e-khata', 'rera']);
  });

  it('sends what the buyer asked for even if she only wrote prose', () => {
    const files = documentsToSend({
      buyerText: 'send me the layout plan',
      replyText: 'Certainly sir, here you go.',
    });
    expect(files.map((f) => f.id)).toEqual(['layout-plan']);
  });

  it('never sends the same document to the same buyer twice', () => {
    const files = documentsToSend({
      buyerText: 'send the khata again',
      alreadySent: ['e-khata'],
    });
    expect(files).toEqual([]);
  });

  it('still sends the ones he has not had yet', () => {
    const files = documentsToSend({
      buyerText: 'send khata and RERA',
      alreadySent: ['e-khata'],
    });
    expect(files.map((f) => f.id)).toEqual(['rera']);
  });

  it('caps a broad request so nobody gets six attachments at once', () => {
    const files = documentsToSend({
      buyerText: 'send price list, layout, khata, rera, dc conversion and encumbrance',
    });
    expect(files).toHaveLength(3);
  });

  it('sends nothing for an ordinary message', () => {
    expect(documentsToSend({ buyerText: 'what is the rate?', replyText: '₹3,500 per sq ft sir.' }))
      .toEqual([]);
  });

  it('every catalogue entry names a real, unique file', () => {
    const files = DOCUMENTS.map((d) => d.file);
    expect(new Set(files).size).toBe(files.length);
    expect(files.every((f) => f.endsWith('.pdf'))).toBe(true);
  });
});

describe('the files themselves', () => {
  it('every catalogue entry has a real PDF on disk', async () => {
    // The bug this prevents: project data offered an encumbrance certificate
    // that no file backed, so Meera promised a document that could not be sent.
    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    for (const doc of DOCUMENTS) {
      expect(existsSync(join(process.cwd(), 'public', 'documents', doc.file)), doc.file).toBe(true);
    }
  });

  it('every document the project offers can actually be sent', async () => {
    const { DEMO_ASHRAYA } = await import('../lib/project-data-values');
    for (const offered of DEMO_ASHRAYA.documents_available) {
      expect(documentsMentioned(offered), offered).not.toEqual([]);
    }
  });
});
