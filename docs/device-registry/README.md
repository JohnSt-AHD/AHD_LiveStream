# CrewSight device registry (offline index)

Master register for fleet provisioning. **Keep this file offline** (secure share or encrypted storage). Do **not** commit live ICCIDs or secrets to git.

## CSV columns

| Column | Required | Description |
|--------|----------|-------------|
| `device_id` | Yes | Unique ID sent by the app on every upload (e.g. `KRI-042`). Use stable codes, not crew names. |
| `status` | Yes | `active`, `spare`, or `retired`. Only `active` should upload in production. |
| `season` | Yes | e.g. `2026` |
| `club` | No | Owning / hiring club |
| `boat_class` | No | e.g. `M8+`, `W4-` |
| `boat_label` | No | Ops label on the boat or rack |
| `regatta_code` | No | RowIT / event code when assigned |
| `handset_model` | No | e.g. `One NZ Smart M26` |
| `handset_asset_tag` | No | Physical asset sticker / serial reference |
| `sim_iccid` | No | IoT SIM ICCID (store offline only) |
| `sim_apn` | No | If manual APN required |
| `gps_interval_sec` | No | Default reporting interval: `1`, `5`, `10`, or `30` |
| `provisioned_date` | No | ISO date when app was configured |
| `provisioned_by` | No | Who provisioned the handset |
| `last_seen_notes` | No | Free text for ops |

## What is **not** in this sheet

- **Ingest token** — one **fleet token** per season/event lives in server env (`INGEST_TOKEN`), not per row.
- **Passwords** — monitor login is separate from device ingest.

## Workflow

1. Copy `CrewSight-Device-Registry.template.csv` to a secure location (e.g. `CrewSight-Device-Registry-2026.csv`).
2. Fill one row per handset. `device_id` must match what is set in the CrewSight app.
3. Before each regatta block: export CSV → import into recorder **device allowlist** (script TBD in recorder repo).
4. Dispatch: scan provisioning QR or confirm device ID + “Test upload” on each phone.

## Token rotation

See **Ingest token rotation** below — the monitor does **not** push tokens to phones today.
