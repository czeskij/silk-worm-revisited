# Online version (Cloudflare Worker)

The remake as a password-protected website, so it runs on any device with a
browser. The Worker (`worker.js`) asks for a user name and password before it
serves anything:

- **the code** (`../remake`) is deployed by GitHub Actions on every push to
  `main` that touches `remake/` or `deploy/`
- **the game data** (`remake/js/gamedata.js`, unpacked from your ADF) is never
  in the repo; you upload it once into a private KV store on your account

User name: `silkworm`. Password: whatever you choose in step 1.

## One-time setup

1. Unpack the disk if you haven't, then run the setup (needs Node.js; Wrangler
   opens a browser to log in to Cloudflare the first time):

   ```bash
   node ../remake/build.js ../Data/Floppies/Silkworm.adf
   npm install
   node setup.js
   ```

   It creates the KV store and writes its id into `wrangler.jsonc`, deploys the
   Worker, uploads the game data and asks for the site password. At the end
   the deploy output shows the address, something like
   `https://silkworm.<your-subdomain>.workers.dev`.

2. Commit and push the id it wrote into `wrangler.jsonc`.

3. Let GitHub deploy: in the Cloudflare dashboard go to *My Profile → API
   Tokens → Create Token*, use the **Edit Cloudflare Workers** template for your
   account, and save the token as a repository secret:

   ```bash
   gh secret set CLOUDFLARE_API_TOKEN
   ```

   (paste the token when asked). Until the secret exists, the workflow skips
   the deploy with a note instead of failing.

## Later

- Code changes deploy themselves when pushed to `main`.
- After rebuilding the game data (`build.js`), upload it again:
  `node setup.js --data`.
- New password: `npx wrangler secret put AUTH_PASSWORD`.
- Try it locally: put `AUTH_PASSWORD=...` in `.dev.vars` (git-ignored), load
  the data with `npx wrangler kv key put gamedata.js --path
  ../remake/js/gamedata.js --binding GAMEDATA --local`, then `npm run dev`.
