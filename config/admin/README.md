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

## Claw admin RBAC

`claw-admin-rbac.yaml` defines the `openclaw-claw-admin` ClusterRole and binds
it to the user `claw-admin`. This is the least-privilege, read-only surface a
human Claw administrator needs: Claws, plus the diagnostic resources the
dashboard surfaces (ConfigMaps, Pods, pod logs, Deployments, Routes, Events,
Services, Namespaces). It is intentionally not cluster-admin. Binding it to
`claw-admin` also satisfies the OAuth proxy `list claws` review above, so that
htpasswd user can sign in to this dashboard.

To create the htpasswd user and apply the role:

```sh
# add claw-admin to the htpasswd identity provider, then:
oc apply -f config/admin/claw-admin-rbac.yaml
```

## Inspecting the effective openclaw.json

Each Claw row has an **Effective config** action. The merged, effective
`openclaw.json` lives on the Claw's `ReadWriteOnce` PVC (`<name>-home-pvc`,
mounted at `/home/node/.openclaw/openclaw.json` in the gateway pod), so it can
only be read from the running pod. The action shows the PVC, the path, and a
ready-to-copy command:

```sh
oc exec -n <namespace> deploy/<name> -- cat /home/node/.openclaw/openclaw.json
```

Reading the live file requires `pods/exec`, which is intentionally **not** in
the `openclaw-claw-admin` role: `pods/exec` cannot be scoped to Claw pods in a
ClusterRole, so granting it would allow exec into any pod cluster-wide. Leave
live-file reads to cluster-admin or a namespace-scoped grant. The dashboard's
console links (Pod → Terminal) offer the same access for those who have it.

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
