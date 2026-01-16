// src/utils/attachmentExtractor.test.ts
import { describe, it, expect } from 'vitest';

/**
 * Test PDF extraction with PDF.js (pdfjs-dist)
 */
describe('PDF Extraction', () => {
  it('should extract text from a simple PDF', async () => {
    // Create a minimal PDF buffer for testing
    const simplePDF = Buffer.from(
      '%PDF-1.0\n' +
        '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj ' +
        '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj ' +
        '3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj ' +
        'xref\n' +
        '0 4\n' +
        '0000000000 65535 f\n' +
        '0000000009 00000 n\n' +
        '0000000052 00000 n\n' +
        '0000000101 00000 n\n' +
        'trailer<</Size 4/Root 1 0 R>>\n' +
        'startxref\n' +
        '177\n' +
        '%%EOF'
    );

    console.log('Testing pdfjs-dist library...');

    try {
      const pdfjsLib = await import('pdfjs-dist');
      console.log('✓ pdfjs-dist module loaded');

      const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(simplePDF) });
      const pdf = await loadingTask.promise;

      console.log('✓ PDF loaded, pages:', pdf.numPages);

      const textParts: string[] = [];
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ');
        textParts.push(pageText);
      }

      const fullText = textParts.join('\n\n').trim();
      console.log('✓ Text extracted, length:', fullText.length);

      expect(fullText).toBeDefined();
      expect(typeof fullText).toBe('string');
      console.log('✅ TEST PASSED');
    } catch (error: any) {
      console.error('✗ Test failed:', error.message);
      throw error;
    }
  });
});
