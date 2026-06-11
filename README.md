# OpenClaw Operator Dashboard

This repository contains the OpenClaw deployer dashboard.

The dashboard is a small web UI and backend that creates and updates `Claw`
resources through the Kubernetes API. It does not import the operator code; it
depends on the `claw.sandbox.redhat.com/v1alpha1` API shape exposed by the
[`claw-operator`](https://github.com/redhat-et/claw-operator).

The repository also contains a separate admin dashboard for read-only,
cluster-wide Claw inventory. It runs as its own command and deployment in the
`openclaw-admin-dashboard` namespace, uses its own service account, and does
not impersonate logged-in users.

## Local Preview

```sh
make deployer-run-local
```

For the admin dashboard:

```sh
make admin-run-local
```

## Test

```sh
make test
```

## Build

```sh
make deployer-build
```

Override `DEPLOYER_IMG` to publish a different deployer image name. The admin
dashboard has its own image and build target:

```sh
make admin-build
```

Override `ADMIN_IMG` to publish a different admin dashboard image name.
