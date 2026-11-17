select net.http_post(
  url := 'https://dfhdlutxfgggpflvuacl.supabase.co/functions/v1/backup-to-google-drive',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'linkbarangay_backup_anon_key'
      limit 1
    ),
    'x-backup-schedule-token', (
      select decrypted_secret from vault.decrypted_secrets
      where name = 'linkbarangay_backup_cron_token'
      limit 1
    )
  ),
  body := '{}'::jsonb
) as request_id;
