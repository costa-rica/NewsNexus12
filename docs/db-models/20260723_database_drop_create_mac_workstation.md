# Commands

## Drop and create

### 1. Drop, Create, Apply Privileges

Run this from any terminal:

```bash
# Drop
dropdb --if-exists newsnexus_dev

# Create
createdb -O newsnexus_boot newsnexus_dev

# Apply privileges
psql postgres -c "GRANT CONNECT ON DATABASE newsnexus_dev TO newsnexus_app;"
psql postgres -c "GRANT CREATE ON DATABASE newsnexus_dev TO newsnexus_boot;"
psql -d newsnexus_dev -c "ALTER SCHEMA public OWNER TO newsnexus_boot;"
psql -d newsnexus_dev -c "GRANT ALL ON SCHEMA public TO newsnexus_boot;"
psql -d newsnexus_dev -c "GRANT USAGE ON SCHEMA public TO newsnexus_app;"
```

### 2. Replenish

```bash
cd /Users/nick/Documents/NewsNexus12/db-manager
npm start -- --zip_file /absolute/path/to/db_backup_YYYYMMDDHHMMSS.zip
```
