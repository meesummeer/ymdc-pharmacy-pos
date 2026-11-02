Cloudflare Worker that stores PharmacyPilot backup zips in the R2 bucket `pharmacypilot-backups`.
Only a signed-in Supabase admin may call it; it can list and add backups, never download, overwrite or delete them.
Deploy with `npx wrangler deploy` from this folder (needs `npx wrangler login` once). There are no secrets.
