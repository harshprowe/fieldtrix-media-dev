# Backend Observability

FieldTrix backend observability tracks request volume, endpoint distribution, response times, backend errors, and accidental backend media playback traffic.

## Metrics Endpoint

Prometheus scrape endpoint:

```text
GET /api/v1/metrics
```

## Metrics

### Requests Per Minute

Metric:

```text
fieldtrix_http_requests_total
```

Grafana query:

```promql
sum(rate(fieldtrix_http_requests_total[1m])) * 60
```

### Endpoint Distribution

Metric:

```text
fieldtrix_http_endpoint_distribution_total
```

Grafana query:

```promql
sum by (endpoint) (rate(fieldtrix_http_endpoint_distribution_total[5m]))
```

### Response Times

Metric:

```text
fieldtrix_http_request_duration_seconds
```

Grafana p95 query:

```promql
histogram_quantile(0.95, sum by (le, endpoint) (rate(fieldtrix_http_request_duration_seconds_bucket[5m])))
```

### Errors

Metric:

```text
fieldtrix_http_errors_total
```

This increments for HTTP responses with status code `>= 500`.

### Backend Playback Guardrail

Metric:

```text
media_playback_backend_hits
```

Goal:

```text
0
```

This metric increments when a request looks like an attempted media playback/download through FastAPI, such as:

- `GET /something.mp4`
- `GET /something.pdf`
- `GET` or `HEAD` requests with `Accept: video/*`
- `GET` or `HEAD` requests with `Accept: audio/*`

The intended architecture is:

```text
Browser -> CDN/R2 for media bytes
Browser -> FastAPI for metadata only
```

So `media_playback_backend_hits` should remain zero.

## Structured Logging

Every request logs one JSON event:

```text
http.request
```

Fields:

- `request_id`
- `method`
- `path`
- `endpoint`
- `query`
- `status_code`
- `duration_ms`
- `client_host`

`X-Request-ID` is propagated when provided and returned in the response.

## Deployment Artifacts

- `infra/observability/prometheus.yml`
- `infra/observability/grafana/provisioning/datasources/prometheus.yml`
- `infra/observability/grafana/provisioning/dashboards/dashboards.yml`
- `infra/observability/grafana/dashboards/backend-observability.json`

