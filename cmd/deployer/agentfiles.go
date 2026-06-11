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
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strings"
)

const (
	agentFilesArchiveKey    = "agentfiles.tgz"
	agentFilesMaxTotalBytes = 1 << 20 // 1 MiB of uploaded file content
)

func agentFilesConfigMapName(clawName string) string {
	return "openclaw-" + clawName + "-agentfiles"
}

// handleAgentFiles packages an uploaded folder into the gzipped tar archive the
// operator expects and stores it in a ConfigMap, so users never have to build a
// tarball or craft a ConfigMap by hand. It applies the ConfigMap as the
// impersonated user, then provisioning references it via spec.agentFiles.
func (s *server) handleAgentFiles(w http.ResponseWriter, r *http.Request) {
	identity, err := currentIdentity(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, err.Error())
		return
	}
	namespace := r.URL.Query().Get("namespace")
	if err := validateNamespace(namespace); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	name := r.URL.Query().Get("name")
	if err := validateResourceName(name, "Claw name"); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}

	files, err := readUploadedFiles(w, r)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "no files were uploaded")
		return
	}
	archive, err := buildAgentFilesArchive(files)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to package files: "+err.Error())
		return
	}

	if err := s.ensureProject(r.Context(), identity, namespace); err != nil {
		writeError(w, statusCodeFor(err), "failed to create project: "+err.Error())
		return
	}
	configMapName := agentFilesConfigMapName(name)
	if err := s.applyAgentFilesConfigMap(r.Context(), identity, namespace, name, configMapName, archive); err != nil {
		writeError(w, statusCodeFor(err), "failed to store files: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"configMapName": configMapName, "key": agentFilesArchiveKey})
}

// readUploadedFiles streams the multipart upload, keying each file by its
// archive-relative path (the multipart field name) and enforcing a total size
// cap so an upload cannot exhaust memory or exceed the ConfigMap size limit.
func readUploadedFiles(w http.ResponseWriter, r *http.Request) (map[string][]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, 4*agentFilesMaxTotalBytes)
	reader, err := r.MultipartReader()
	if err != nil {
		return nil, fmt.Errorf("expected a multipart file upload")
	}
	files := map[string][]byte{}
	total := 0
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("invalid upload: %w", err)
		}
		rel := cleanArchivePath(part.FormName())
		if rel == "" {
			_ = part.Close()
			continue
		}
		buf := &bytes.Buffer{}
		n, err := io.Copy(buf, io.LimitReader(part, int64(agentFilesMaxTotalBytes-total)+1))
		_ = part.Close()
		if err != nil {
			return nil, fmt.Errorf("invalid upload: %w", err)
		}
		total += int(n)
		if total > agentFilesMaxTotalBytes {
			return nil, fmt.Errorf("uploaded files exceed the %d KiB limit", agentFilesMaxTotalBytes/1024)
		}
		files[rel] = buf.Bytes()
	}
	return files, nil
}

func cleanArchivePath(p string) string {
	p = strings.TrimPrefix(strings.TrimSpace(p), "/")
	if p == "" {
		return ""
	}
	clean := path.Clean(p)
	if clean == "." || clean == ".." || strings.HasPrefix(clean, "../") {
		return ""
	}
	return clean
}

func buildAgentFilesArchive(files map[string][]byte) ([]byte, error) {
	names := make([]string, 0, len(files))
	for name := range files {
		names = append(names, name)
	}
	sort.Strings(names)

	var gzBuf bytes.Buffer
	gz := gzip.NewWriter(&gzBuf)
	tw := tar.NewWriter(gz)
	for _, name := range names {
		content := files[name]
		header := &tar.Header{
			Name: name,
			Mode: 0o644,
			Size: int64(len(content)),
		}
		if err := tw.WriteHeader(header); err != nil {
			return nil, err
		}
		if _, err := tw.Write(content); err != nil {
			return nil, err
		}
	}
	if err := tw.Close(); err != nil {
		return nil, err
	}
	if err := gz.Close(); err != nil {
		return nil, err
	}
	return gzBuf.Bytes(), nil
}

func (s *server) applyAgentFilesConfigMap(ctx context.Context, identity userIdentity, namespace, clawName, configMapName string, archive []byte) error {
	body := map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":      configMapName,
			"namespace": namespace,
			"labels": map[string]string{
				managedByLabel: managedByValue,
				instanceLabel:  clawName,
			},
		},
		"binaryData": map[string]string{
			agentFilesArchiveKey: base64.StdEncoding.EncodeToString(archive),
		},
	}
	return s.apply(ctx, identity, apiPath("api/v1/namespaces", namespace, "configmaps", configMapName), body)
}
