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
	"embed"
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

//go:embed static/*
var staticFiles embed.FS

func main() {
	s, err := newServer()
	if err != nil {
		log.Fatal(err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("GET /api/me", s.handleMe)
	mux.HandleFunc("GET /api/claws", s.handleClaws)
	mux.Handle("GET /static/", s.static)
	mux.HandleFunc("GET /", s.handleIndex)

	addr := getenv("LISTEN_ADDR", defaultListenAddr)
	log.Printf("openclaw admin dashboard listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, mux))
}

func newServer() (*server, error) {
	apiServer, err := kubeAPIServerURL()
	if err != nil {
		return nil, err
	}
	client, err := kubeHTTPClient()
	if err != nil {
		return nil, err
	}
	bearerToken, err := kubeBearerToken()
	if err != nil {
		return nil, err
	}

	return &server{
		apiServer:     apiServer,
		bearerToken:   bearerToken,
		client:        client,
		static:        http.FileServer(http.FS(staticFiles)),
		consoleURL:    strings.TrimRight(getenv("OPENSHIFT_CONSOLE_URL", ""), "/"),
		mlflowURL:     strings.TrimSpace(getenv("MLFLOW_URL", "")),
		prometheusURL: strings.TrimRight(getenv("PROMETHEUS_URL", ""), "/"),
	}, nil
}

func (s *server) handleIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	http.ServeFileFS(w, r, staticFiles, "static/index.html")
}

func (s *server) handleMe(w http.ResponseWriter, r *http.Request) {
	user, err := currentUser(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, meResponse{
		User:          user,
		ConsoleURL:    s.consoleURL,
		MLflowURL:     s.mlflowURL,
		PrometheusURL: s.prometheusURL,
	})
}

func (s *server) handleClaws(w http.ResponseWriter, r *http.Request) {
	if _, err := currentUser(r); err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	claws, err := s.listClaws(r.Context())
	if err != nil {
		writeError(w, statusCodeFor(err), err.Error())
		return
	}
	writeJSON(w, http.StatusOK, clawListResponse{Claws: claws})
}

func (s *server) listClaws(ctx context.Context) ([]adminClaw, error) {
	var list map[string]any
	if err := s.kubeJSON(ctx, http.MethodGet, "/apis/claw.sandbox.redhat.com/v1alpha1/claws", &list); err != nil {
		return nil, err
	}
	items, _, _ := nestedSlice(list, "items")
	claws := make([]adminClaw, 0, len(items))
	for _, item := range items {
		claw, ok := item.(map[string]any)
		if !ok {
			continue
		}
		claws = append(claws, s.adminClawFromResource(claw))
	}
	sort.Slice(claws, func(i, j int) bool {
		if claws[i].Management != claws[j].Management {
			return claws[i].Management > claws[j].Management
		}
		if claws[i].Namespace != claws[j].Namespace {
			return claws[i].Namespace < claws[j].Namespace
		}
		return claws[i].Name < claws[j].Name
	})
	return claws, nil
}

func (s *server) adminClawFromResource(claw map[string]any) adminClaw {
	ready, reason, message := readyCondition(claw)
	namespace, _, _ := nestedString(claw, "metadata", "namespace")
	name, _, _ := nestedString(claw, "metadata", "name")
	createdAt, _, _ := nestedString(claw, "metadata", "creationTimestamp")
	gatewayURL, _, _ := nestedString(claw, "status", "gatewayURL")
	if gatewayURL == "" {
		gatewayURL, _, _ = nestedString(claw, "status", "url")
	}
	management, _, _ := nestedString(claw, "spec", "config", "management")
	if management == "" {
		management = defaultManagement
	}
	model, _, _ := nestedString(claw, "spec", "config", "raw", "agents", "defaults", "model", "primary")

	admin := adminClaw{
		Namespace:          namespace,
		Name:               name,
		Management:         management,
		Ready:              ready,
		Reason:             reason,
		Message:            message,
		GatewayURL:         gatewayURL,
		Providers:          credentialProviders(claw),
		Model:              model,
		CreatedAt:          createdAt,
		Generation:         nestedFloat(claw, "metadata", "generation"),
		ObservedGeneration: nestedFloat(claw, "status", "observedGeneration"),
		ConfigMapName:      name + "-config",
		ProxyConfigMapName: name + "-proxy-config",
		GatewayDeployment:  name,
		ProxyDeployment:    name + "-proxy",
		RouteName:          name,
	}
	s.addLinks(&admin)
	return admin
}

func (s *server) addLinks(claw *adminClaw) {
	if s.consoleURL != "" {
		ns := url.PathEscape(claw.Namespace)
		name := url.PathEscape(claw.Name)
		claw.ClawConsoleURL = s.consoleURL + "/k8s/ns/" + ns + "/claw.sandbox.redhat.com~v1alpha1~Claw/" + name
		claw.ConfigMapURL = s.consoleURL + "/k8s/ns/" + ns + "/configmaps/" + url.PathEscape(claw.ConfigMapName)
		claw.ProxyConfigMapURL = s.consoleURL + "/k8s/ns/" + ns + "/configmaps/" + url.PathEscape(claw.ProxyConfigMapName)
		claw.GatewayDeploymentURL = s.consoleURL + "/k8s/ns/" + ns + "/deployments/" + url.PathEscape(claw.GatewayDeployment)
		claw.ProxyDeploymentURL = s.consoleURL + "/k8s/ns/" + ns + "/deployments/" + url.PathEscape(claw.ProxyDeployment)
		claw.PodsURL = s.consoleURL + "/k8s/ns/" + ns + "/pods?name=" + url.QueryEscape(claw.Name)
		claw.EventsURL = s.consoleURL + "/k8s/ns/" + ns + "/events"
	}
	if s.prometheusURL != "" {
		query := `kube_pod_info{namespace="` + claw.Namespace + `"}`
		claw.PrometheusURL = s.prometheusURL + "/graph?g0.expr=" + url.QueryEscape(query) + "&g0.tab=1"
	}
}
