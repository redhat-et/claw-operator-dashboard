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
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) {
	return f(r)
}

func TestValidateNamespace(t *testing.T) {
	tests := map[string]struct {
		namespace string
		wantErr   bool
	}{
		"minimum":    {namespace: "a"},
		"user name":  {namespace: "sallyom-claw"},
		"with digit": {namespace: "user123"},
		"empty":      {namespace: "", wantErr: true},
		"uppercase":  {namespace: "Upper", wantErr: true},
		"bad prefix": {namespace: "-bad", wantErr: true},
		"bad suffix": {namespace: "bad-", wantErr: true},
		"underscore": {namespace: "bad_namespace", wantErr: true},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			err := validateNamespace(tt.namespace)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			assert.NoError(t, err)
		})
	}
}

func TestKubeJSONImpersonatesUser(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			assert.Equal(t, "https://kubernetes.example.test/api/v1/namespaces/sallyom-claw", r.URL.String())
			assert.Equal(t, "Bearer service-account-token", r.Header.Get("Authorization"))
			assert.Equal(t, "sallyom", r.Header.Get("Impersonate-User"))
			assert.Equal(t, []string{"system:authenticated", "team-a"}, r.Header.Values("Impersonate-Group"))
			return &http.Response{
				StatusCode: http.StatusNoContent,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader("")),
			}, nil
		}),
	}

	s := &server{
		apiServer:   "https://kubernetes.example.test",
		bearerToken: "service-account-token",
		impersonate: true,
		client:      client,
	}
	identity := userIdentity{Name: "sallyom", Groups: []string{"system:authenticated", "team-a"}}
	require.NoError(t, s.kubeJSON(context.Background(), identity, http.MethodGet, "/api/v1/namespaces/sallyom-claw", nil, nil))
}

func TestKubeJSONReadsLargeResponses(t *testing.T) {
	client := &http.Client{
		Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(`{"items":["` + strings.Repeat("x", 70*1024) + `"]}`)),
			}, nil
		}),
	}
	s := &server{
		apiServer:   "https://kubernetes.example.test",
		bearerToken: "service-account-token",
		client:      client,
	}
	var out map[string]any
	require.NoError(t, s.kubeJSON(context.Background(), userIdentity{}, http.MethodGet, "/api/v1/items", nil, &out))
	items, _, _ := nestedSlice(out, "items")
	require.Len(t, items, 1)
	assert.Len(t, items[0], 70*1024)
}

func TestCurrentIdentity(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/", nil)
	require.NoError(t, err)
	req.Header.Set("X-Forwarded-User", "sallyom")
	req.Header.Set("X-Forwarded-Groups", "team-a, team-b")
	identity, err := currentIdentity(req)
	require.NoError(t, err)
	assert.Equal(t, "sallyom", identity.Name)
	assert.Equal(t, []string{"team-a", "team-b", "system:authenticated", "system:authenticated:oauth"}, identity.Groups)
}

func TestCurrentUser(t *testing.T) {
	req, err := http.NewRequest(http.MethodGet, "/", nil)
	require.NoError(t, err)
	req.Header.Set("X-Forwarded-User", "sallyom")
	user, err := currentUser(req)
	require.NoError(t, err)
	assert.Equal(t, "sallyom", user)
}

func TestAllowedNamespaceForUser(t *testing.T) {
	tests := map[string]string{
		"sallyom":             "sallyom-claw",
		"octo-claw":           "octo-claw",
		"Sally.OM@example.io": "sally-om-claw",
	}
	for username, expected := range tests {
		t.Run(username, func(t *testing.T) {
			assert.Equal(t, expected, allowedNamespaceForUser(username, defaultNSSuffix))
		})
	}
}

func TestUpsertCredentialAppendsAndReplacesProvider(t *testing.T) {
	credentials := []any{
		map[string]any{
			"name":     "openai",
			"provider": "openai",
			"secretRef": []any{
				map[string]any{"name": "openclaw-instance-openai-api-key", "key": apiKeySecretKey},
			},
		},
	}
	credentials = upsertCredential(credentials, "instance", "openrouter")
	require.Len(t, credentials, 2)
	credentials = upsertCredential(credentials, "instance", "openai")
	require.Len(t, credentials, 2)
	first := credentials[0].(map[string]any)
	assert.Equal(t, "openai", first["provider"])
}

func TestCurrentClawSpecReturnsNonNotFoundErrors(t *testing.T) {
	tests := map[string]struct {
		status  int
		wantErr bool
	}{
		"not found starts empty":  {status: http.StatusNotFound},
		"forbidden returns error": {status: http.StatusForbidden, wantErr: true},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			client := &http.Client{
				Transport: roundTripFunc(func(_ *http.Request) (*http.Response, error) {
					return &http.Response{
						StatusCode: tt.status,
						Header:     make(http.Header),
						Body:       io.NopCloser(strings.NewReader(`{"message":"nope"}`)),
					}, nil
				}),
			}
			s := &server{
				apiServer:   "https://kubernetes.example.test",
				bearerToken: "service-account-token",
				client:      client,
			}
			credentials, raw, err := s.currentClawSpec(context.Background(), userIdentity{}, "sallyom-claw", "instance")
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Nil(t, credentials)
			assert.Empty(t, raw)
		})
	}
}

func TestHandleDeleteRemovesAllManagedProviderSecrets(t *testing.T) {
	deleted := map[string]bool{}
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			body := "{}"
			if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/claws/instance") {
				body = `{
					"metadata": {"name": "instance"},
					"spec": {
						"credentials": [
							{"name": "openai", "provider": "openai"},
							{"name": "openrouter", "provider": "openrouter"}
						]
					}
				}`
			}
			if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/secrets/") {
				body = `{
					"metadata": {
						"labels": {
							"app.kubernetes.io/managed-by": "openclaw-deployer",
							"openclaw-deployer.redhat.com/instance": "instance"
						}
					}
				}`
			}
			if r.Method == http.MethodDelete {
				deleted[r.URL.Path] = true
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}

	s := &server{
		apiServer:       "https://kubernetes.example.test",
		bearerToken:     "service-account-token",
		namespaceSuffix: defaultNSSuffix,
		client:          client,
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/claw?namespace=sallyom-claw&name=instance", nil)
	req.Header.Set("X-Forwarded-User", "sallyom")
	rec := httptest.NewRecorder()

	s.handleDelete(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	for _, path := range []string{
		"/apis/claw.sandbox.redhat.com/v1alpha1/namespaces/sallyom-claw/claws/instance",
		"/api/v1/namespaces/sallyom-claw/secrets/openclaw-instance-openai-api-key",
		"/api/v1/namespaces/sallyom-claw/secrets/openclaw-instance-openrouter-api-key",
	} {
		assert.True(t, deleted[path], "expected delete for %s", path)
	}
}

func TestHandleDeleteCleansManagedSecretsWhenStateReadFails(t *testing.T) {
	deleted := map[string]bool{}
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			statusCode := http.StatusOK
			body := "{}"
			if r.Method == http.MethodGet && strings.HasSuffix(r.URL.Path, "/claws/instance") {
				statusCode = http.StatusForbidden
				body = `{"message":"state read failed"}`
			}
			if r.Method == http.MethodGet && strings.Contains(r.URL.Path, "/secrets/") {
				body = `{
					"metadata": {
						"labels": {
							"app.kubernetes.io/managed-by": "openclaw-deployer",
							"openclaw-deployer.redhat.com/instance": "instance"
						}
					}
				}`
			}
			if r.Method == http.MethodDelete {
				deleted[r.URL.Path] = true
			}
			return &http.Response{
				StatusCode: statusCode,
				Header:     make(http.Header),
				Body:       io.NopCloser(strings.NewReader(body)),
			}, nil
		}),
	}

	s := &server{
		apiServer:       "https://kubernetes.example.test",
		bearerToken:     "service-account-token",
		namespaceSuffix: defaultNSSuffix,
		client:          client,
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/claw?namespace=sallyom-claw&name=instance", nil)
	req.Header.Set("X-Forwarded-User", "sallyom")
	rec := httptest.NewRecorder()

	s.handleDelete(rec, req)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	assert.True(t, deleted["/apis/claw.sandbox.redhat.com/v1alpha1/namespaces/sallyom-claw/claws/instance"])
	for _, secretName := range managedProviderSecretNames("instance") {
		assert.True(t, deleted["/api/v1/namespaces/sallyom-claw/secrets/"+secretName], "expected delete for %s", secretName)
	}
}

func TestNormalizeModelRef(t *testing.T) {
	tests := map[string]struct {
		provider string
		model    string
		want     string
	}{
		"openrouter nested":                     {provider: "openrouter", model: "anthropic/claude-sonnet-4-6", want: "openrouter/anthropic/claude-sonnet-4-6"},
		"openrouter full":                       {provider: "openrouter", model: "openrouter/auto", want: "openrouter/auto"},
		"anthropic bare":                        {provider: "anthropic", model: "claude-sonnet-4-6", want: "anthropic/claude-sonnet-4-6"},
		"anthropic vertex bare":                 {provider: "anthropic-vertex", model: "claude-sonnet-4-6", want: "anthropic-vertex/claude-sonnet-4-6"},
		"anthropic vertex remaps direct prefix": {provider: "anthropic-vertex", model: "anthropic/claude-sonnet-4-6", want: "anthropic-vertex/claude-sonnet-4-6"},
		"google empty":                          {provider: "google", model: "", want: ""},
		"google vertex empty":                   {provider: "google-vertex", model: "", want: ""},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, tt.want, normalizeModelRef(tt.provider, tt.model))
		})
	}
}

func TestApplyClawWithoutModelLeavesAgentConfigUnset(t *testing.T) {
	var applied map[string]any
	client := &http.Client{
		Transport: roundTripFunc(func(r *http.Request) (*http.Response, error) {
			if r.Method == http.MethodGet {
				return &http.Response{
					StatusCode: http.StatusNotFound,
					Header:     make(http.Header),
					Body:       io.NopCloser(strings.NewReader(`{"message":"not found"}`)),
				}, nil
			}
			require.Equal(t, http.MethodPatch, r.Method)
			require.NoError(t, json.NewDecoder(r.Body).Decode(&applied))
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
	req := provisionRequest{
		Namespace: "sallyom-claw",
		Name:      "instance",
		Provider:  "google",
		AgentName: "Instance",
	}

	require.NoError(t, s.applyClaw(context.Background(), userIdentity{}, req))
	raw, _, _ := nestedMap(applied, "spec", "config", "raw")
	assert.Empty(t, raw)
}

func TestProviderCredentialForVertex(t *testing.T) {
	req := provisionRequest{
		Name:        "instance",
		Provider:    "anthropic-vertex",
		GCPProject:  "my-project",
		GCPLocation: "us-east5",
	}
	credential := providerCredentialForRequest(req)
	assert.Equal(t, "anthropic-vertex", credential["name"])
	assert.Equal(t, "anthropic", credential["provider"])
	assert.Equal(t, "gcp", credential["type"])
	secretRefs := credential["secretRef"].([]map[string]string)
	require.Len(t, secretRefs, 1)
	assert.Equal(t, "openclaw-instance-anthropic-vertex-gcp", secretRefs[0]["name"])
	assert.Equal(t, gcpSecretKey, secretRefs[0]["key"])
	assert.Equal(t, map[string]string{"project": "my-project", "location": "us-east5"}, credential["gcp"])
}

func TestValidateGCPServiceAccountJSON(t *testing.T) {
	tests := map[string]struct {
		value   string
		wantErr bool
	}{
		"service account":  {value: `{"type":"service_account"}`},
		"authorized user":  {value: `{"type":"authorized_user"}`},
		"external account": {value: `{"type":"external_account"}`, wantErr: true},
		"not json":         {value: `not-json`, wantErr: true},
		"missing type":     {value: `{}`, wantErr: true},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			err := validateGCPServiceAccountJSON(tt.value)
			if tt.wantErr {
				assert.Error(t, err)
				return
			}
			assert.NoError(t, err)
		})
	}
}

func TestAgentNameFromClawName(t *testing.T) {
	tests := map[string]string{
		"instance":           "Instance",
		"research-assistant": "Research Assistant",
		"team-ai-helper":     "Team Ai Helper",
		"":                   "OpenClaw",
	}
	for name, want := range tests {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, want, agentNameFromClawName(name))
		})
	}
}

func TestApplyAgentConfig(t *testing.T) {
	raw := applyAgentConfig(map[string]any{}, "SallyBot", "openrouter/anthropic/claude-sonnet-4-6")
	primary, _, _ := nestedString(raw, "agents", "defaults", "model", "primary")
	assert.Equal(t, "openrouter/anthropic/claude-sonnet-4-6", primary)
	agents, _, _ := nestedSlice(raw, "agents", "list")
	require.Len(t, agents, 1)
	first := agents[0].(map[string]any)
	assert.Equal(t, "SallyBot", first["name"])
}

func TestApplyAgentConfigPreservesUserAgents(t *testing.T) {
	raw := map[string]any{
		"agents": map[string]any{
			"list": []any{
				map[string]any{
					"id":   "custom",
					"name": "Custom",
				},
				map[string]any{
					"id":   "default",
					"name": "Old Default",
				},
			},
		},
	}
	next := applyAgentConfig(raw, "SallyBot", "openrouter/auto")
	agents, _, _ := nestedSlice(next, "agents", "list")
	require.Len(t, agents, 2)
	custom := agents[0].(map[string]any)
	defaultAgent := agents[1].(map[string]any)
	assert.Equal(t, "Custom", custom["name"])
	assert.Equal(t, "SallyBot", defaultAgent["name"])
	assert.Equal(t, map[string]any{"primary": "openrouter/auto"}, defaultAgent["model"])
}

func TestReadyCondition(t *testing.T) {
	claw := map[string]any{
		"status": map[string]any{
			"conditions": []any{
				map[string]any{
					"type":    "Ready",
					"status":  "True",
					"reason":  "Ready",
					"message": "Claw instance is ready",
				},
			},
		},
	}
	ready, reason, message := readyCondition(claw)
	assert.True(t, ready)
	assert.Equal(t, "Ready", reason)
	assert.NotEmpty(t, message)
}
