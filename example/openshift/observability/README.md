## Enable otel export on a namespace

oc annotate namespace <namespace> instrumentation.opentelemetry.io/inject-sdk="openshift-observability/ingest"
