## Enable otel export on a namespace

oc annotate namespace <namespace> instrumentation.opentelemetry.io/inject-sdk="openshift-observability/ingest"

## RBAC groups

The observability RBAC manifests grant read access to the
`openclaw-observability-viewers` group and edit or sensitive log access to the
`openclaw-observability-admins` group. Add users to those groups explicitly;
do not bind observability access to `system:authenticated`.
