/*
Copyright 2026 Red Hat.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package main

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestAdminClawFromResourceDefaultsManagementAndLinksResources(t *testing.T) {
	s := &server{
		consoleURL:    "https://console.example.test",
		prometheusURL: "https://prometheus.example.test",
	}
	claw := map[string]any{
		"metadata": map[string]any{
			"namespace":         "sallyom-claw",
			"name":              "instance",
			"generation":        float64(3),
			"creationTimestamp": "2026-06-10T12:00:00Z",
		},
		"spec": map[string]any{
			"credentials": []any{
				map[string]any{"provider": "openrouter"},
			},
			"config": map[string]any{},
		},
		"status": map[string]any{
			"gatewayURL":         "https://gateway.example.test",
			"observedGeneration": float64(2),
			"conditions": []any{
				map[string]any{
					"type":    "Ready",
					"status":  "True",
					"reason":  "Ready",
					"message": "ready",
				},
			},
		},
	}

	got := s.adminClawFromResource(claw)

	assert.Equal(t, "operator", got.Management)
	assert.True(t, got.Ready)
	assert.Equal(t, []string{"openrouter"}, got.Providers)
	assert.Equal(t, int64(3), got.Generation)
	assert.Equal(t, int64(2), got.ObservedGeneration)
	assert.Equal(t, "instance-config", got.ConfigMapName)
	assert.Contains(t, got.ConfigMapURL, "/k8s/ns/sallyom-claw/configmaps/instance-config")
	assert.Contains(t, got.ClawConsoleURL, "claw.sandbox.redhat.com~v1alpha1~Claw/instance")
	assert.Contains(t, got.PrometheusURL, "namespace%3D%22sallyom-claw%22")
}

func TestListClawsSortsUserManagedFirst(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body: io.NopCloser(strings.NewReader(`{
					"items": [
						{"metadata": {"namespace": "b", "name": "operator"}, "spec": {"config": {"management": "operator"}}},
						{"metadata": {"namespace": "a", "name": "user"}, "spec": {"config": {"management": "user"}}}
					]
				}`)),
			}, nil
		}),
	}
	s := &server{
		apiServer:   "https://kubernetes.example.test",
		bearerToken: "service-account-token",
		client:      client,
	}

	claws, err := s.listClaws(context.Background())

	require.NoError(t, err)
	require.Len(t, claws, 2)
	assert.Equal(t, "user", claws[0].Name)
	assert.Equal(t, "operator", claws[1].Name)
}

func TestKubeJSONDoesNotImpersonate(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			assert.Empty(t, r.Header.Get("Impersonate-User"))
			assert.Empty(t, r.Header.Values("Impersonate-Group"))
			assert.Equal(t, "Bearer service-account-token", r.Header.Get("Authorization"))
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{}`)),
			}, nil
		}),
	}
	s := &server{
		apiServer:   "https://kubernetes.example.test",
		bearerToken: "service-account-token",
		client:      client,
	}

	require.NoError(t, s.kubeJSON(context.Background(), http.MethodGet, "/api/v1/namespaces", nil))
}
