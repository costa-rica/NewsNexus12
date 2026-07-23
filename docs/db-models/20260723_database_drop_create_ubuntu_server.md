# Commands

## Stop / Start all

## Step 1 — Stop All NewsNexus12 Services

```bash
# Stop
sudo systemctl stop newsnexus12-api.service
sudo systemctl stop newsnexus12-worker-node.service
sudo systemctl stop newsnexus12-worker-python.service
sudo systemctl stop newsnexus12-portal.service

# Start
sudo systemctl start newsnexus12-api.service
sudo systemctl start newsnexus12-worker-node.service
sudo systemctl start newsnexus12-worker-python.service
sudo systemctl start newsnexus12-portal.service
```

## Drop and create

### 1. Drop, Create, Apply Privileges

Run this from any terminal:

```bash
# Drop
sudo -u postgres dropdb newsnexus_prod

# Create
sudo -u postgres createdb newsnexus_prod

# Apply privileges
sudo -u postgres psql -d newsnexus_prod -c "GRANT CREATE ON DATABASE newsnexus_prod TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
sudo -u postgres psql -d newsnexus_prod -c "GRANT ALL ON SCHEMA public TO newsnexus_app;"
sudo -u postgres psql -d newsnexus_prod -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"
```

### 2. Replenish

```bash
cd /home/limited_user/applications/NewsNexus12/db-manager
node dist/index.js --zip_file /path/to/db_backup_YYYYMMDDHHMMSS.zip
```
