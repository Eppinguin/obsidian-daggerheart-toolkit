# Browser store publishing

The release workflow always creates these GitHub release assets:

- `daggerheart-statblock-clipper-chromium.zip`
- `daggerheart-statblock-clipper-firefox.xpi` (unsigned development package)
- `daggerheart-statblock-clipper-source.zip`

Create a tag such as `statblock-clipper-v0.7.0` to build, test, package, and publish a GitHub release.

## Firefox Add-ons

Create Mozilla Add-ons API credentials and configure these repository secrets:

- `AMO_JWT_ISSUER`
- `AMO_JWT_SECRET`

When both are present, the release workflow submits the Firefox build through `web-ext sign --channel listed`. Mozilla may hold a listed submission for automated or manual review before a signed public package is available.

The Firefox manifest already declares the Gecko extension ID and no-data-collection permission.

## Chrome Web Store

Create the extension item in the Chrome Web Store developer dashboard, enable the Chrome Web Store API for a Google Cloud project, and grant a service account access to the publisher account.

Configure this repository secret:

- `CHROME_WEBSTORE_SERVICE_ACCOUNT_JSON` — complete service-account JSON

Configure these repository variables:

- `CHROME_WEBSTORE_PUBLISHER_ID`
- `CHROME_WEBSTORE_ITEM_ID`

The workflow exchanges the service-account credentials for a scoped access token, uploads the Chromium ZIP through Chrome Web Store API V2, and requests publication with warnings treated as blocking.

## Manual release run

The workflow can also be started from **Actions → Statblock Clipper Release → Run workflow**. Select **Publish to configured browser stores** only after the listing metadata, screenshots, privacy declarations, and credentials are complete.

Store credentials are never required for normal pull-request CI or GitHub release packaging.
