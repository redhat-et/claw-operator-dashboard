# OpenClaw Admin Dashboard

This deploys a separate, read-only OpenShift webapp for cluster admins to view
all `Claw` resources in the cluster.

The admin dashboard is intentionally separate from the user deployer:

- namespace: `openclaw-admin-dashboard`
- service account: `openclaw-admin-dashboard`
- no user impersonation headers
- read-only cluster RBAC for Claws and related diagnostic resources

OpenShift OAuth protects the UI. The OAuth proxy requires the logged-in user to
pass a cluster-scoped subject access review for `list` on
`claws.claw.sandbox.redhat.com` before forwarding the request to the backend.
The backend then uses only its service account token to read cluster state.

## Deploy

```sh
oc apply -f config/admin/namespace.yaml
oc create secret generic openclaw-admin-dashboard-cookie \
  -n openclaw-admin-dashboard \
  --from-literal=session_secret="$(openssl rand -base64 32 | head -c 32)"
oc apply -k config/admin
oc rollout status deployment/openclaw-admin-dashboard -n openclaw-admin-dashboard
oc get route openclaw-admin-dashboard -n openclaw-admin-dashboard
```

Optional links can be configured on the app container:

- `OPENSHIFT_CONSOLE_URL`
- `MLFLOW_URL`
- `PROMETHEUS_URL`

When `OPENSHIFT_CONSOLE_URL` is set, each Claw row links to the Claw CR,
gateway/proxy ConfigMaps, Deployments, Pods, and namespace Events in the
OpenShift console.
