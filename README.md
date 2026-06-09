# OpenClaw Operator Dashboard

This repository contains the OpenClaw deployer dashboard.

The dashboard is a small web UI and backend that creates and updates `Claw`
resources through the Kubernetes API. It does not import the operator code; it
depends on the `claw.sandbox.redhat.com/v1alpha1` API shape exposed by the
[`claw-operator`](https://github.com/redhat-et/claw-operator).

## Local Preview

```sh
make deployer-run-local
```

## Test

```sh
make test
```

## Build

```sh
make deployer-build
```

Override `DEPLOYER_IMG` to publish a different image name.
