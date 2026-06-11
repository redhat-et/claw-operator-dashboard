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

import "net/http"

const (
	inClusterCAPath    = "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
	inClusterTokenPath = "/var/run/secrets/kubernetes.io/serviceaccount/token"
	defaultListenAddr  = ":8080"
	defaultManagement  = "operator"
)

type server struct {
	apiServer     string
	bearerToken   string
	client        *http.Client
	static        http.Handler
	consoleURL    string
	mlflowURL     string
	prometheusURL string
}

type meResponse struct {
	User          string `json:"user,omitempty"`
	ConsoleURL    string `json:"consoleURL,omitempty"`
	MLflowURL     string `json:"mlflowURL,omitempty"`
	PrometheusURL string `json:"prometheusURL,omitempty"`
}

type clawListResponse struct {
	Claws []adminClaw `json:"claws"`
}

type adminClaw struct {
	Namespace            string   `json:"namespace"`
	Name                 string   `json:"name"`
	Management           string   `json:"management"`
	Ready                bool     `json:"ready"`
	Reason               string   `json:"reason,omitempty"`
	Message              string   `json:"message,omitempty"`
	GatewayURL           string   `json:"gatewayURL,omitempty"`
	Providers            []string `json:"providers,omitempty"`
	Model                string   `json:"model,omitempty"`
	CreatedAt            string   `json:"createdAt,omitempty"`
	Generation           int64    `json:"generation,omitempty"`
	ObservedGeneration   int64    `json:"observedGeneration,omitempty"`
	ConfigMapName        string   `json:"configMapName"`
	ProxyConfigMapName   string   `json:"proxyConfigMapName"`
	GatewayDeployment    string   `json:"gatewayDeployment"`
	ProxyDeployment      string   `json:"proxyDeployment"`
	RouteName            string   `json:"routeName"`
	ClawConsoleURL       string   `json:"clawConsoleURL,omitempty"`
	ConfigMapURL         string   `json:"configMapURL,omitempty"`
	ProxyConfigMapURL    string   `json:"proxyConfigMapURL,omitempty"`
	GatewayDeploymentURL string   `json:"gatewayDeploymentURL,omitempty"`
	ProxyDeploymentURL   string   `json:"proxyDeploymentURL,omitempty"`
	PodsURL              string   `json:"podsURL,omitempty"`
	EventsURL            string   `json:"eventsURL,omitempty"`
	PrometheusURL        string   `json:"prometheusURL,omitempty"`
}
