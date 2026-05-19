# Archived scripts

- This directory stores one-off or historical scripts that are not part of normal app startup, builds, or recurring jobs.
- Keep entries brief: what the script did, whether it is still needed, and when to run it again.

## 20260501_article_fk_indexes.sql

- One-time Postgres script for existing databases missing article child-table foreign-key indexes.
- Added to fix slow article delete cascades.
- Not needed for rebuilt databases because these indexes now live in Sequelize models.
