// src/utils/visionExtractor.ts
//
// AI Vision-based text extraction for images and scanned PDFs

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pdf } from 'pdf-to-img';

/**
 * Result from vision extraction
 */
export interface VisionExtractionResult {
  text: string;
  success: boolean;
  error?: string;
}

/**
 * Supported image MIME types for vision extraction
 */
export const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/**
 * Check if a MIME type is supported for vision extraction
 */
export function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.includes(mimeType.toLowerCase());
}

/**
 * Lazy-load OpenAI client
 */
function getOpenAIClient(): OpenAI {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
}

/**
 * Lazy-load Anthropic client
 */
function getAnthropicClient(): Anthropic {
  return new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });
}

/**
 * Vision extraction prompt
 */
const VISION_PROMPT = `Extract all readable text from this document image.
Return ONLY the text content, preserving paragraph structure.
If the image contains no readable text, respond with: [No text content]
If the image is not a document (e.g., a photo), respond with: [Non-document image]`;

/**
 * Extract text from an image using OpenAI GPT-4o vision
 */
async function extractWithOpenAI(
  base64Data: string,
  mimeType: string
): Promise<VisionExtractionResult> {
  try {
    const openai = getOpenAIClient();

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: VISION_PROMPT },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Data}`,
              },
            },
          ],
        },
      ],
      max_tokens: 4000,
    });

    const text = response.choices[0]?.message?.content?.trim() || '';

    if (!text) {
      return { text: '', success: false, error: 'Empty response from OpenAI' };
    }

    // Check for "no content" responses
    if (text === '[No text content]' || text === '[Non-document image]') {
      return { text, success: true };
    }

    return { text, success: true };
  } catch (error: any) {
    console.error('OpenAI vision extraction failed:', error.message);
    return { text: '', success: false, error: error.message };
  }
}

/**
 * Extract text from an image using Anthropic Claude vision
 */
async function extractWithAnthropic(
  base64Data: string,
  mimeType: string
): Promise<VisionExtractionResult> {
  try {
    const anthropic = getAnthropicClient();

    // Anthropic requires specific media types
    const mediaType = mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Data,
              },
            },
            { type: 'text', text: VISION_PROMPT },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      return { text: '', success: false, error: 'Unexpected response type from Anthropic' };
    }

    const text = content.text.trim();

    if (!text) {
      return { text: '', success: false, error: 'Empty response from Anthropic' };
    }

    return { text, success: true };
  } catch (error: any) {
    console.error('Anthropic vision extraction failed:', error.message);
    return { text: '', success: false, error: error.message };
  }
}

/**
 * Convert PDF pages to PNG images using pdf-to-img
 * Returns an array of base64-encoded PNG images
 */
async function convertPdfToImages(buffer: Buffer, maxPages: number = 6): Promise<string[]> {
  const images: string[] = [];
  let pageNum = 0;

  console.log(`📄 Converting PDF pages to images (max ${maxPages})...`);

  // pdf-to-img returns an async generator of page images
  for await (const pageImage of await pdf(buffer, { scale: 2.0 })) {
    pageNum++;
    if (pageNum > maxPages) {
      console.log(`  ⚠️ Reached max pages limit (${maxPages})`);
      break;
    }

    // pageImage is a Buffer containing PNG data
    const base64 = pageImage.toString('base64');
    images.push(base64);
    console.log(`  ✓ Page ${pageNum} converted`);
  }

  return images;
}

/**
 * Extract text from a PDF by converting pages to images and using OpenAI vision
 */
async function extractTextFromPdfWithVision(
  buffer: Buffer,
  filename: string
): Promise<VisionExtractionResult> {
  try {
    // Convert PDF pages to images
    const pageImages = await convertPdfToImages(buffer);

    if (pageImages.length === 0) {
      return { text: '', success: false, error: 'Failed to convert PDF to images' };
    }

    // Extract text from each page using OpenAI
    const pageTexts: string[] = [];

    for (let i = 0; i < pageImages.length; i++) {
      console.log(`🔍 OCR page ${i + 1}/${pageImages.length}...`);

      const result = await extractWithOpenAI(pageImages[i], 'image/png');

      if (result.success && result.text) {
        // Skip "no content" markers
        if (result.text !== '[No text content]' && result.text !== '[Non-document image]') {
          pageTexts.push(`--- Page ${i + 1} ---\n${result.text}`);
        }
      } else if (result.error) {
        console.log(`  ⚠️ Page ${i + 1} extraction failed: ${result.error}`);
      }
    }

    if (pageTexts.length === 0) {
      return { text: '[No readable text detected in PDF]', success: true };
    }

    const combinedText = pageTexts.join('\n\n');
    console.log(`✅ PDF OCR complete: ${pageTexts.length} pages, ${combinedText.length} characters`);

    return { text: combinedText, success: true };
  } catch (error: any) {
    console.error('PDF to image conversion failed:', error.message);
    return { text: '', success: false, error: `PDF conversion failed: ${error.message}` };
  }
}

/**
 * Extract text from an image buffer using AI Vision
 * Tries OpenAI first, falls back to Anthropic if it fails
 * For PDFs, converts pages to images first
 *
 * @param buffer - Image data as Buffer
 * @param mimeType - MIME type of the image
 * @param filename - Original filename (for logging)
 * @returns Extraction result with text and success status
 */
export async function extractTextWithVision(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<VisionExtractionResult> {
  console.log(`🔍 Extracting text with AI Vision: ${filename} (${mimeType})`);

  // Handle PDFs by converting to images first
  if (mimeType === 'application/pdf') {
    if (!process.env.OPENAI_API_KEY) {
      // Fall back to Anthropic which supports PDFs natively
      if (process.env.ANTHROPIC_API_KEY) {
        const base64Data = buffer.toString('base64');
        return extractWithAnthropic(base64Data, mimeType);
      }
      return { text: '', success: false, error: 'No API key configured for PDF extraction' };
    }
    return extractTextFromPdfWithVision(buffer, filename);
  }

  // For images, use direct API calls
  const base64Data = buffer.toString('base64');

  // Try OpenAI first
  if (process.env.OPENAI_API_KEY) {
    const result = await extractWithOpenAI(base64Data, mimeType);
    if (result.success) {
      console.log(`✅ OpenAI vision extraction successful: ${filename}`);
      return result;
    }
    console.log(`⚠️ OpenAI vision failed, trying Anthropic fallback: ${filename}`);
  }

  // Fallback to Anthropic
  if (process.env.ANTHROPIC_API_KEY) {
    const result = await extractWithAnthropic(base64Data, mimeType);
    if (result.success) {
      console.log(`✅ Anthropic vision extraction successful: ${filename}`);
      return result;
    }
    return result;
  }

  return {
    text: '',
    success: false,
    error: 'No AI API keys configured for vision extraction',
  };
}
