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
	"encoding/base64"
	"errors"
	"net/http"
	"sort"
	"time"
)

func (s *server) listClaws(ctx context.Context, identity userIdentity, namespace string) ([]stateResponse, error) {
	var list map[string]any
	if err := s.kubeJSON(ctx, identity, http.MethodGet, apiPath("apis/claw.sandbox.redhat.com/v1alpha1/namespaces", namespace, "claws"), nil, &list); err != nil {
		return nil, err
	}
	return clawStatesFromList(list), nil
}

func (s *server) listAllClaws(ctx context.Context, identity userIdentity) ([]stateResponse, error) {
	var list map[string]any
	if err := s.kubeJSON(ctx, identity, http.MethodGet, "/apis/claw.sandbox.redhat.com/v1alpha1/claws", nil, &list); err != nil {
		var apiErr apiError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusForbidden {
			return nil, err
		}
		return s.listClawsByVisibleNamespaces(ctx, identity)
	}
	return clawStatesFromList(list), nil
}

func (s *server) listClawsByVisibleNamespaces(ctx context.Context, identity userIdentity) ([]stateResponse, error) {
	namespaces, err := s.visibleNamespaceNames(ctx, identity)
	if err != nil {
		return nil, err
	}
	claws := []stateResponse{}
	for _, name := range namespaces {
		namespaceClaws, err := s.listClaws(ctx, identity, name)
		if err != nil {
			var apiErr apiError
			if errors.As(err, &apiErr) && (apiErr.StatusCode == http.StatusForbidden || apiErr.StatusCode == http.StatusNotFound) {
				continue
			}
			return nil, err
		}
		claws = append(claws, namespaceClaws...)
	}
	sortClaws(claws)
	return claws, nil
}

func (s *server) visibleNamespaceNames(ctx context.Context, identity userIdentity) ([]string, error) {
	var namespaceList map[string]any
	if err := s.kubeJSON(ctx, identity, http.MethodGet, "/api/v1/namespaces", nil, &namespaceList); err != nil {
		var apiErr apiError
		if !errors.As(err, &apiErr) || apiErr.StatusCode != http.StatusForbidden {
			return nil, err
		}
		var projectList map[string]any
		if projectErr := s.kubeJSON(ctx, identity, http.MethodGet, "/apis/project.openshift.io/v1/projects", nil, &projectList); projectErr != nil {
			return nil, projectErr
		}
		namespaceList = projectList
	}
	items, _, _ := nestedSlice(namespaceList, "items")
	names := make([]string, 0, len(items))
	for _, item := range items {
		namespace, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _, _ := nestedString(namespace, "metadata", "name")
		if name == "" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	return names, nil
}

func clawStatesFromList(list map[string]any) []stateResponse {
	items, _, _ := nestedSlice(list, "items")
	claws := make([]stateResponse, 0, len(items))
	for _, item := range items {
		claw, ok := item.(map[string]any)
		if !ok {
			continue
		}
		claws = append(claws, stateFromClaw(claw))
	}
	sortClaws(claws)
	return claws
}

func sortClaws(claws []stateResponse) {
	sort.Slice(claws, func(i, j int) bool {
		if claws[i].Namespace != claws[j].Namespace {
			return claws[i].Namespace < claws[j].Namespace
		}
		return claws[i].Name < claws[j].Name
	})
}

func (s *server) getState(ctx context.Context, identity userIdentity, namespace, name string) (stateResponse, error) {
	var claw map[string]any
	err := s.kubeJSON(ctx, identity, http.MethodGet, apiPath("apis/claw.sandbox.redhat.com/v1alpha1/namespaces", namespace, "claws", name), nil, &claw)
	if err != nil {
		return stateResponse{}, err
	}
	return stateFromClaw(claw), nil
}

func stateFromClaw(claw map[string]any) stateResponse {
	ready, reason, message := readyCondition(claw)
	gatewayURL, _, _ := nestedString(claw, "status", "gatewayURL")
	if gatewayURL == "" {
		gatewayURL, _, _ = nestedString(claw, "status", "url")
	}
	providers := credentialProviders(claw)
	provider := ""
	if len(providers) > 0 {
		provider = providers[0]
	}
	name, _, _ := nestedString(claw, "metadata", "name")
	namespace, _, _ := nestedString(claw, "metadata", "namespace")
	createdAt, _, _ := nestedString(claw, "metadata", "creationTimestamp")
	model, _, _ := nestedString(claw, "spec", "config", "raw", "agents", "defaults", "model", "primary")
	agentName := firstAgentName(claw)
	management, _, _ := nestedString(claw, "spec", "config", "management")
	if management == "" {
		management = defaultManagement
	}

	return stateResponse{
		Namespace:   namespace,
		Name:        name,
		Exists:      true,
		Ready:       ready,
		Reason:      reason,
		Message:     message,
		GatewayURL:  gatewayURL,
		Provider:    provider,
		Providers:   providers,
		Model:       model,
		AgentName:   agentName,
		Management:  management,
		CreatedAt:   createdAt,
		SecretNames: credentialSecretNames(claw),
	}
}

func (s *server) applySecret(ctx context.Context, identity userIdentity, req provisionRequest) error {
	option := providers[req.Provider]
	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "Secret",
		"metadata": map[string]any{
			"name":      secretNameForRequest(req),
			"namespace": req.Namespace,
			"labels": map[string]string{
				managedByLabel: managedByValue,
				instanceLabel:  req.Name,
				providerLabel:  req.Provider,
			},
		},
		"type": "Opaque",
		"data": map[string]string{
			option.SecretKey: base64.StdEncoding.EncodeToString([]byte(req.APIKey)),
		},
	}
	return s.apply(ctx, identity, apiPath("api/v1/namespaces", req.Namespace, "secrets", secretNameForRequest(req)), body)
}

func (s *server) ensureProject(ctx context.Context, identity userIdentity, namespace string) error {
	if err := s.kubeJSON(ctx, identity, http.MethodGet, apiPath("api/v1/namespaces", namespace), nil, nil); err == nil {
		return nil
	} else {
		var apiErr apiError
		if !errors.As(err, &apiErr) || (apiErr.StatusCode != http.StatusNotFound && apiErr.StatusCode != http.StatusForbidden) {
			return err
		}
	}

	body := map[string]any{
		"apiVersion": "project.openshift.io/v1",
		"kind":       "ProjectRequest",
		"metadata": map[string]string{
			"name": namespace,
		},
	}
	err := s.kubeJSON(ctx, identity, http.MethodPost, "/apis/project.openshift.io/v1/projectrequests", body, nil)
	var apiErr apiError
	if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusConflict {
		return nil
	}
	return err
}

func (s *server) applyClaw(ctx context.Context, identity userIdentity, req provisionRequest) error {
	if req.Management == "" {
		req.Management = s.defaultConfigManagement()
	}
	credentials, rawConfig, agentFiles, err := s.currentClawSpec(ctx, identity, req.Namespace, req.Name)
	if err != nil {
		return err
	}
	credentials = upsertProvisionCredential(credentials, req)
	if req.AgentName != "" {
		rawConfig = applyAgentConfig(rawConfig, req.AgentName, req.Model)
	}
	if next := agentFilesSpec(req); next != nil {
		agentFiles = next
	}

	spec := map[string]any{
		"credentials": credentials,
		"config": map[string]any{
			"raw":        rawConfig,
			"mergeMode":  "merge",
			"management": req.Management,
		},
	}
	if len(agentFiles) > 0 {
		spec["agentFiles"] = agentFiles
	}

	body := map[string]any{
		"apiVersion": "claw.sandbox.redhat.com/v1alpha1",
		"kind":       "Claw",
		"metadata": map[string]any{
			"name":      req.Name,
			"namespace": req.Namespace,
			"labels": map[string]string{
				managedByLabel: managedByValue,
			},
		},
		"spec": spec,
	}
	return s.apply(ctx, identity, apiPath("apis/claw.sandbox.redhat.com/v1alpha1/namespaces", req.Namespace, "claws", req.Name), body)
}

// agentFilesSpec builds the spec.agentFiles object for a provision request, or
// nil when no filesystem source was requested (so an existing source is left
// untouched on update). The operator only acts on agentFiles for user-managed
// Claws; handleProvision enforces that before this is called.
func agentFilesSpec(req provisionRequest) map[string]any {
	switch req.FilesystemSource {
	case "git":
		git := map[string]any{"url": req.GitURL}
		if req.GitRef != "" {
			git["ref"] = req.GitRef
		}
		if req.GitPath != "" {
			git["path"] = req.GitPath
		}
		return map[string]any{"git": git}
	case "configmap":
		ref := map[string]any{"name": req.ConfigMapName}
		if req.ConfigMapKey != "" {
			ref["key"] = req.ConfigMapKey
		}
		return map[string]any{"configMapRef": ref}
	default:
		return nil
	}
}

func (s *server) defaultConfigManagement() string {
	if s.defaultManagement == "" {
		return defaultManagement
	}
	return s.defaultManagement
}

func (s *server) currentClawSpec(ctx context.Context, identity userIdentity, namespace, name string) ([]any, map[string]any, map[string]any, error) {
	var claw map[string]any
	err := s.kubeJSON(ctx, identity, http.MethodGet, apiPath("apis/claw.sandbox.redhat.com/v1alpha1/namespaces", namespace, "claws", name), nil, &claw)
	if err != nil {
		var apiErr apiError
		if errors.As(err, &apiErr) && apiErr.StatusCode == http.StatusNotFound {
			return nil, map[string]any{}, nil, nil
		}
		return nil, nil, nil, err
	}
	credentials, _, _ := nestedSlice(claw, "spec", "credentials")
	raw, _, _ := nestedMap(claw, "spec", "config", "raw")
	agentFiles, _, _ := nestedMap(claw, "spec", "agentFiles")
	return credentials, cloneMap(raw), cloneMap(agentFiles), nil
}

func upsertCredential(credentials []any, instanceName, provider string) []any {
	return upsertProvisionCredential(credentials, provisionRequest{Name: instanceName, Provider: provider})
}

func upsertProvisionCredential(credentials []any, req provisionRequest) []any {
	option := providers[req.Provider]
	next := make([]any, 0, len(credentials)+1)
	replaced := false
	for _, credential := range credentials {
		credentialMap, ok := credential.(map[string]any)
		if !ok {
			continue
		}
		name, _ := credentialMap["name"].(string)
		if name == option.CredentialName {
			next = append(next, providerCredentialForRequest(req))
			replaced = true
			continue
		}
		next = append(next, credentialMap)
	}
	if !replaced {
		next = append(next, providerCredentialForRequest(req))
	}
	return next
}

func providerCredentialForRequest(req provisionRequest) map[string]any {
	option := providers[req.Provider]
	credential := map[string]any{
		"name":     option.CredentialName,
		"provider": option.CredentialProvider,
		"secretRef": []map[string]string{
			{"name": secretNameForRequest(req), "key": option.SecretKey},
		},
	}
	if option.CredentialType != "" {
		credential["type"] = option.CredentialType
	}
	if option.RequiresGCP {
		credential["gcp"] = map[string]string{
			"project":  req.GCPProject,
			"location": req.GCPLocation,
		}
	}
	return credential
}

func applyAgentConfig(raw map[string]any, agentName, model string) map[string]any {
	config := cloneMap(raw)
	agents := ensureMap(config, "agents")
	defaults := ensureMap(agents, "defaults")
	if model != "" {
		defaults["model"] = map[string]any{"primary": model}
		models := ensureMap(defaults, "models")
		models[model] = map[string]any{"alias": model}
	} else {
		// Blank model means "use the provider default": drop any override this
		// deployer previously set so a stale model does not linger.
		delete(defaults, "model")
		delete(defaults, "models")
	}

	defaultAgent := map[string]any{
		"id":        "default",
		"name":      agentName,
		"identity":  map[string]string{"name": agentName},
		"workspace": "~/.openclaw/workspace",
	}
	if model != "" {
		defaultAgent["model"] = map[string]any{"primary": model}
	}
	existing, _ := agents["list"].([]any)
	list := append([]any(nil), existing...)
	for i, item := range list {
		agent, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := agent["id"].(string)
		name, _ := agent["name"].(string)
		if id == "default" || name == agentName {
			next := cloneMap(agent)
			for key, value := range defaultAgent {
				next[key] = value
			}
			if model == "" {
				delete(next, "model")
			}
			list[i] = next
			agents["list"] = list
			return config
		}
	}
	agents["list"] = append(list, defaultAgent)
	return config
}

func (s *server) restartDeployments(ctx context.Context, identity userIdentity, namespace, name string) error {
	restartedAt := time.Now().UTC().Format(time.RFC3339)
	patch := map[string]any{
		"spec": map[string]any{
			"template": map[string]any{
				"metadata": map[string]any{
					"annotations": map[string]string{
						"openclaw-deployer.redhat.com/restartedAt": restartedAt,
					},
				},
			},
		},
	}
	for _, deployment := range []string{name, name + "-proxy"} {
		if err := s.mergePatch(ctx, identity, apiPath("apis/apps/v1/namespaces", namespace, "deployments", deployment), patch); err != nil {
			return err
		}
	}
	return nil
}

func (s *server) deleteManagedAgentFiles(ctx context.Context, identity userIdentity, namespace, name string) error {
	configMapName := agentFilesConfigMapName(name)
	var configMap map[string]any
	configMapPath := apiPath("api/v1/namespaces", namespace, "configmaps", configMapName)
	if err := s.kubeJSON(ctx, identity, http.MethodGet, configMapPath, nil, &configMap); err != nil {
		return err
	}
	managedBy, _, _ := nestedString(configMap, "metadata", "labels", managedByLabel)
	instance, _, _ := nestedString(configMap, "metadata", "labels", instanceLabel)
	if managedBy != managedByValue || instance != name {
		return nil
	}
	return s.delete(ctx, identity, configMapPath)
}

func (s *server) deleteManagedSecret(ctx context.Context, identity userIdentity, namespace, name, secretName string) error {
	var secret map[string]any
	secretPath := apiPath("api/v1/namespaces", namespace, "secrets", secretName)
	if err := s.kubeJSON(ctx, identity, http.MethodGet, secretPath, nil, &secret); err != nil {
		return err
	}
	managedBy, _, _ := nestedString(secret, "metadata", "labels", managedByLabel)
	instance, _, _ := nestedString(secret, "metadata", "labels", instanceLabel)
	if managedBy != managedByValue || instance != name {
		return nil
	}
	return s.delete(ctx, identity, secretPath)
}

func readyCondition(claw map[string]any) (bool, string, string) {
	conditions, _, _ := nestedSlice(claw, "status", "conditions")
	for _, item := range conditions {
		condition, ok := item.(map[string]any)
		if !ok || condition["type"] != "Ready" {
			continue
		}
		reason, _ := condition["reason"].(string)
		message, _ := condition["message"].(string)
		status, _ := condition["status"].(string)
		return status == "True", reason, message
	}
	return false, "", "Waiting for status"
}

func credentialProviders(claw map[string]any) []string {
	credentials, _, _ := nestedSlice(claw, "spec", "credentials")
	providers := make([]string, 0, len(credentials))
	for _, credential := range credentials {
		credentialMap, ok := credential.(map[string]any)
		if !ok {
			continue
		}
		provider, _ := credentialMap["provider"].(string)
		if provider != "" {
			providers = append(providers, provider)
		}
	}
	return providers
}

func credentialSecretNames(claw map[string]any) []string {
	credentials, _, _ := nestedSlice(claw, "spec", "credentials")
	secretNames := []string{}
	for _, credential := range credentials {
		credentialMap, ok := credential.(map[string]any)
		if !ok {
			continue
		}
		secretRefs, _, _ := nestedSlice(credentialMap, "secretRef")
		for _, ref := range secretRefs {
			refMap, ok := ref.(map[string]any)
			if !ok {
				continue
			}
			name, _ := refMap["name"].(string)
			if name != "" {
				secretNames = appendUnique(secretNames, name)
			}
		}
	}
	return secretNames
}

func firstAgentName(claw map[string]any) string {
	agents, _, _ := nestedSlice(claw, "spec", "config", "raw", "agents", "list")
	if len(agents) == 0 {
		return ""
	}
	first, ok := agents[0].(map[string]any)
	if !ok {
		return ""
	}
	name, _ := first["name"].(string)
	return name
}
