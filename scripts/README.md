# Scripts

## Testing

1. Install and reload the test service:
   ```bash
   sudo cp scripts/newsnexus12-worker-node-orchestrator-test.service /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
2. Start the test trigger:
   ```bash
   sudo systemctl start newsnexus12-worker-node-orchestrator-test.service
   ```
3. Check results:
   ```bash
   systemctl status newsnexus12-worker-node-orchestrator-test.service --no-pager --lines=30 -l
   curl http://127.0.0.1:8003/orchestrator/active-run
   curl 'http://127.0.0.1:8003/orchestrator/runs?limit=5'
   ```

## Production

1. Install the weekly service and timer:
   ```bash
   sudo cp scripts/newsnexus12-worker-node-orchestrator-weekly.service /etc/systemd/system/
   sudo cp scripts/newsnexus12-worker-node-orchestrator-weekly.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   ```
2. Enable the Friday noon timer:
   ```bash
   sudo systemctl enable --now newsnexus12-worker-node-orchestrator-weekly.timer
   ```
3. Check the schedule:
   ```bash
   systemctl list-timers newsnexus12-worker-node-orchestrator-weekly.timer
   ```

## Files

- `newsnexus12-worker-node-orchestrator-test.service`
  - One-shot systemd unit that calls the abbreviated test orchestration helper script.

- `newsnexus12-worker-node-orchestrator-weekly.service`
  - One-shot systemd unit that calls the full weekly orchestration helper script.

- `newsnexus12-worker-node-orchestrator-weekly.timer`
  - Systemd timer that runs the weekly orchestration service every Friday at noon.

- `trigger-worker-node-orchestrator-test.sh`
  - Sends the abbreviated test orchestration request to the local worker-node service.

- `trigger-worker-node-orchestrator-weekly.sh`
  - Sends the full weekly orchestration request to the local worker-node service.
