import { readFile } from 'node:fs/promises';

const archive = process.argv[2];
const token = process.env.CHROME_WEBSTORE_ACCESS_TOKEN;
const publisherId = process.env.CHROME_WEBSTORE_PUBLISHER_ID;
const itemId = process.env.CHROME_WEBSTORE_ITEM_ID;
if (!archive || !token || !publisherId || !itemId) {
    throw new Error(
        'Usage: publish-chrome.mjs <zip>; CHROME_WEBSTORE_ACCESS_TOKEN, CHROME_WEBSTORE_PUBLISHER_ID, and CHROME_WEBSTORE_ITEM_ID are required.',
    );
}

const name = `publishers/${publisherId}/items/${itemId}`;
const headers = { Authorization: `Bearer ${token}` };
const upload = await fetch(`https://chromewebstore.googleapis.com/upload/v2/${name}:upload`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/zip' },
    body: await readFile(archive),
});
const uploadBody = await upload.text();
if (!upload.ok) throw new Error(`Chrome Web Store upload failed (${upload.status}): ${uploadBody}`);
const uploadResult = JSON.parse(uploadBody);
if (uploadResult.uploadState && !['SUCCEEDED', 'UPLOAD_STATE_UNSPECIFIED'].includes(uploadResult.uploadState)) {
    throw new Error(`Chrome Web Store upload did not complete: ${uploadBody}`);
}

const publish = await fetch(`https://chromewebstore.googleapis.com/v2/${name}:publish`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ publishType: 'DEFAULT_PUBLISH', blockOnWarnings: true }),
});
const publishBody = await publish.text();
if (!publish.ok) throw new Error(`Chrome Web Store publish failed (${publish.status}): ${publishBody}`);
console.log(publishBody);
