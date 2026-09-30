# Blaze Server Hourly Backup

Public repo with GitHub Actions that backs up the VisiHost / Pterodactyl Bedrock server files every hour.

## Setup (required secrets)

In repo **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
|--------|--------|
| `PTERO_API_KEY` | Your panel client API key (`ptlc_...`) |
| `PTERO_URL` | `https://paid.visihost.in` |
| `PTERO_SERVER_ID` | `265069f2` |

Do **not** commit API keys or passwords into this repository.

## Schedule
- Runs every hour (`0 * * * *`)
- Also runnable manually via Actions → Run workflow

## What it backs up
- `server.properties`
- `development_behavior_packs/` (addon)
- `worlds/Bedrock level/level.dat` metadata (not full LevelDB by default to stay under size limits)
- Manifest of root files

Full world DB can be large; extend the workflow if you need full `db/` archive via SFTP.
