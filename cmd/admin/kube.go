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
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

func kubeAPIServerURL() (string, error) {
	if override := os.Getenv("KUBE_API_SERVER"); override != "" {
		return strings.TrimRight(override, "/"), nil
	}
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := getenv("KUBERNETES_SERVICE_PORT", "443")
	if host == "" {
		return "", errors.New("KUBERNETES_SERVICE_HOST is not set; set KUBE_API_SERVER for local testing")
	}
	return "https://" + host + ":" + port, nil
}

func kubeHTTPClient() (*http.Client, error) {
	caPEM, err := os.ReadFile(inClusterCAPath)
	if err != nil {
		if os.Getenv("KUBE_API_SERVER") != "" {
			return &http.Client{Timeout: 20 * time.Second}, nil
		}
		return nil, fmt.Errorf("read Kubernetes CA: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caPEM) {
		return nil, errors.New("failed to parse Kubernetes CA bundle")
	}
	return &http.Client{
		Timeout: 20 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: &tls.Config{RootCAs: pool, MinVersion: tls.VersionTLS12},
		},
	}, nil
}

func kubeBearerToken() (string, error) {
	if token := strings.TrimSpace(os.Getenv("DEVELOPER_BEARER_TOKEN")); token != "" {
		return token, nil
	}
	token, err := os.ReadFile(inClusterTokenPath)
	if err != nil {
		return "", fmt.Errorf("read Kubernetes service account token: %w", err)
	}
	return strings.TrimSpace(string(token)), nil
}

func (s *server) kubeJSON(ctx context.Context, method, requestPath string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, s.apiServer+requestPath, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+s.bearerToken)
	req.Header.Set("Accept", "application/json")

	resp, err := s.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = resp.Body.Close() }()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return parseAPIError(resp.StatusCode, respBody)
	}
	if out == nil || len(respBody) == 0 {
		return nil
	}
	return json.Unmarshal(respBody, out)
}

type apiError struct {
	StatusCode int
	Message    string
}

func (e apiError) Error() string {
	return e.Message
}

func parseAPIError(statusCode int, body []byte) error {
	var status struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &status); err == nil && status.Message != "" {
		return apiError{StatusCode: statusCode, Message: status.Message}
	}
	return apiError{StatusCode: statusCode, Message: http.StatusText(statusCode)}
}

func statusCodeFor(err error) int {
	var apiErr apiError
	if errors.As(err, &apiErr) {
		switch apiErr.StatusCode {
		case http.StatusUnauthorized, http.StatusForbidden, http.StatusNotFound:
			return apiErr.StatusCode
		default:
			return http.StatusBadGateway
		}
	}
	return http.StatusInternalServerError
}
