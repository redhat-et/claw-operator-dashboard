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
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"
)

func getenv(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func currentUser(r *http.Request) (string, error) {
	for _, header := range []string{
		"X-Forwarded-User",
		"X-Auth-Request-User",
		"X-Forwarded-Preferred-Username",
		"X-Forwarded-Email",
	} {
		if user := strings.TrimSpace(r.Header.Get(header)); user != "" {
			return user, nil
		}
	}
	if user := strings.TrimSpace(os.Getenv("DEVELOPER_USERNAME")); user != "" {
		return user, nil
	}
	return "", errors.New("OpenShift username was not forwarded to the admin dashboard")
}

func nestedString(obj map[string]any, fields ...string) (string, bool, error) {
	v, ok, err := nestedValue(obj, fields...)
	if err != nil || !ok {
		return "", ok, err
	}
	s, ok := v.(string)
	return s, ok, nil
}

func nestedSlice(obj map[string]any, fields ...string) ([]any, bool, error) {
	v, ok, err := nestedValue(obj, fields...)
	if err != nil || !ok {
		return nil, ok, err
	}
	s, ok := v.([]any)
	return s, ok, nil
}

func nestedFloat(obj map[string]any, fields ...string) int64 {
	v, ok, err := nestedValue(obj, fields...)
	if err != nil || !ok {
		return 0
	}
	n, _ := v.(float64)
	return int64(n)
}

func nestedValue(obj map[string]any, fields ...string) (any, bool, error) {
	var current any = obj
	for _, field := range fields {
		m, ok := current.(map[string]any)
		if !ok {
			return nil, false, fmt.Errorf("field %q is not an object", field)
		}
		current, ok = m[field]
		if !ok {
			return nil, false, nil
		}
	}
	return current, true, nil
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func readyCondition(claw map[string]any) (bool, string, string) {
	conditions, _, _ := nestedSlice(claw, "status", "conditions")
	for _, item := range conditions {
		condition, ok := item.(map[string]any)
		if !ok {
			continue
		}
		conditionType, _ := condition["type"].(string)
		if conditionType != "Ready" {
			continue
		}
		status, _ := condition["status"].(string)
		reason, _ := condition["reason"].(string)
		message, _ := condition["message"].(string)
		return status == "True", reason, message
	}
	return false, "Unknown", "Ready condition has not been reported"
}

func credentialProviders(claw map[string]any) []string {
	credentials, _, _ := nestedSlice(claw, "spec", "credentials")
	providers := []string{}
	for _, item := range credentials {
		credential, ok := item.(map[string]any)
		if !ok {
			continue
		}
		provider, _ := credential["provider"].(string)
		if provider != "" {
			providers = appendUnique(providers, provider)
		}
	}
	sort.Strings(providers)
	return providers
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
