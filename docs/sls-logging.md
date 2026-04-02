# SLS Logging Notes

## Symptom

If one application event appears in SLS as several rows like:

- `content: {`
- `content: "data_dir": "/data/marketing_fox/service-data"`
- `content: "port": 3001,`
- `content: "host": "0.0.0.0",`
- `content: "service": "marketing_fox",`
- `content: "status": "listening",`
- `content: }`

then SLS is ingesting a pretty-printed multi-line JSON payload and splitting it on newline boundaries.

## What the app emits

Marketing Fox should emit newline-delimited JSON for operational logs:

- [`src/ts/logging/logger.ts`](/Users/keboom/codeProject/marketing_fox/src/ts/logging/logger.ts)
- `stderr`: structured service logs
- `stdout`: structured command result records

Each event should be exactly one JSON object followed by one newline. Example:

```json
{"ts":"2026-04-01T09:31:11.646Z","level":"info","component":"api-server","event":"server_listening","service":"marketing_fox","host":"0.0.0.0","port":3001,"data_dir":"/data/marketing_fox/service-data"}
```

## Recommended fix in SLS

If the container is already running the current code but SLS still shows split rows, change the Logtail/SLS collection rule instead of changing the app:

1. Use container `stdout/stderr` collection.
2. Treat the log as text lines, one event per line.
3. If a multi-line merge rule is enabled, either disable it for this logstore or set the log-begin regex to the JSON line start, for example `^\{"ts":"`.
4. After collection is stable, add a processor to parse the full line as JSON so fields like `level`, `component`, `event`, `service`, and `port` become queryable fields instead of staying inside `content`.

## If SLS still shows split rows

Then the deployed container is likely not running the current logger implementation yet. Check the live container output first:

```sh
docker logs <api-container> --tail 20
```

What to look for:

- If `docker logs` already shows multiple lines for one event, some runtime path is still printing pretty JSON and needs to be changed to the shared logger.
- If `docker logs` shows one compact JSON line but SLS shows several rows, the bug is entirely in the SLS/Logtail collection rule.
