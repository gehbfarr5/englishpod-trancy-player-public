# `sync_server` (EP-SYNC-001)

Go + SQLite (WAL) multi-device progress sync service for EnglishPod.

## Build (Linux amd64)

```bash
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o ep-syncd ./cmd/ep-syncd
```

## Runtime Environment (`/etc/ep-syncd/env`)

```dotenv
SYNC_LISTEN_ADDR=127.0.0.1:8787
SYNC_DB_PATH=/var/lib/ep-syncd/ep-sync.db
SYNC_GATEWAY_SECRET=<SYNC_GATEWAY_SECRET>
SYNC_CORS_ORIGINS=https://<SYNC_HOST>
SYNC_TRUSTED_PROXY_CIDRS=127.0.0.1/32,::1/128
SYNC_MAX_DEVICES_PER_GROUP=10
SYNC_PAIR_TTL_SECONDS=300
SYNC_CLEANUP_INTERVAL_SECONDS=3600
```

## Deployment Checklist

1. Create non-privileged service user `ep-sync`, state directory `/var/lib/ep-syncd`, and backup directory `/var/backups/ep-syncd` (requires `sqlite3` installed for `.backup` snapshots).
2. Install binary to `/usr/local/bin/ep-syncd` and write protected `/etc/ep-syncd/env` (`chmod 0600`).
3. Install `ep-syncd.service`, `ep-sync-backup.service`, and `ep-sync-backup.timer` into `/etc/systemd/system/`, reload `systemd`, and enable both `ep-syncd.service` and `ep-sync-backup.timer`.
4. Add `nginx-sync-location.conf.example` inside the TLS server block for `https://<SYNC_HOST>/` and reload Nginx.
5. Verify `/healthz` locally on `127.0.0.1:8787` and end-to-end TLS routing through `https://<SYNC_HOST>/api/sync/v1/...`.
