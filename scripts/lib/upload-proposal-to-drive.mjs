/**
 * Upload / update proposal PDFs in the shared Google Drive folder.
 *
 * Setup (one-time):
 * 1. Google Cloud project → enable Google Drive API.
 * 2. Create a service account → download JSON key.
 * 3. Share the Drive folder with the service account email (Editor):
 *    https://drive.google.com/drive/folders/1EXmCYXf3nt2koRid53rbwaIYEf50yxli
 * 4. Save the key as secrets/google-drive-service-account.json
 *    (or set GOOGLE_DRIVE_CREDENTIALS to another path).
 *
 * Set SKIP_DRIVE_UPLOAD=1 to disable uploads.
 */
import { createReadStream } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

/** CrewSight proposals folder on Google Drive. */
export const PROPOSALS_DRIVE_FOLDER_ID = '1EXmCYXf3nt2koRid53rbwaIYEf50yxli';

export const PROPOSALS_DRIVE_FOLDER_URL =
  'https://drive.google.com/drive/folders/1EXmCYXf3nt2koRid53rbwaIYEf50yxli';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';

function credentialsPath() {
  return process.env.GOOGLE_DRIVE_CREDENTIALS
    || join(ROOT, 'secrets', 'google-drive-service-account.json');
}

async function getDriveClient() {
  const path = credentialsPath();
  await access(path);
  const credentials = JSON.parse(await readFile(path, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: [DRIVE_SCOPE],
  });
  return google.drive({ version: 'v3', auth });
}

function escapeDriveQuery(value) {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findFileInFolder(drive, folderId, name) {
  const q = `'${folderId}' in parents and name='${escapeDriveQuery(name)}' and trashed=false`;
  const res = await drive.files.list({
    q,
    fields: 'files(id,name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  return res.data.files?.[0]?.id ?? null;
}

/**
 * Upload a PDF to Drive, replacing an existing file with the same name in the folder.
 * Returns null when upload is skipped (no credentials or SKIP_DRIVE_UPLOAD=1).
 */
export async function uploadPdfToDrive(pdfPath, {
  folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || PROPOSALS_DRIVE_FOLDER_ID,
} = {}) {
  if (process.env.SKIP_DRIVE_UPLOAD === '1') {
    return null;
  }

  let drive;
  try {
    drive = await getDriveClient();
  } catch {
    console.warn(
      `Drive upload skipped — place a service account key at ${credentialsPath()} ` +
      `and share ${PROPOSALS_DRIVE_FOLDER_URL} with that account.`,
    );
    return null;
  }

  const name = basename(pdfPath);
  const media = {
    mimeType: 'application/pdf',
    body: createReadStream(pdfPath),
  };

  const existingId = await findFileInFolder(drive, folderId, name);
  const fields = 'id,name,webViewLink,webContentLink';

  if (existingId) {
    const res = await drive.files.update({
      fileId: existingId,
      media,
      fields,
      supportsAllDrives: true,
    });
    console.log('Updated Drive:', res.data.webViewLink || name);
    return res.data;
  }

  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
    },
    media,
    fields,
    supportsAllDrives: true,
  });
  console.log('Uploaded to Drive:', res.data.webViewLink || name);
  return res.data;
}

/** Upload multiple PDFs sequentially. */
export async function uploadPdfsToDrive(pdfPaths, options = {}) {
  const results = [];
  for (const pdfPath of pdfPaths) {
    results.push(await uploadPdfToDrive(pdfPath, options));
  }
  return results;
}
