# Drop and Restore PostgreSQL Database — nn12dev

**Date:** 2026-04-30  
**Server:** nn12dev (RDC network)  
**Database:** `newsnexus_prod`

## Context

Drop the existing PostgreSQL database so it can be recreated and restored from a `.zip` backup file using the `db-manager` tool.

---

## Step 1 — Stop All NewsNexus12 Services

Stop every service that holds a connection to the database before dropping it.

```bash
sudo systemctl stop newsnexus12-api.service
sudo systemctl stop newsnexus12-worker-node.service
sudo systemctl stop newsnexus12-worker-python.service
sudo systemctl stop newsnexus12-portal.service
sudo systemctl stop newsnexus12-db-manager.service
sudo systemctl stop newsnexus12-db-manager.timer
```

Verify nothing is still running:

```bash
sudo systemctl status newsnexus12-api.service newsnexus12-worker-node.service newsnexus12-worker-python.service
```

---

## Step 2 — Confirm No Active Connections

```bash
sudo -u postgres psql -c "SELECT pid, usename, application_name, state FROM pg_stat_activity WHERE datname = 'newsnexus_prod';"
```

If any rows appear (other than the query itself), terminate them:

```bash
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'newsnexus_prod' AND pid <> pg_backend_pid();"
```

---

## Step 3 — Drop the Database

```bash
sudo -u postgres dropdb newsnexus_prod
```

Confirm it is gone:

```bash
sudo -u postgres psql -l
```

`newsnexus_prod` should no longer appear in the list.

---

## Step 4 — Recreate the Empty Database

```bash
sudo -u postgres createdb newsnexus_prod
```

**Important — PostgreSQL 15+ permission fix:** When the database is recreated, the app users lose access to the `public` schema. Grant privileges and transfer schema ownership before running the import or the restore will fail with `permission denied` / `must be owner of schema public` errors.

`rebuildSchema()` inside db-manager does DROP SCHEMA → CREATE SCHEMA → sync(). Creating a schema requires database-level `CREATE` privilege, so that grant is mandatory or the recreate step will fail even after the schema-level grants are applied.

```bash
sudo -u postgres psql -d newsnexus_prod -c "GRANT CREATE ON DATABASE newsnexus_prod TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_app;"
sudo -u postgres psql -d newsnexus_prod -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"
```

---

## Step 5 — Copy the Backup File

The db-manager runs as `limited_user` and cannot read files inside `/home/nick/`. Copy the backup zip to `limited_user`'s home directory first:

```bash
cp /home/nick/<backup_filename>.zip /home/limited_user/<backup_filename>.zip
```

Example (2026-04-29 backup used for the orchestrator rollout):

```bash
cp /home/nick/db_backup_202604291823277.zip /home/limited_user/db_backup_202604291823277.zip
```

---

## Step 6 — Restore from ZIP Backup

Run the import pointing to the copied file:

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager && \
nohup sudo -u limited_user npm start -- --zip_file /home/limited_user/db_backup_202604291823277.zip > /dev/null 2>&1 &
echo $!
```

Follow the log to monitor progress:

```bash
tail -f /home/limited_user/logs/NewsNexus12DbManager.log
```

---

## Step 7 — Restart Services

Once the import completes, bring services back up:

```bash
sudo systemctl start newsnexus12-api.service
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl start newsnexus12-worker-python.service
sudo systemctl start newsnexus12-portal.service
sudo systemctl enable --now newsnexus12-db-manager.timer
```

Verify each one is active:

```bash
sudo systemctl status newsnexus12-api.service
sudo systemctl status newsnexus12-worker-node.service
```

---

## Quick Reference

| Variable         | Value                                               |
|------------------|-----------------------------------------------------|
| DB name          | `newsnexus_prod`                                    |
| DB owner user    | `newsnexus_boot` (db-manager)                       |
| DB app user      | `newsnexus_app` (api)                               |
| DB port          | `5432`                                              |
| DB host          | `localhost`                                         |
| Log file         | `/home/limited_user/logs/NewsNexus12DbManager.log`  |
