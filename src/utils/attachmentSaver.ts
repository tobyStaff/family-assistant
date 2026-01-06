// src/utils/attachmentSaver.ts
import { google } from 'googleapis';
import { PassThrough, Readable } from 'stream';
import type { OAuth2Client } from 'google-auth-library';
import type { AttachmentSaveParams } from '../types/attachment.js';

/**
 * Save a Gmail attachment to Google Drive using streams.
 * Uses PassThrough stream to avoid loading the entire file into memory,
 * preventing OOM crashes on low-spec servers.
 *
 * @param auth - OAuth2 client for the user
 * @param params - Attachment parameters (emailId, attachmentId, fileName)
 * @returns Drive file ID on success, null on error
 */
export async function saveAttachmentToDrive(
  auth: OAuth2Client,
  params: AttachmentSaveParams
): Promise<string | null> {
  const gmail = google.gmail({ version: 'v1', auth });
  const drive = google.drive({ version: 'v3', auth });

  try {
    // Fetch attachment as stream from Gmail
    const attachmentRes = await gmail.users.messages.attachments.get({
      userId: 'me',
      messageId: params.emailId,
      id: params.attachmentId,
      alt: 'media', // Returns binary stream instead of base64
    });

    // Verify we got attachment data
    if (!attachmentRes.data) {
      throw new Error('No attachment data returned from Gmail API');
    }

    // The response data is the stream itself when alt='media'
    const attachmentStream = attachmentRes.data as unknown as Readable;

    // Use PassThrough to create a proper stream pipeline
    // This ensures proper backpressure handling and error propagation
    const passThrough = new PassThrough();

    // Pipe the Gmail stream to PassThrough
    attachmentStream.pipe(passThrough);

    // Handle stream errors
    attachmentStream.on('error', (error) => {
      console.error('Gmail stream error:', error);
      passThrough.destroy(error);
    });

    // Upload to Drive using the stream
    const fileMetadata = {
      name: params.fileName,
    };

    const media = {
      mimeType: 'application/octet-stream', // Generic binary type
      body: passThrough,
    };

    const driveRes = await drive.files.create({
      requestBody: fileMetadata,
      media,
      fields: 'id', // Only return the file ID
    });

    const fileId = driveRes.data.id;

    if (!fileId) {
      throw new Error('Drive API did not return a file ID');
    }

    console.log(`Attachment saved to Drive: ${fileId}`);
    return fileId;
  } catch (error) {
    console.error('Attachment save error:', error);
    return null;
  }
}

/**
 * Get attachment metadata from an email without downloading the content.
 * Useful for listing attachments before saving.
 *
 * @param auth - OAuth2 client for the user
 * @param emailId - Gmail message ID
 * @returns Array of attachment info (id, filename, size)
 */
export async function getEmailAttachments(
  auth: OAuth2Client,
  emailId: string
): Promise<Array<{ id: string; filename: string; size: number }>> {
  const gmail = google.gmail({ version: 'v1', auth });

  try {
    const message = await gmail.users.messages.get({
      userId: 'me',
      id: emailId,
    });

    const attachments: Array<{ id: string; filename: string; size: number }> = [];

    // Parse message parts for attachments
    const parts = message.data.payload?.parts || [];

    for (const part of parts) {
      if (part.filename && part.body?.attachmentId) {
        attachments.push({
          id: part.body.attachmentId,
          filename: part.filename,
          size: part.body.size || 0,
        });
      }

      // Handle nested parts (multipart messages)
      if (part.parts) {
        for (const subPart of part.parts) {
          if (subPart.filename && subPart.body?.attachmentId) {
            attachments.push({
              id: subPart.body.attachmentId,
              filename: subPart.filename,
              size: subPart.body.size || 0,
            });
          }
        }
      }
    }

    return attachments;
  } catch (error) {
    console.error('Error fetching email attachments:', error);
    return [];
  }
}
