-- Runs at 18:00 UTC / 02:00 Asia/Manila. It requires the two Vault entries:
-- linkbarangay_backup_anon_key and linkbarangay_backup_cron_token.
select cron.schedule(
  'linkbarangay-google-drive-backup-daily',
  '0 18 * * *',
  $job$
    select net.http_post(
      url := 'https://dfhdlutxfgggpflvuacl.supabase.co/functions/v1/backup-to-google-drive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'linkbarangay_backup_anon_key'
          limit 1
        ),
        'x-backup-schedule-token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'linkbarangay_backup_cron_token'
          limit 1
        )
      ),
      body := '{}'::jsonb
    );
  $job$
);
