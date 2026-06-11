# OpenClaw Deployer

This is a small OpenShift webapp for provisioning `Claw` resources in
OpenShift namespaces the logged-in user can manage.

OpenShift OAuth protects the UI and forwards the username/groups to the
backend. The backend uses the deployer service account token with Kubernetes
impersonation headers, so OpenShift authorizes each request as the logged-in
user. The deployer can only operate where that user already has normal project
RBAC.

For each Claw, the deployer creates or deletes in the selected namespace:

- a provider API key Secret named `openclaw-<name>-<provider>-api-key`
- a `claw.sandbox.redhat.com/v1alpha1` `Claw`
- when a folder is uploaded to seed the filesystem, a ConfigMap named
  `openclaw-<name>-agentfiles` holding the packaged `agentfiles.tgz`

## Seeding the OpenClaw workspace

When **Config owner** is set to **User**, the form offers an **OpenClaw
workspace source** that maps to `spec.agentFiles` on the Claw (the operator only
honors it for user-managed Claws):

- **Git repository** — a repository URL with an optional ref and subpath. The
  operator clones it in the init container.
- **Upload a folder** — pick a folder in the browser. The backend packages it
  into `agentfiles.tgz`, stores it in the `openclaw-<name>-agentfiles`
  ConfigMap as the impersonated user, and points `spec.agentFiles.configMapRef`
  at it — no manual `tar`/ConfigMap step. Uploads are capped at 1 MiB.

Either way, the source is a directory tree that seeds the Claw's OpenClaw home
(`~/.openclaw`, on its persistent volume), applied once on first boot; edits
made later inside the running Claw are preserved. Layout:

- `workspace-main/` → the agent workspace (`~/.openclaw/workspace/`), e.g.
  `AGENTS.md`, `SOUL.md`, `memory/`, `skills/`
- `openclaw.json` → merged into the Claw's effective config (not copied as a
  workspace file)
- any other top-level folder → copied under `~/.openclaw/` (e.g. `skills/` →
  `~/.openclaw/skills/`)

A correct bundle also wires up sub-agent workspaces, shared skills dirs, plugin
paths, and cron in its `openclaw.json`. See the full layout reference and
examples in [redhat-et/claw-collections](https://github.com/redhat-et/claw-collections).

## Build

The Makefile defaults image builds to `PLATFORM=linux/amd64`.

```sh
make deployer-build
make deployer-push
```

To be explicit:

```sh
make deployer-build PLATFORM=linux/amd64
make deployer-push
```

## Local preview

To preview the deployer UI without building an image or deploying to
OpenShift:

```sh
make deployer-run-local
```

Then open <http://127.0.0.1:18080/>. The app runs with a local preview user
and a dummy Kubernetes API server, so the page renders but status and
provisioning calls will show connection errors.

Useful overrides:

```sh
make deployer-run-local DEPLOYER_LOCAL_ADDR=:18081 DEPLOYER_LOCAL_USER=sallyom
```

## Deploy

```sh
oc new-project openclaw-deployer
oc create secret generic openclaw-deployer-cookie \
  --from-literal=session_secret="$(openssl rand -base64 32 | head -c 32)"

oc apply -k config/deployer
oc rollout status deployment/openclaw-deployer -n openclaw-deployer
oc get route openclaw-deployer -n openclaw-deployer
```

The manifests grant the deployer service account `impersonate` on users and
groups. They do not grant direct permission to create Secrets or Claws. Users
still need normal RBAC in the target namespace. If they can create Secrets and
`Claw` resources there, the card can provision their OpenClaw. If they cannot,
the app shows the Kubernetes authorization error.

By default, the deployer suggests namespace `sallyom-claw` for user `sallyom`.
Users whose login already ends with `-claw` get that exact namespace as the
suggestion. Set `CLAW_NAMESPACE_SUFFIX` on the deployer container to use a
different suffix. The UI keeps the field editable and suggests namespaces from
Claws the user can see.

The deployer binary defaults new Claws to `spec.config.management=operator`.
These manifests set `CLAW_CONFIG_MANAGEMENT_DEFAULT=user` so this dashboard
deployment defaults to user-managed config while still showing an Operator/User
toggle in the form.
